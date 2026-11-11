// 现成文件夹：游戏目录里不是 Butter Bell 解压出来、也还没进库的文件夹。不建表，每次扫描游戏目录现算（docs/schema-draft.md）。
import type Database from 'better-sqlite3'

// 解压用的临时文件夹（.butter-bell-extracting-*）、盘符根下的回收站和系统文件夹都不是游戏
const SKIP = /^[.$]|^System Volume Information$/i

// names：游戏目录下一层的文件夹名。和已卸载游戏同名的要接回；其余库里没有、也没被忽略的是现成文件夹
export function looseFolders(db: Database.Database, names: string[]): { loose: string[]; reattach: { gameId: number; folder: string }[] } {
  const installed = new Set((db.prepare('SELECT folder_name FROM games WHERE uninstalled_at IS NULL').pluck().all() as string[]).map((n) => n.toLowerCase()))
  const ignored = new Set((db.prepare('SELECT folder_name FROM ignored_loose_folders').pluck().all() as string[]).map((n) => n.toLowerCase()))
  const gone = db.prepare('SELECT id FROM games WHERE uninstalled_at IS NOT NULL AND folder_name = ? COLLATE NOCASE ORDER BY uninstalled_at DESC').pluck()
  const loose: string[] = []
  const reattach: { gameId: number; folder: string }[] = []
  for (const name of names) {
    if (SKIP.test(name) || installed.has(name.toLowerCase())) continue
    const gameId = gone.get(name) as number | undefined
    if (gameId !== undefined) reattach.push({ gameId, folder: name })
    else if (!ignored.has(name.toLowerCase())) loose.push(name)
  }
  return { loose, reattach }
}

export function ignoreFolders(db: Database.Database, names: string[], on: boolean, now: string): void {
  const add = db.prepare('INSERT OR IGNORE INTO ignored_loose_folders (folder_name, ignored_at) VALUES (?, ?)')
  const del = db.prepare('DELETE FROM ignored_loose_folders WHERE folder_name = ?')
  db.transaction(() => {
    for (const n of names) on ? add.run(n, now) : del.run(n)
  })()
}

// 把现成文件夹加进库，返回游戏 id。和已卸载游戏同名就接回它：资料都沿用，原来的启动文件还在就接着用
// version：文件夹名里取出的版本号，接回时也更新（用户手动改过的除外）
export function addFolder(db: Database.Database, f: { folderName: string; launchFile: string | null; launchCandidates: string[]; version?: string | null }, now: string): number {
  return db.transaction(() => {
    const back = looseFolders(db, [f.folderName]).reattach[0]
    if (!back)
      return Number(
        db.prepare('INSERT INTO games (title, folder_name, launch_file, version, added_at, recent_extract_at) VALUES (?, ?, ?, ?, ?, ?)').run(f.folderName, f.folderName, f.launchFile, f.version ?? null, now, now)
          .lastInsertRowid
      )
    const old = db.prepare('SELECT launch_file FROM games WHERE id = ?').pluck().get(back.gameId) as string | null
    const launch = old && f.launchCandidates.includes(old) ? old : f.launchFile
    db.prepare('UPDATE games SET uninstalled_at = NULL, folder_name = ?, launch_file = ?, recent_extract_at = ? WHERE id = ?').run(f.folderName, launch, now, back.gameId)
    if (f.version) db.prepare('UPDATE games SET version = ? WHERE id = ? AND version_manual = 0').run(f.version, back.gameId)
    // 卸载时它的压缩包回了收件箱；游戏已经回来了，压缩包也回到“已解压”
    db.prepare("UPDATE archives SET state = 'extracted' WHERE game_id = ? AND state = 'inbox'").run(back.gameId)
    return back.gameId
  })()
}
