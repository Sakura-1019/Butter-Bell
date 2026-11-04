// 收件箱：把仓库目录的扫描结果写进 archives / volumes，再现算出收件箱条目（见 docs/schema-draft.md）。
import type Database from 'better-sqlite3'
import { groupArchives, type Archive, type FileEntry } from '../core/volumes'
import { bundleName, suggestBundles } from '../core/bundles'

export interface InboxArchive {
  kind: 'archive'
  id: number
  name: string // stem，界面上显示的名字
  format: string
  size: number
  volumes: string[]
  missing: number[]
  modifiedAt: string // 下载时间：分卷里最新的修改时间（旧数据还没扫到时先用加入时间）
  firstSeenAt: string // 加入时间
  reattach?: string // 解压后会接回的已卸载游戏的名称
}
export interface InboxGroup {
  kind: 'bundle' | 'suggestion' // 已确认的同套 / 还没决定的同套建议
  id: string
  name: string
  size: number
  members: InboxArchive[]
}
// 游戏目录里的现成文件夹：不用解压，直接加入（见 loose.ts）
export interface InboxFolder {
  kind: 'folder'
  id: string // 文件夹名
  name: string
}
export type InboxEntry = InboxArchive | InboxGroup | InboxFolder

// 只看仓库目录根下的文件（current_dir = ''）。ADR 0001：首个分卷名 + 总大小相同就是同一个压缩包。
export function syncArchives(db: Database.Database, files: FileEntry[], now: string): void {
  const find = db.prepare('SELECT id FROM archives WHERE first_volume_name = ? AND total_size = ?').pluck()
  const insert = db.prepare("INSERT INTO archives (first_volume_name, total_size, format, current_dir, first_seen_at) VALUES (?, ?, ?, '', ?)")
  const back = db.prepare("UPDATE archives SET current_dir = '' WHERE id = ?")
  const clearVolumes = db.prepare('DELETE FROM volumes WHERE archive_id = ?')
  const addVolume = db.prepare('INSERT INTO volumes (archive_id, seq, file_name, size, modified_at) VALUES (?, ?, ?, ?, ?)')
  const gone = db.prepare("UPDATE archives SET current_dir = NULL WHERE id = ?")

  db.transaction(() => {
    const seen = new Set<number>()
    for (const a of groupArchives(files)) {
      let id = find.get(a.firstVolumeName, a.totalSize) as number | undefined
      if (id === undefined) id = Number(insert.run(a.firstVolumeName, a.totalSize, a.format, now).lastInsertRowid)
      else back.run(id)
      clearVolumes.run(id)
      a.volumes.forEach((v, i) => addVolume.run(id, i + 1, v.name, v.size, v.mtime ?? null))
      seen.add(id)
    }
    for (const id of db.prepare("SELECT id FROM archives WHERE current_dir = ''").pluck().all() as number[])
      if (!seen.has(id)) gone.run(id)
  })()
}

