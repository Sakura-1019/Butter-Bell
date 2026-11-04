// 解压队列从头到尾：仓库目录里的小压缩包 → 游戏目录里的游戏文件夹 → games 表
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { syncArchives } from './inbox'
import { createExtractor, type Job } from './extractor'
import { setSetting } from './settings'

const EXE = resolve('resources/7zip/7z.exe')
const cipher = { encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() }
let root: string, db: Database.Database
const at = (...p: string[]) => join(root, ...p)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-ex-'))
  for (const d of ['src/Foo', 'repo', 'lib']) mkdirSync(at(d), { recursive: true })
  writeFileSync(at('src/Foo/Game.exe'), 'exe')
  mkdirSync(at('src/Foo/www'))
  writeFileSync(at('src/Foo/www/index.html'), '')
  const pack = (args: string[]) => execFileSync(EXE, ['a', '-bso0', ...args, 'Foo'], { cwd: at('src') })
  pack([at('repo/Foo.zip')])
  pack(['-psecret', '-mhe=on', at('repo/Locked.7z')])
  mkdirSync(at('lib/Foo')) // 游戏目录里已经有同名文件夹
  db = openDb(':memory:')
  setSetting(db, 'archive_dir', at('repo'))
  setSetting(db, 'library_dir', at('lib'))
  syncArchives(db, readdirSync(at('repo')).map((name) => ({ name, size: statSync(at('repo', name)).size })), '2026-11-03T00:00:00Z')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup(freeSpace?: (dir: string) => Promise<number>) {
  let jobs: Job[] = []
  const finished: number[] = []
  const trashed: string[] = []
  const ex = createExtractor({
    db,
    exe: EXE,
    cipher,
    ops: { trash: async (p) => void trashed.push(p), move: async () => {}, exists: existsSync },
    onJobs: (j) => (jobs = j),
    onFinished: (id) => finished.push(id),
    freeSpace
  })
  const idle = () => new Promise<void>((r) => { const t = setInterval(() => jobs.every((j) => j.state !== 'queued' && j.state !== 'running') && (clearInterval(t), r()), 20) })
  return { ex, jobs: () => jobs, finished, trashed, idle }
}
const idOf = (name: string) => db.prepare('SELECT id FROM archives WHERE first_volume_name = ?').pluck().get(name) as number

it('解到游戏目录：重名加后缀、单个顶层文件夹往上提、自动选中启动文件、按设置处理压缩包', async () => {
  const s = setup()
  s.ex.start([{ key: 'a1', ids: [idOf('Foo.zip')] }], 'recycle')
  await s.idle()
  expect(s.finished).toHaveLength(1)
  expect(readdirSync(at('lib')).sort()).toEqual(['Foo', 'Foo (2)'])
  expect(readdirSync(at('lib', 'Foo (2)')).sort()).toEqual(['Game.exe', 'www'])
  expect(db.prepare('SELECT folder_name, launch_file FROM games').get()).toEqual({ folder_name: 'Foo (2)', launch_file: 'Game.exe' })
  expect(s.trashed).toEqual([at('repo', 'Foo.zip')])
  expect(db.prepare('SELECT state, current_dir FROM archives WHERE id = ?').get(idOf('Foo.zip'))).toEqual({ state: 'extracted', current_dir: null })
})

it('加密的包：常用密码都不对时停在“要密码”，输入对的密码并保存后解开，密码进常用表', async () => {
  const s = setup()
  s.ex.start([{ key: 'a2', ids: [idOf('Locked.7z')] }], 'keep')
  await s.idle()
  expect(s.jobs()).toMatchObject([{ key: 'a2', state: 'password' }])
  expect(readdirSync(at('lib'))).toEqual(['Foo']) // 没留下半截临时文件夹

  s.ex.retry('a2', 'wrong', true)
  await s.idle()
  expect(s.jobs()).toMatchObject([{ state: 'password' }])

  s.ex.retry('a2', 'secret', true)
  await s.idle()
  expect(s.jobs()).toEqual([])
  expect(readdirSync(at('lib')).sort()).toEqual(['Foo', 'Locked'])
  expect(db.prepare('SELECT password_cipher FROM common_passwords').pluck().all().map(String)).toEqual(['secret'])
  expect(db.prepare('SELECT current_dir FROM archives WHERE id = ?').pluck().get(idOf('Locked.7z'))).toBe('') // 保留
})

