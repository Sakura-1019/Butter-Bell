// 解压在数据库上的部分：密码尝试顺序、记住密码、解压后对压缩包的处理、把解压结果写成游戏（见 docs/schema-draft.md）。
// 真正调用 7-Zip 的在 sevenzip.ts，把两者串起来的在 extractor.ts。
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'

// safeStorage 的那一小部分（ADR 0002）；测试里换成假的
export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string // 解不开（换了电脑）时抛错
}

export interface PasswordTry {
  password: string // '' = 不带密码
  commonId?: number // 来自常用密码表的哪一条
}

export type PostExtractAction = 'keep' | 'recycle' | 'move'
export const EXTRACTED_DIR = '已解压'

const tryDecrypt = (cipher: Cipher, b: Buffer): string | null => {
  try {
    return cipher.decrypt(b)
  } catch {
    return null // ADR 0002：换了电脑解不开就当没有，不报错
  }
}

// 单包密码 → 无密码 → 常用密码（按表里的顺序；试成功的会挪到最前面，见 rememberPassword）
export function passwordCandidates(db: Database.Database, archiveId: number, cipher: Cipher): PasswordTry[] {
  const out: PasswordTry[] = []
  const add = (t: PasswordTry) => {
    if (!out.some((o) => o.password === t.password)) out.push(t)
  }
  const mine = db.prepare('SELECT password_cipher FROM archives WHERE id = ?').pluck().get(archiveId) as Buffer | null
  const own = mine && tryDecrypt(cipher, mine)
  if (own) add({ password: own })
  add({ password: '' })
  const rows = db
    .prepare('SELECT id, password_cipher FROM common_passwords ORDER BY position, id')
    .all() as { id: number; password_cipher: Buffer }[]
  for (const r of rows) {
    const pw = tryDecrypt(cipher, r.password_cipher)
    if (pw) add({ password: pw, commonId: r.id })
  }
  return out
}

// 解开以后记住用上的密码：常用表里试成功的记到这个压缩包上；用户输入的只有选了保存才记，同时加进常用表
export function rememberPassword(db: Database.Database, archiveId: number, used: PasswordTry, save: boolean, cipher: Cipher, now: string): void {
  if (!used.password) return
  let commonId = used.commonId
  if (commonId === undefined) {
    if (!save) return
    const rows = db.prepare('SELECT id, password_cipher FROM common_passwords').all() as { id: number; password_cipher: Buffer }[]
    commonId = rows.find((r) => tryDecrypt(cipher, r.password_cipher) === used.password)?.id
    if (commonId === undefined)
      commonId = Number(
        db.prepare('INSERT INTO common_passwords (password_cipher, created_at) VALUES (?, ?)').run(cipher.encrypt(used.password), now).lastInsertRowid
      )
  }
  // 试成功的挪到最前面，下次先试它
  db.prepare('UPDATE common_passwords SET last_success_at = ?, position = (SELECT MIN(position) - 1 FROM common_passwords) WHERE id = ?').run(now, commonId)
  db.prepare('UPDATE archives SET password_cipher = ? WHERE id = ?').run(cipher.encrypt(used.password), archiveId)
}

export interface FileOps {
  trash(path: string): Promise<void> // shell.trashItem，绝不永久删除
  move(from: string, to: string): Promise<void>
  exists(path: string): boolean
}

// 返回压缩包新的 current_dir（相对于仓库目录；NULL = 进了回收站）
export async function postExtract(action: PostExtractAction, archiveDir: string, currentDir: string, volumes: string[], ops: FileOps): Promise<string | null> {
  const from = (v: string) => join(archiveDir, currentDir, v)
  if (action === 'recycle') {
    for (const v of volumes) await ops.trash(from(v))
    return null
  }
  if (action === 'move') {
    const to = (v: string) => join(archiveDir, EXTRACTED_DIR, v)
    // 有一个重名就整组都不挪，免得分卷被拆散
    if (volumes.some((v) => ops.exists(to(v)))) return currentDir
    for (const v of volumes) await ops.move(from(v), to(v))
    return EXTRACTED_DIR
  }
  return currentDir
}

export function uniqueFolder(libraryDir: string, name: string, exists: (path: string) => boolean): string {
  let n = 1
  let candidate = name
  while (exists(join(libraryDir, candidate))) candidate = `${name} (${++n})`
  return candidate
}

export interface NewGame {
  folderName: string
  launchFile: string | null // rankLaunchFiles 的 autoPick
  launchCandidates?: string[] // 接回时用：原来的启动文件还在里面就接着用
  version?: string | null // 从压缩包名（取不到再用文件夹名）取出的版本号；接回时也更新，除非用户手动改过
  members: { id: number; subfolder: string | null; currentDir: string | null }[]
}

// 这些压缩包以前解压出的游戏如果已经卸载了，返回它的 id，解压完接回它
export function reattachTarget(db: Database.Database, archiveIds: number[]): number | null {
  if (!archiveIds.length) return null
  return (
    (db
      .prepare(`SELECT g.id FROM archives a JOIN games g ON g.id = a.game_id WHERE a.id IN (${archiveIds.map(() => '?').join()}) AND g.uninstalled_at IS NOT NULL`)
      .pluck()
      .get(...archiveIds) as number | undefined) ?? null
  )
}

// 新游戏或者接回：返回游戏 id
export function addGame(db: Database.Database, g: NewGame, now: string): number {
  return db.transaction(() => {
    const back = reattachTarget(db, g.members.map((m) => m.id))
    let id: number
    if (back !== null) {
      const old = db.prepare('SELECT launch_file FROM games WHERE id = ?').pluck().get(back) as string | null
      const launch = old && g.launchCandidates?.includes(old) ? old : g.launchFile
      db.prepare('UPDATE games SET uninstalled_at = NULL, folder_name = ?, launch_file = ? WHERE id = ?').run(g.folderName, launch, back)
      if (g.version) db.prepare('UPDATE games SET version = ? WHERE id = ? AND version_manual = 0').run(g.version, back)
      id = back
    } else
      id = Number(
        db.prepare('INSERT INTO games (title, folder_name, launch_file, version, added_at) VALUES (?, ?, ?, ?, ?)').run(basename(g.folderName), g.folderName, g.launchFile, g.version ?? null, now)
          .lastInsertRowid
      )
    const set = db.prepare(
      "UPDATE archives SET state = 'extracted', game_id = ?, current_dir = ?, subfolder = ?, extracted_at = ?, needs_password = 0, last_error = NULL WHERE id = ?"
    )
    for (const m of g.members) set.run(id, m.currentDir, m.subfolder, now, m.id)
    db.prepare('UPDATE games SET recent_extract_at = ? WHERE id = ?').run(now, id) // 游戏库的“最近解压”
    return id
  })()
}

export function setLaunchFile(db: Database.Database, gameId: number, launchFile: string): void {
  db.prepare('UPDATE games SET launch_file = ? WHERE id = ?').run(launchFile, gameId)
}
