// 解压队列：一次解一个单位（压缩包或同套），解到游戏目录里的临时文件夹，成功后改名成正式文件夹并写成游戏。
import { existsSync } from 'node:fs'
import { readdir, rename, rm, statfs } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type Database from 'better-sqlite3'
import { groupArchives, type FileEntry } from '../core/volumes'
import { rankLaunchFiles } from '../core/launch'
import { addGame, passwordCandidates, postExtract, rememberPassword, uniqueFolder, type Cipher, type FileOps, type PasswordTry, type PostExtractAction } from './extract'
import { ExtractError, extract, flatten, probe, type Failure } from './sevenzip'
import { getSetting, now } from './settings'

export interface Job {
  key: string // 收件箱里的单位：a12（压缩包）/ b3（同套）
  ids: number[]
  state: 'queued' | 'running' | 'password' | 'failed'
  pct: number
  reason?: Failure
  detail?: string
  need?: number // 磁盘空间不够时：要多少、还剩多少（字节）
  free?: number
}

interface Deps {
  db: Database.Database
  exe: string
  cipher: Cipher
  ops: FileOps
  onJobs(jobs: Job[]): void
  onFinished(gameId: number): void
  freeSpace?(dir: string): Promise<number> // 游戏目录所在磁盘还剩多少字节；测试里换成假的
}

const diskFree = async (dir: string) => {
  const s = await statfs(dir)
  return s.bavail * s.bsize
}

// 游戏文件夹里所有文件的相对路径，用 / 分隔
export async function listFolder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)).replace(/\\/g, '/'))
}