it('同套：解到一个文件夹，每个压缩包一个子文件夹', async () => {
  db.prepare("INSERT INTO bundles (id, name, created_at) VALUES (1, 'Set', '')").run()
  db.prepare('UPDATE archives SET bundle_id = 1').run()
  db.prepare('UPDATE archives SET password_cipher = ? WHERE first_volume_name = ?').run(Buffer.from('secret'), 'Locked.7z')
  const s = setup()
  s.ex.start([{ key: 'b1', ids: [idOf('Foo.zip'), idOf('Locked.7z')] }], 'keep')
  await s.idle()
  expect(readdirSync(at('lib', 'Set')).sort()).toEqual(['Foo', 'Locked'])
  expect(db.prepare('SELECT subfolder FROM archives ORDER BY id').pluck().all()).toEqual(['Foo', 'Locked'])
})

it('解压前先查磁盘空间：要的比剩的多就不解，告诉界面要多少、还剩多少', async () => {
  let s = setup(async () => 2) // 包里一共 3 字节（Game.exe）
  s.ex.start([{ key: 'a1', ids: [idOf('Foo.zip')] }], 'keep')
  await s.idle()
  expect(s.jobs()).toMatchObject([{ reason: 'disk-full', need: 3, free: 2 }])
  s = setup(async () => 3) // 重开以后这一项还在，点“重试”
  s.ex.retry('a1', undefined, false)
  await s.idle()
  expect(s.finished).toHaveLength(1)
})

describe('重开程序后还能看到解压失败和要密码', () => {
  it('要密码、失败的状态记在库里，新开的队列直接列出来；输对密码照常解开', async () => {
    const a = setup()
    a.ex.start([{ key: 'a2', ids: [idOf('Locked.7z')] }], 'keep')
    await a.idle()
    const b = setup(async () => 1) // 相当于重开程序
    expect(b.ex.jobs()).toMatchObject([{ key: 'a2', ids: [idOf('Locked.7z')], state: 'password', reason: 'wrong-password' }])
    b.ex.start([{ key: 'a1', ids: [idOf('Foo.zip')] }], 'keep')
    await b.idle()
    const c = setup(async () => 1e12)
    expect(c.ex.jobs()).toMatchObject([
      { key: 'a1', state: 'failed', reason: 'disk-full', free: 1 },
      { key: 'a2', state: 'password' }
    ])
    c.ex.retry('a2', 'secret', false)
    await c.idle()
    expect(readdirSync(at('lib')).sort()).toEqual(['Foo', 'Locked'])
    expect(setup().ex.jobs().map((j) => j.key)).toEqual(['a1']) // 解开的不再列出来
  })

  it('同套：按同套列成一项', async () => {
    db.prepare("INSERT INTO bundles (id, name, created_at) VALUES (1, 'Set', '')").run()
    db.prepare('UPDATE archives SET bundle_id = 1').run()
    const a = setup()
    a.ex.start([{ key: 'b1', ids: [idOf('Foo.zip'), idOf('Locked.7z')] }], 'keep')
    await a.idle()
    expect(setup().ex.jobs()).toMatchObject([{ key: 'b1', ids: [idOf('Foo.zip'), idOf('Locked.7z')], state: 'password' }])
  })

  it('点了“先不解压”：记录清掉，下次不再列出来', async () => {
    const a = setup()
    a.ex.start([{ key: 'a2', ids: [idOf('Locked.7z')] }], 'keep')
    await a.idle()
    a.ex.cancel('a2')
    expect(setup().ex.jobs()).toEqual([])
  })
})

it('双击弹窗：这一次单独给密码、解压位置和处理方式；游戏目录外的位置记完整路径，版本号从包名取', async () => {
  mkdirSync(at('other'))
  db.prepare("UPDATE archives SET first_volume_name = 'Locked ver1.05.7z' WHERE first_volume_name = 'Locked.7z'").run()
  db.prepare("UPDATE volumes SET file_name = 'Locked ver1.05.7z' WHERE file_name = 'Locked.7z'").run()
  const { renameSync } = await import('node:fs')
  renameSync(at('repo/Locked.7z'), at('repo/Locked ver1.05.7z'))
  const s = setup()
  s.ex.start([{ key: 'a2', ids: [idOf('Locked ver1.05.7z')], password: 'secret', save: false, target: at('other'), action: 'keep' }], 'recycle')
  await s.idle()
  expect(s.jobs()).toEqual([])
  expect(readdirSync(at('other'))).toEqual(['Locked ver1.05'])
  expect(db.prepare('SELECT title, folder_name, version FROM games').get()).toEqual({ title: 'Locked ver1.05', folder_name: at('other', 'Locked ver1.05'), version: '1.05' })
  expect(s.trashed).toEqual([]) // 这一次选的是保留
  expect(db.prepare('SELECT COUNT(*) FROM common_passwords').pluck().get()).toBe(0) // 没勾记住
})
