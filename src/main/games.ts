// 游戏库：列出游戏，把 DLsite 选定的候选或手动填写的资料写进去（见 docs/schema-draft.md 的“从 DLsite 选定候选”）。
import type Database from 'better-sqlite3'
import type { ProductDetail } from '../core/dlsite'

export interface GameCard {
  id: number
  title: string
  folderName: string
  coverFile: string | null // 相对于数据目录
  launchFile: string | null
  needsMetadata: boolean // 待补资料
  circle: string | null
  playStatus: 'playing' | 'wishlist' | 'completed'
  uninstalled: boolean // ADR 0004：和游玩状态分开记
  useLocaleEmulator: boolean
  tags: string[]
  playSeconds: number // 游玩时长：只算已结束的会话，正在运行的那段界面按开始时间自己加
  lastPlayedAt: string | null // 上次游玩：最后一次会话的开始时间
  addedAt: string
}

// 已卸载的也列出来：记录还在，书架上单独一排
export function listGames(db: Database.Database): GameCard[] {
  const rows = db
    .prepare(
      `SELECT g.*, (SELECT COALESCE(SUM(seconds), 0) FROM play_sessions WHERE game_id = g.id AND ended_at IS NOT NULL) AS play_seconds,
        (SELECT MAX(started_at) FROM play_sessions WHERE game_id = g.id) AS last_played,
        (SELECT json_group_array(name) FROM (SELECT t.name FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.game_id = g.id ORDER BY t.name)) AS tag_list
      FROM games g ORDER BY g.added_at DESC, g.id DESC`
    )
    .all() as Record<string, never>[]
  return rows.map((g) => ({
    id: g.id,
    title: g.title,
    folderName: g.folder_name,
    coverFile: g.cover_file,
    launchFile: g.launch_file,
    needsMetadata: g.source_kind === null,
    circle: g.circle,
    playStatus: g.play_status,
    uninstalled: g.uninstalled_at !== null,
    useLocaleEmulator: g.use_locale_emulator === 1,
    tags: JSON.parse(g.tag_list),
    playSeconds: g.play_seconds,
    lastPlayedAt: g.last_played,
    addedAt: g.added_at
  }))
}

// tags：用户在候选界面里勾上的 DLsite 类型词，没勾的不写
export function applyDlsite(db: Database.Database, gameId: number, d: ProductDetail, coverFile: string, tags: string[]): void {
  db.transaction(() => {
    // 名称只在还是文件夹名（没被用户改过）时才换成 DLsite 的名字
    db.prepare(
      `UPDATE games SET title = CASE WHEN title = folder_name THEN @title ELSE title END,
        original_title = @title, circle = @circle, description = @description, cover_file = @coverFile,
        source_kind = 'dlsite', source_ref = @code WHERE id = @gameId`
    ).run({ title: d.title, circle: d.circle, description: d.description, coverFile, code: d.code, gameId })
    for (const t of tags) addTag(db, gameId, t)
  })()
}

// 标签名不分大小写：已有同名的就复用它
export function addTag(db: Database.Database, gameId: number, name: string): void {
  const t = name.trim()
  if (!t) return
  db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT (name) DO NOTHING').run(t)
  db.prepare('INSERT OR IGNORE INTO game_tags (game_id, tag_id) SELECT ?, id FROM tags WHERE name = ?').run(gameId, t)
}

// 没有游戏再用的标签一起删掉，侧栏里不留空标签
export function removeTag(db: Database.Database, gameId: number, name: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM game_tags WHERE game_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)').run(gameId, name)
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM game_tags)').run()
  })()
}

// 游戏文件夹已经进了回收站之后调用：记录留着，压缩包回到收件箱，重新解压时接回（ADR 0004）
export function uninstall(db: Database.Database, gameId: number, now: string): void {
  db.transaction(() => {
    db.prepare('UPDATE games SET uninstalled_at = ? WHERE id = ?').run(now, gameId)
    db.prepare("UPDATE archives SET state = 'inbox' WHERE game_id = ?").run(gameId)
  })()
}

// 彻底移除记录：只对已卸载的游戏。会话和标签关联跟着删，压缩包的 game_id 变 NULL。返回封面文件（相对于数据目录），调用方去删
export function purge(db: Database.Database, gameId: number): string | null {
  return db.transaction(() => {
    const g = db.prepare('SELECT cover_file, uninstalled_at FROM games WHERE id = ?').get(gameId) as { cover_file: string | null; uninstalled_at: string | null } | undefined
    if (!g?.uninstalled_at) throw new Error('先卸载才能彻底移除记录')
    db.prepare('DELETE FROM games WHERE id = ?').run(gameId)
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM game_tags)').run()
    return g.cover_file
  })()
}

export function applyManual(db: Database.Database, gameId: number, title: string, coverFile: string): void {
  db.prepare("UPDATE games SET title = ?, cover_file = ?, source_kind = 'manual', source_ref = NULL WHERE id = ?").run(title.trim(), coverFile, gameId)
}
