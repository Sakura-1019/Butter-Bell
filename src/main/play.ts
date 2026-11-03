// 游玩会话在数据库上的部分。游戏跑着时定期心跳写 seconds，程序崩溃了下次启动也能按最后一次心跳收尾。
import type Database from 'better-sqlite3'

const secondsBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))

export function startSession(db: Database.Database, gameId: number, now: string): number {
  return db.transaction(() => {
    db.prepare("UPDATE games SET play_status = 'playing' WHERE id = ? AND play_status = 'wishlist'").run(gameId)
    return Number(db.prepare('INSERT INTO play_sessions (game_id, started_at, seconds) VALUES (?, ?, 0)').run(gameId, now).lastInsertRowid)
  })()
}

export function heartbeat(db: Database.Database, sessionId: number, now: string): void {
  const started = db.prepare('SELECT started_at FROM play_sessions WHERE id = ?').pluck().get(sessionId) as string
  db.prepare('UPDATE play_sessions SET seconds = ? WHERE id = ? AND ended_at IS NULL').run(secondsBetween(started, now), sessionId)
}

export function endSession(db: Database.Database, sessionId: number, now: string): void {
  heartbeat(db, sessionId, now)
  db.prepare('UPDATE play_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(now, sessionId)
}

// 启动时调用：上次没正常结束的会话，结束时间记成最后一次心跳
export function closeUnfinished(db: Database.Database): void {
  const open = db.prepare('SELECT id, started_at, seconds FROM play_sessions WHERE ended_at IS NULL').all() as { id: number; started_at: string; seconds: number | null }[]
  const close = db.prepare('UPDATE play_sessions SET ended_at = ?, seconds = ? WHERE id = ?')
  for (const s of open) {
    const seconds = s.seconds ?? 0
    close.run(new Date(Date.parse(s.started_at) + seconds * 1000).toISOString().slice(0, 19) + 'Z', seconds, s.id)
  }
}