export function createExtractor({ db, exe, cipher, ops, onJobs, onFinished, freeSpace = diskFree }: Deps) {
  const jobs: Job[] = []
  const extra = new Map<string, { password?: string; save: boolean; action: PostExtractAction }>()
  let current: { key: string; abort: AbortController } | null = null

  // 失败的原因记在压缩包上，重开程序后也能显示（“先不解压”或解开后清掉）
  const setError = (ids: number[], err: object | null) => {
    const set = db.prepare('UPDATE archives SET last_error = ? WHERE id = ?')
    for (const id of ids) set.run(err && JSON.stringify(err), id)
  }
  // 上次没解开的：还在收件箱里的，按收件箱的单位（压缩包 / 同套）列成停着的任务。解压后处理没记住就先用“保留”，不动文件
  {
    const rows = db
      .prepare("SELECT id, bundle_id, last_error, needs_password FROM archives WHERE state = 'inbox' AND current_dir IS NOT NULL AND (last_error IS NOT NULL OR needs_password = 1) ORDER BY id")
      .all() as { id: number; bundle_id: number | null; last_error: string | null; needs_password: number }[]
    const members = db.prepare("SELECT id FROM archives WHERE bundle_id = ? AND state = 'inbox' AND current_dir IS NOT NULL ORDER BY id").pluck()
    const action = (getSetting(db, 'post_extract_action') as PostExtractAction | null) ?? 'keep'
    for (const r of rows) {
      const key = r.bundle_id !== null ? `b${r.bundle_id}` : `a${r.id}`
      if (jobs.some((j) => j.key === key)) continue
      const err = r.last_error ? (JSON.parse(r.last_error) as Pick<Job, 'reason' | 'detail' | 'need' | 'free'>) : { reason: 'wrong-password' as const }
      const ids = r.bundle_id !== null ? (members.all(r.bundle_id) as number[]) : [r.id]
      jobs.push({ key, ids, state: err.reason === 'wrong-password' ? 'password' : 'failed', pct: 0, ...err })
      extra.set(key, { save: false, action })
    }
  }

  const emit = () => onJobs(jobs.map((j) => ({ ...j })))

  async function pump() {
    if (current) return
    const job = jobs.find((j) => j.state === 'queued')
    if (!job) return
    const abort = new AbortController()
    current = { key: job.key, abort }
    job.state = 'running'
    job.pct = 0
    emit()
    try {
      const gameId = await runJob(job, extra.get(job.key)!, abort.signal)
      jobs.splice(jobs.indexOf(job), 1)
      extra.delete(job.key)
      onFinished(gameId)
    } catch (e) {
      const err = e instanceof ExtractError ? e : new ExtractError('other', String((e as Error)?.message ?? e))
      if (err.reason === 'cancelled') jobs.splice(jobs.indexOf(job), 1)
      else {
        const info = { reason: err.reason, detail: err.detail, ...err.space }
        Object.assign(job, { state: err.reason === 'wrong-password' ? 'password' : 'failed', ...info })
        setError(job.ids, info)
      }
    }
    current = null
    emit()
    pump()
  }

  async function runJob(job: Job, opt: { password?: string; save: boolean; action: PostExtractAction }, signal: AbortSignal): Promise<number> {
    const archiveDir = getSetting(db, 'archive_dir') as string
    const libraryDir = getSetting(db, 'library_dir') as string
    const members = job.ids.map((id) => {
      const row = db.prepare('SELECT current_dir, bundle_id FROM archives WHERE id = ?').get(id) as { current_dir: string | null; bundle_id: number | null }
      const vols = db.prepare('SELECT file_name AS name, size FROM volumes WHERE archive_id = ? ORDER BY seq').all(id) as FileEntry[]
      if (row.current_dir === null) throw new ExtractError('other', '压缩包找不到了')
      return { id, dir: row.current_dir, bundleId: row.bundle_id, stem: groupArchives(vols)[0].stem, volumes: vols.map((v) => v.name) }
    })
    const bundleId = members.length > 1 ? members[0].bundleId : null
    const name = bundleId !== null ? (db.prepare('SELECT name FROM bundles WHERE id = ?').pluck().get(bundleId) as string) : members[0].stem

    const tmp = join(libraryDir, `.butter-bell-extracting-${job.ids[0]}`)
    const used: { id: number; pw: PasswordTry }[] = []
    let folder: string
    try {
      await rm(tmp, { recursive: true, force: true }) // 上次中断留下的半截
      for (const [i, m] of members.entries()) {
        const file = join(archiveDir, m.dir, m.volumes[0])
        const tries = passwordCandidates(db, m.id, cipher)
        if (opt.password !== undefined) tries.unshift({ password: opt.password })
        let pw: PasswordTry | undefined
        let size = 0
        for (const t of tries) {
          const n = await probe(exe, file, t.password, signal)
          if (n !== null) {
            pw = t
            size = n
            break
          }
        }
        if (signal.aborted) throw new ExtractError('cancelled')
        if (!pw) {
          db.prepare('UPDATE archives SET needs_password = 1 WHERE id = ?').run(m.id)
          throw new ExtractError('wrong-password')
        }
        // .tar.zst 要先解出整个 tar 再解 tar，中间两份同时在盘上
        const need = /\.zst$/i.test(file) ? size * 2 : size
        const free = await freeSpace(libraryDir)
        if (need > free) throw new ExtractError('disk-full', '', { need, free })
        const target = bundleId !== null ? join(tmp, m.stem) : tmp
        await extract(exe, file, target, pw.password, (p) => {
          const pct = Math.floor(((i + p / 100) / members.length) * 100)
          if (pct !== job.pct) (job.pct = pct), emit()
        }, signal)
        await flatten(target)
        used.push({ id: m.id, pw })
      }
      folder = uniqueFolder(libraryDir, name, existsSync)
      await rename(tmp, join(libraryDir, folder))
    } catch (e) {
      await rm(tmp, { recursive: true, force: true }) // 只删我们自己刚解出来的临时文件夹
      throw e
    }

    const t = now()
    for (const u of used) {
      try {
        rememberPassword(db, u.id, u.pw, opt.save && u.pw.password === opt.password, cipher, t)
      } catch {
        // safeStorage 不可用时存不了密码，解压本身已经成功，不算失败
      }
    }
    const placed = []
    for (const m of members)
      placed.push({ id: m.id, subfolder: bundleId !== null ? m.stem : null, currentDir: await postExtract(opt.action, archiveDir, m.dir, m.volumes, ops) })
    const launch = rankLaunchFiles(await listFolder(join(libraryDir, folder)))
    return addGame(db, { folderName: folder, launchFile: launch.autoPick, launchCandidates: launch.candidates, members: placed }, t)
  }

  return {
    jobs: () => jobs.map((j) => ({ ...j })),
    start(units: { key: string; ids: number[] }[], action: PostExtractAction) {
      for (const u of units) {
        if (jobs.some((j) => j.key === u.key)) continue
        jobs.push({ key: u.key, ids: u.ids, state: 'queued', pct: 0 })
        extra.set(u.key, { save: false, action })
      }
      emit()
      pump()
    },
    // 失败或要密码的单位重新排队；password 是用户输入的，save = 要不要记住
    retry(key: string, password: string | undefined, save: boolean) {
      const job = jobs.find((j) => j.key === key && (j.state === 'failed' || j.state === 'password'))
      if (!job) return
      Object.assign(job, { state: 'queued', pct: 0, reason: undefined, detail: undefined, need: undefined, free: undefined })
      extra.set(key, { ...extra.get(key)!, password, save })
      emit()
      pump()
    },
    cancel(key: string) {
      if (current?.key === key) return current.abort.abort()
      const i = jobs.findIndex((j) => j.key === key)
      if (i < 0) return
      // 先不解压：不再记着失败原因，下次开程序也不列出来
      setError(jobs[i].ids, null)
      db.prepare(`UPDATE archives SET needs_password = 0 WHERE id IN (${jobs[i].ids.join()})`).run()
      jobs.splice(i, 1), extra.delete(key), emit()
    }
  }
}
