// 现成文件夹：游戏目录里还没进库的文件夹（GLOSSARY.md 的“现成文件夹”、docs/schema-draft.md 的“收件箱”“接回”）
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { listInbox, syncArchives } from './inbox'
import { addGame } from './extract'
import { listGames, uninstall } from './games'
import { addFolder, ignoreFolders, looseFolders } from './loose'

const T = '2026-11-03T10:00:00Z'
let db: Database.Database
beforeEach(() => {
  db = openDb(':memory:')
})
const game = (id: number) => listGames(db).find((g) => g.id === id)!

describe('looseFolders', () => {
  it('库里没有的文件夹是现成文件夹；跳过以 . 开头的临时文件夹和系统文件夹', () => {
    addGame(db, { folderName: 'LAB-Still Bright-', launchFile: null, members: [] }, T)
    const r = looseFolders(db, ['LAB-Still Bright-', 'Copper Lantern 2', '.butter-bell-extracting-12', '$RECYCLE.BIN', 'System Volume Information', '星読聖女_demo_0.2.0'])
    expect(r).toEqual({ loose: ['Copper Lantern 2', '星読聖女_demo_0.2.0'], reattach: [] })
  })

  it('不分大小写：文件夹名大小写变了也算库里的', () => {
    addGame(db, { folderName: 'Foo', launchFile: null, members: [] }, T)
    expect(looseFolders(db, ['FOO']).loose).toEqual([])
  })

  it('和已卸载游戏同名的文件夹要接回，不进收件箱', () => {
    const id = addGame(db, { folderName: 'Foo', launchFile: null, members: [] }, T)
    uninstall(db, id, T)
    expect(looseFolders(db, ['Foo', 'Bar'])).toEqual({ loose: ['Bar'], reattach: [{ gameId: id, folder: 'Foo' }] })
  })

  it('忽略过的文件夹不出现', () => {
    ignoreFolders(db, ['Bar'], true, T)
    expect(looseFolders(db, ['Bar', 'Baz']).loose).toEqual(['Baz'])
    ignoreFolders(db, ['Bar'], false, T)
    expect(looseFolders(db, ['Bar', 'Baz']).loose).toEqual(['Bar', 'Baz'])
  })
})

describe('listInbox 带上现成文件夹', () => {
  it('现成文件夹排在压缩包前面', () => {
    syncArchives(db, [{ name: 'Foo.rar', size: 1 }], T)
    expect(listInbox(db, ['Copper Lantern 2'])).toMatchObject([
      { kind: 'folder', id: 'Copper Lantern 2', name: 'Copper Lantern 2' },
      { kind: 'archive', name: 'Foo' }
    ])
  })
})

describe('addFolder', () => {
  it('新游戏：名称先用文件夹名，状态想玩，待补资料', () => {
    const id = addFolder(db, { folderName: 'Copper Lantern 2', launchFile: 'Game.exe', launchCandidates: ['Game.exe'] }, T)
    expect(game(id)).toMatchObject({ title: 'Copper Lantern 2', folderName: 'Copper Lantern 2', launchFile: 'Game.exe', playStatus: 'wishlist', needsMetadata: true, uninstalled: false })
    expect(looseFolders(db, ['Copper Lantern 2']).loose).toEqual([])
  })

  it('接回已卸载的游戏：资料和启动文件都沿用；它的压缩包不再留在收件箱', () => {
    syncArchives(db, [{ name: 'Foo.rar', size: 1 }], T)
    const id = addGame(db, { folderName: 'Foo', launchFile: 'bin/Game.exe', members: [{ id: 1, subfolder: null, currentDir: '' }] }, T)
    db.prepare("UPDATE games SET title = '好游戏', play_status = 'completed'").run()
    uninstall(db, id, T)
    expect(listInbox(db)).toHaveLength(1)
    expect(addFolder(db, { folderName: 'Foo', launchFile: null, launchCandidates: ['bin/Game.exe', 'x.exe'] }, T)).toBe(id)
    expect(game(id)).toMatchObject({ title: '好游戏', playStatus: 'completed', launchFile: 'bin/Game.exe', uninstalled: false })
    expect(listGames(db)).toHaveLength(1)
    expect(listInbox(db)).toEqual([])
  })

  it('接回时原来的启动文件没了：换成这次自动选中的', () => {
    const id = addGame(db, { folderName: 'Foo', launchFile: 'old.exe', members: [] }, T)
    uninstall(db, id, T)
    addFolder(db, { folderName: 'Foo', launchFile: 'new.exe', launchCandidates: ['new.exe'] }, T)
    expect(game(id).launchFile).toBe('new.exe')
  })

  it('新加入和接回的都进“最近解压”', () => {
    const a = addFolder(db, { folderName: 'A', launchFile: null, launchCandidates: [] }, T)
    expect(game(a).recentExtractAt).toBe(T)
    const id = addGame(db, { folderName: 'Foo', launchFile: null, members: [] }, T)
    db.prepare('UPDATE games SET recent_extract_at = NULL').run()
    uninstall(db, id, T)
    addFolder(db, { folderName: 'Foo', launchFile: null, launchCandidates: [] }, '2026-11-09T00:00:00Z')
    expect(game(id).recentExtractAt).toBe('2026-11-09T00:00:00Z')
  })
})
