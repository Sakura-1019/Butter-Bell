// 0.2.0：版本号和封面来源在库里的部分
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseProduct } from '../core/dlsite'
import { migrate, openDb } from './db'
import { addGame } from './extract'
import { applyDlsite, applyManual, backfillVersions, listGames, setCover, setVersion, uninstall } from './games'
import { syncArchives } from './inbox'
import { addFolder } from './loose'
import init from './migrations/001-init.sql?raw'

const T = '2026-11-03T10:00:00Z'
const detail = parseProduct(readFileSync('src/core/fixtures/dlsite-product-RJ00473501.json', 'utf8'))!
let db: Database.Database
beforeEach(() => {
  db = openDb(':memory:')
})
const game = (id: number) => listGames(db).find((g) => g.id === id)!

describe('版本号', () => {
  const archive = (name: string) => {
    syncArchives(db, [{ name, size: name.length }], T)
    return db.prepare('SELECT id FROM archives WHERE first_volume_name = ?').pluck().get(name) as number
  }

  it('新游戏记下版本号', () => {
    const id = addGame(db, { folderName: 'Foo', launchFile: null, version: '1.05', members: [] }, T)
    expect(game(id).version).toBe('1.05')
  })

  it('重新接回时（新版本的压缩包）版本号跟着更新；手动改过的不再覆盖', () => {
    const a = archive('Foo ver1.0.rar')
    const id = addGame(db, { folderName: 'Foo', launchFile: null, version: '1.0', members: [{ id: a, subfolder: null, currentDir: '' }] }, T)
    uninstall(db, id, T)
    addGame(db, { folderName: 'Foo', launchFile: null, version: '1.1', members: [{ id: a, subfolder: null, currentDir: '' }] }, T)
    expect(game(id).version).toBe('1.1')

    setVersion(db, id, '1.1 修正版')
    uninstall(db, id, T)
    addGame(db, { folderName: 'Foo', launchFile: null, version: '1.2', members: [{ id: a, subfolder: null, currentDir: '' }] }, T)
    expect(game(id).version).toBe('1.1 修正版')
  })

  it('现成文件夹接回时同样更新', () => {
    const id = addFolder(db, { folderName: 'Bar', launchFile: null, launchCandidates: [], version: '0.4' }, T)
    expect(game(id).version).toBe('0.4')
    uninstall(db, id, T)
    addFolder(db, { folderName: 'Bar', launchFile: null, launchCandidates: [], version: '0.5' }, T)
    expect(game(id).version).toBe('0.5')
  })

  it('手动改成空的：清掉，也算手动', () => {
    const id = addGame(db, { folderName: 'Foo', launchFile: null, version: '1.0', members: [] }, T)
    setVersion(db, id, '  ')
    expect(game(id).version).toBeNull()
    expect(db.prepare('SELECT version_manual FROM games WHERE id = ?').pluck().get(id)).toBe(1)
  })

  it('补旧数据：先用压缩包名，取不到再用文件夹名；手动的、已有的不动', () => {
    const a = archive('Foo_v1_0_4.rar')
    const fromArchive = addGame(db, { folderName: 'Foo 2.0.0', launchFile: null, members: [{ id: a, subfolder: null, currentDir: '' }] }, T)
    const fromFolder = addGame(db, { folderName: 'Bar ver2.1', launchFile: null, members: [] }, T)
    const none = addGame(db, { folderName: 'Baz', launchFile: null, members: [] }, T)
    const manual = addGame(db, { folderName: 'Qux ver3', launchFile: null, members: [] }, T)
    setVersion(db, manual, '')
    backfillVersions(db)
    expect([fromArchive, fromFolder, none, manual].map((id) => game(id).version)).toEqual(['1.0.4', '2.1', null, null])
  })
})

describe('封面来源', () => {
  let id: number
  beforeEach(() => {
    id = addGame(db, { folderName: 'Foo', launchFile: null, members: [] }, T)
  })

  it('setCover 记下来源，返回被换掉的旧文件让调用方删', () => {
    expect(setCover(db, id, 'covers/1.png', 'screenshot')).toBeNull()
    expect(setCover(db, id, 'covers/2.png', 'folder')).toBe('covers/1.png')
    expect(game(id)).toMatchObject({ coverFile: 'covers/2.png', coverSource: 'folder' })
  })

  it('DLsite：给了封面就写成 dlsite；不给（保留手选的）就不动封面', () => {
    applyDlsite(db, id, detail, 'covers/d.jpg', [])
    expect(game(id)).toMatchObject({ coverFile: 'covers/d.jpg', coverSource: 'dlsite' })
    setCover(db, id, 'covers/m.png', 'manual')
    applyDlsite(db, id, detail, null, [])
    expect(game(id)).toMatchObject({ coverFile: 'covers/m.png', coverSource: 'manual', needsMetadata: false })
  })

  it('手动填写：manual', () => {
    applyManual(db, id, 'x', 'covers/x.png')
    expect(game(id).coverSource).toBe('manual')
  })

  it('升级旧数据库：选过 DLsite 的记成 dlsite，其余有封面的记成 manual', () => {
    const old = new Database(':memory:')
    old.exec(init)
    old.pragma('user_version = 3') // 002、003 跟这次无关，直接从 3 往上迁
    old.exec("ALTER TABLE common_passwords ADD COLUMN position INTEGER NOT NULL DEFAULT 0; ALTER TABLE archives ADD COLUMN last_error TEXT")
    const add = old.prepare("INSERT INTO games (title, folder_name, cover_file, source_kind, added_at) VALUES ('t', ?, ?, ?, 'x')")
    add.run('a', 'covers/a.jpg', 'dlsite')
    add.run('b', 'covers/b.png', 'manual')
    add.run('c', null, null)
    migrate(old)
    expect(old.prepare('SELECT cover_source FROM games ORDER BY id').pluck().all()).toEqual(['dlsite', 'manual', null])
  })
})

it('解压到游戏目录外（存完整路径）：名称只用文件夹名，选 DLsite 候选时照样换成 DLsite 的名字', () => {
  const id = addGame(db, { folderName: String.raw`D:\Games\Foo`, launchFile: null, members: [] }, T)
  expect(game(id).title).toBe('Foo')
  applyDlsite(db, id, detail, null, [])
  expect(game(id).title).toBe(detail.title)
})
