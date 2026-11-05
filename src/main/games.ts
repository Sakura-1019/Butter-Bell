// 游戏库：列出游戏，把 DLsite 选定的候选或手动填写的资料写进去（见 docs/schema-draft.md 的“从 DLsite 选定候选”）。
import type Database from 'better-sqlite3'
import { workUrl, type ProductDetail } from '../core/dlsite'
import type { CoverSource } from '../core/cover'
import { extractVersion } from '../core/version'
import { groupArchives, type FileEntry } from '../core/volumes'

export interface GameCard {
  id: number
  title: string
  folderName: string
  coverFile: string | null // 相对于数据目录
  coverSource: CoverSource | null
  version: string | null
  launchFile: string | null
  needsMetadata: boolean // 待补资料
  dlsiteUrl: string | null // 信息来自 DLsite 时的作品页，详情页一键打开
  sourceKind: 'dlsite' | 'manual' | null // 信息从哪来；null = 待补信息
  sourceRef: string | null // dlsite：RJ 号
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
    coverSource: g.cover_source,
    version: g.version,
    launchFile: g.launch_file,
    needsMetadata: g.source_kind === null,
    dlsiteUrl: g.source_kind === 'dlsite' ? workUrl(g.source_ref) : null,
    sourceKind: g.source_kind,
    sourceRef: g.source_ref,
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

// tags：用户在候选界面里勾上的 DLsite 类型词，没勾的不写。coverFile 为 null = 保留现在的封面（用户手选的、没勾“同时换封面”）
// title：用户在识别页拼好、确认过的名称，总是写进去；原名照旧存 DLsite 的完整名字
export function applyDlsite(db: Database.Database, gameId: number, d: ProductDetail, coverFile: string | null, tags: string[], title: string): void {
  if (!title.trim()) throw new Error('名称不能是空的')
  db.transaction(() => {
    db.prepare(
      `UPDATE games SET title = @title, original_title = @original, circle = @circle, description = @description,
        source_kind = 'dlsite', source_ref = @code WHERE id = @gameId`
    ).run({ title: title.trim(), original: d.title, circle: d.circle, description: d.description, code: d.code, gameId })
    if (coverFile) setCover(db, gameId, coverFile, 'dlsite')
    for (const t of tags) addTag(db, gameId, t)
  })()
}

// 换封面并记下来源，返回被换掉的旧文件（相对于数据目录），调用方去删
export function setCover(db: Database.Database, gameId: number, coverFile: string, source: CoverSource): string | null {
  const old = db.prepare('SELECT cover_file FROM games WHERE id = ?').pluck().get(gameId) as string | null
  db.prepare('UPDATE games SET cover_file = ?, cover_source = ? WHERE id = ?').run(coverFile, source, gameId)
  return old && old !== coverFile ? old : null
}

// 详情页手动改版本号：以后接回新版本也不再自动覆盖。空的 = 清掉
export function setVersion(db: Database.Database, gameId: number, version: string): void {
  db.prepare('UPDATE games SET version = ?, version_manual = 1 WHERE id = ?').run(version.trim() || null, gameId)
}

// 0.2.0 以前进库的游戏没有版本号：先从压缩包名取，取不到再用文件夹名。手动改过的不动
export function backfillVersions(db: Database.Database): void {
  const games = db.prepare('SELECT id, folder_name FROM games WHERE version IS NULL AND version_manual = 0').all() as { id: number; folder_name: string }[]
  const archives = db.prepare('SELECT id FROM archives WHERE game_id = ? ORDER BY id').pluck()
  const vols = db.prepare('SELECT file_name AS name, size FROM volumes WHERE archive_id = ? ORDER BY seq')
  const set = db.prepare('UPDATE games SET version = ? WHERE id = ?')
  db.transaction(() => {
    for (const g of games) {
      const names = (archives.all(g.id) as number[]).map((a) => groupArchives(vols.all(a) as FileEntry[])[0]?.stem).filter(Boolean) as string[]
      const v = [...names, g.folder_name].map(extractVersion).find((x) => x !== null)
      if (v) set.run(v, g.id)
    }
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

// coverFile 为 null：没选封面，只写名称，现在的封面和它的来源都不动（封面是可选的）
export function applyManual(db: Database.Database, gameId: number, title: string, coverFile: string | null): void {
  if (!title.trim()) throw new Error('名称不能是空的')
  db.prepare("UPDATE games SET title = ?, source_kind = 'manual', source_ref = NULL WHERE id = ?").run(title.trim(), gameId)
  if (coverFile) db.prepare("UPDATE games SET cover_file = ?, cover_source = 'manual' WHERE id = ?").run(coverFile, gameId)
}
