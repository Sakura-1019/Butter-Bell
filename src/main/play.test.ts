import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { addGame } from './extract'
import { closeUnfinished, endSession, heartbeat, startSession } from './play'
import { listGames } from './games'

let db: Database.Database, id: number
beforeEach(() => {
  db = openDb(':memory:')
  id = addGame(db, { folderName: 'A', launchFile: 'a.exe', members: [] }, '2026-11-01T00:00:00Z')
})
const sessions = () => db.prepare('SELECT started_at, ended_at, seconds FROM play_sessions ORDER BY id').all()
const game = () => listGames(db).find((g) => g.id === id)!

describe('游玩会话', () => {
  it('开始 → 心跳 → 结束：记开始、结束时间和秒数', () => {
    const s = startSession(db, id, '2026-11-03T10:00:00Z')
    heartbeat(db, s, '2026-11-03T10:00:30Z')
    endSession(db, s, '2026-11-03T10:05:07Z')
    expect(sessions()).toEqual([{ started_at: '2026-11-03T10:00:00Z', ended_at: '2026-11-03T10:05:07Z', seconds: 307 }])
  })

  it('“想玩”的游戏启动后改成“在玩”；“通关”的不动', () => {
    startSession(db, id, '2026-11-03T10:00:00Z')
    expect(game().playStatus).toBe('playing')
    db.prepare("UPDATE games SET play_status = 'completed'").run()
    startSession(db, id, '2026-11-03T11:00:00Z')
    expect(game().playStatus).toBe('completed')
  })

  it('程序崩溃留下的会话：下次启动时按最后一次心跳收尾；一次心跳都没有的记 0 秒', () => {
    const a = startSession(db, id, '2026-11-03T10:00:00Z')
    heartbeat(db, a, '2026-11-03T10:20:00Z')
    startSession(db, id, '2026-11-03T12:00:00Z')
    closeUnfinished(db)
    expect(sessions()).toEqual([
      { started_at: '2026-11-03T10:00:00Z', ended_at: '2026-11-03T10:20:00Z', seconds: 1200 },
      { started_at: '2026-11-03T12:00:00Z', ended_at: '2026-11-03T12:00:00Z', seconds: 0 }
    ])
  })

  it('总时长是所有会话之和，上次游玩取最后一次开始的时间；没玩过的是 0 和 null', () => {
    expect(game()).toMatchObject({ playSeconds: 0, lastPlayedAt: null })
    endSession(db, startSession(db, id, '2026-11-02T10:00:00Z'), '2026-11-02T11:00:00Z')
    endSession(db, startSession(db, id, '2026-11-03T10:00:00Z'), '2026-11-03T10:30:00Z')
    expect(game()).toMatchObject({ playSeconds: 5400, lastPlayedAt: '2026-11-03T10:00:00Z' })
  })

  it('正在运行的会话不算进总时长（界面按开始时间自己往上加），上次游玩已经算它', () => {
    endSession(db, startSession(db, id, '2026-11-02T10:00:00Z'), '2026-11-02T11:00:00Z')
    heartbeat(db, startSession(db, id, '2026-11-03T10:00:00Z'), '2026-11-03T10:10:00Z')
    expect(game()).toMatchObject({ playSeconds: 3600, lastPlayedAt: '2026-11-03T10:00:00Z' })
  })
})
