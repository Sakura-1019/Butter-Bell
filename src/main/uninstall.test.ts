// 卸载、接回、彻底移除记录、标签增删（ADR 0004、docs/schema-draft.md 的“卸载”“接回”）
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { listInbox, syncArchives } from './inbox'
import { addGame, reattachTarget } from './extract'
import { addTag, listGames, purge, removeTag, uninstall } from './games'
import { endSession, startSession } from './play'

const T = '2026-11-03T10:00:00Z'
let db: Database.Database, archive: number, id: number
beforeEach(() => {
  db = openDb(':memory:')
  syncArchives(db, [{ name: 'Foo.rar', size: 100 }], T)
  archive = db.prepare('SELECT id FROM archives').pluck().get() as number
  id = addGame(db, { folderName: 'Foo', launchFile: 'bin/Game.exe', members: [{ id: archive, subfolder: null, currentDir: '' }] }, T)
})
const game = (gid = id) => listGames(db).find((g) => g.id === gid)!
const gameCount = () => db.prepare('SELECT COUNT(*) FROM games').pluck().get()

describe('卸载', () => {
  it('标成已卸载，游玩状态、标签、时长都留着；压缩包回到收件箱等着重新解压', () => {
    db.prepare("UPDATE games SET play_status = 'completed'").run()
    addTag(db, id, 'RPG')
    endSession(db, startSession(db, id, T), '2026-11-03T11:00:00Z')
    expect(listInbox(db)).toEqual([])
    uninstall(db, id, T)
    expect(game()).toMatchObject({ uninstalled: true, playStatus: 'completed', tags: ['RPG'], playSeconds: 3600 })
    expect(listInbox(db)).toMatchObject([{ id: archive, reattach: 'Foo' }]) // 收件箱里提示会接回哪个游戏
  })
})

describe('接回', () => {
  beforeEach(() => uninstall(db, id, T))

  it('重新解压同一个压缩包：接回原来的记录，不建新游戏', () => {
    expect(reattachTarget(db, [archive])).toBe(id)
    const again = addGame(db, { folderName: 'Foo (2)', launchFile: null, launchCandidates: ['bin/Game.exe', 'x.exe'], members: [{ id: archive, subfolder: null, currentDir: '' }] }, '2026-11-04T00:00:00Z')
    expect(again).toBe(id)
    expect(gameCount()).toBe(1)
    expect(game()).toMatchObject({ uninstalled: false, folderName: 'Foo (2)', launchFile: 'bin/Game.exe' })
    expect(listInbox(db)).toEqual([])
  })

  it('原来的启动文件在新文件夹里没有了：换成这次自动选中的', () => {
    addGame(db, { folderName: 'Foo', launchFile: 'Game.exe', launchCandidates: ['Game.exe'], members: [{ id: archive, subfolder: null, currentDir: '' }] }, T)
    expect(game().launchFile).toBe('Game.exe')
  })

  it('压缩包指向的游戏没卸载、或者被彻底移除了：建新游戏', () => {
    purge(db, id)
    expect(reattachTarget(db, [archive])).toBeNull()
    const fresh = addGame(db, { folderName: 'Foo', launchFile: null, members: [{ id: archive, subfolder: null, currentDir: '' }] }, T)
    expect(game(fresh)).toMatchObject({ uninstalled: false, playSeconds: 0 })
    expect(reattachTarget(db, [archive])).toBeNull() // 指向的是没卸载的新游戏
  })
})

describe('彻底移除记录', () => {
  it('只能移除已卸载的游戏；会话和标签关联一起删，压缩包留在收件箱', () => {
    expect(() => purge(db, id)).toThrow()
    addTag(db, id, 'RPG')
    endSession(db, startSession(db, id, T), T)
    uninstall(db, id, T)
    purge(db, id)
    expect(gameCount()).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM play_sessions').pluck().get()).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM game_tags').pluck().get()).toBe(0)
    expect(listInbox(db).map((e) => e.id)).toEqual([archive])
  })
})

describe('标签增删', () => {
  it('同名标签不分大小写复用，空白去掉，空的不加，重复加只有一个', () => {
    const other = addGame(db, { folderName: 'Bar', launchFile: null, members: [] }, T)
    addTag(db, id, ' RPG ')
    addTag(db, other, 'rpg')
    addTag(db, id, 'RPG')
    addTag(db, id, '   ')
    expect(game().tags).toEqual(['RPG'])
    expect(game(other).tags).toEqual(['RPG'])
    expect(db.prepare('SELECT COUNT(*) FROM tags').pluck().get()).toBe(1)
  })

  it('移除标签；没有游戏再用的标签一起删掉', () => {
    const other = addGame(db, { folderName: 'Bar', launchFile: null, members: [] }, T)
    addTag(db, id, 'RPG')
    addTag(db, other, 'RPG')
    removeTag(db, id, 'rpg')
    expect(game().tags).toEqual([])
    expect(db.prepare('SELECT COUNT(*) FROM tags').pluck().get()).toBe(1)
    removeTag(db, other, 'RPG')
    expect(db.prepare('SELECT COUNT(*) FROM tags').pluck().get()).toBe(0)
  })
})