// folders：looseFolders 算出来的现成文件夹，排在压缩包前面
export function listInbox(db: Database.Database, folders: string[] = []): InboxEntry[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.bundle_id, a.first_seen_at, COALESCE((SELECT MAX(modified_at) FROM volumes WHERE archive_id = a.id), a.first_seen_at) AS modified_at,
        g.title AS reattach FROM archives a LEFT JOIN games g ON g.id = a.game_id AND g.uninstalled_at IS NOT NULL
      WHERE a.state = 'inbox' AND a.current_dir IS NOT NULL ORDER BY a.first_seen_at DESC, a.first_volume_name`
    )
    .all() as { id: number; bundle_id: number | null; first_seen_at: string; modified_at: string; reattach: string | null }[]
  const vols = db.prepare('SELECT file_name AS name, size FROM volumes WHERE archive_id = ? ORDER BY seq')
  const bundleNames = new Map(
    (db.prepare('SELECT id, name FROM bundles').all() as { id: number; name: string }[]).map((b) => [b.id, b.name])
  )

  // 从分卷重新分组，拿到 stem 和缺卷，不用另存
  const parsed = rows.map((r) => {
    const a = groupArchives(vols.all(r.id) as FileEntry[])[0]
    const entry: InboxArchive = {
      kind: 'archive',
      id: r.id,
      name: a.stem,
      format: a.format,
      size: a.totalSize,
      volumes: a.volumes.map((v) => v.name),
      missing: a.missing,
      modifiedAt: r.modified_at,
      firstSeenAt: r.first_seen_at,
      ...(r.reattach !== null && { reattach: r.reattach })
    }
    return { ...r, a, entry }
  })

  const groupOf = new Map<number, InboxGroup>() // archive id → 它所在的同套或同套建议
  const bundles = new Map<number, InboxGroup>()
  for (const p of parsed) {
    if (p.bundle_id === null) continue
    let g = bundles.get(p.bundle_id)
    if (!g) bundles.set(p.bundle_id, (g = { kind: 'bundle', id: `b${p.bundle_id}`, name: bundleNames.get(p.bundle_id)!, size: 0, members: [] }))
    g.members.push(p.entry)
    g.size += p.entry.size
    groupOf.set(p.id, g)
  }

  const rejected = new Set(db.prepare('SELECT archive_ids FROM rejected_bundle_suggestions').pluck().all() as string[])
  const loose = parsed.filter((p) => p.bundle_id === null)
  const byArchive = new Map<Archive, (typeof loose)[number]>(loose.map((p) => [p.a, p]))
  for (const set of suggestBundles(loose.map((p) => p.a))) {
    const members = set.map((a) => byArchive.get(a)!.entry)
    const ids = members.map((m) => m.id)
    if (rejected.has(key(ids))) continue
    const g: InboxGroup = { kind: 'suggestion', id: `s${key(ids)}`, name: bundleName(set), size: members.reduce((s, m) => s + m.size, 0), members }
    for (const id of ids) groupOf.set(id, g)
  }

  const out: InboxEntry[] = folders.map((name) => ({ kind: 'folder', id: name, name }))
  for (const p of parsed) {
    const g = groupOf.get(p.id)
    if (!g) out.push(p.entry)
    else if (!out.includes(g)) out.push(g)
  }
  return out
}

const key = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',')

export function mergeBundle(db: Database.Database, ids: number[], now: string): void {
  const stems = ids.map((id) => {
    const vols = db.prepare('SELECT file_name AS name, size FROM volumes WHERE archive_id = ? ORDER BY seq').all(id) as FileEntry[]
    return groupArchives(vols)[0]
  })
  db.transaction(() => {
    const bundleId = db.prepare('INSERT INTO bundles (name, created_at) VALUES (?, ?)').run(bundleName(stems), now).lastInsertRowid
    const set = db.prepare('UPDATE archives SET bundle_id = ? WHERE id = ?')
    for (const id of ids) set.run(bundleId, id)
  })()
}

export function rejectBundle(db: Database.Database, ids: number[]): void {
  db.prepare('INSERT OR IGNORE INTO rejected_bundle_suggestions (archive_ids) VALUES (?)').run(key(ids))
}

// 忽略和撤销忽略；只动收件箱里的，已解压的不受影响
export function ignore(db: Database.Database, ids: number[], on: boolean): void {
  const set = db.prepare("UPDATE archives SET state = ? WHERE id = ? AND state IN ('inbox', 'ignored')")
  db.transaction(() => {
    for (const id of ids) set.run(on ? 'ignored' : 'inbox', id)
  })()
}

// 压缩包的各个分卷，相对于仓库目录（移入回收站、在资源管理器中显示用）；找不到了返回空数组
export function volumePaths(db: Database.Database, id: number): string[] {
  const dir = db.prepare('SELECT current_dir FROM archives WHERE id = ?').pluck().get(id) as string | null | undefined
  if (dir === null || dir === undefined) return []
  const files = db.prepare('SELECT file_name FROM volumes WHERE archive_id = ? ORDER BY seq').pluck().all(id) as string[]
  return files.map((f) => (dir ? `${dir}/${f}` : f))
}

// 设置页：忽略过的压缩包（还在仓库目录里的）和现成文件夹，可以恢复到收件箱
export function listIgnored(db: Database.Database): { archives: { id: number; name: string; size: number }[]; folders: string[] } {
  const ids = db.prepare("SELECT id FROM archives WHERE state = 'ignored' AND current_dir IS NOT NULL ORDER BY first_volume_name").pluck().all() as number[]
  const vols = db.prepare('SELECT file_name AS name, size FROM volumes WHERE archive_id = ? ORDER BY seq')
  return {
    archives: ids.map((id) => {
      const a = groupArchives(vols.all(id) as FileEntry[])[0]
      return { id, name: a.stem, size: a.totalSize }
    }),
    folders: db.prepare('SELECT folder_name FROM ignored_loose_folders ORDER BY folder_name').pluck().all() as string[]
  }
}
