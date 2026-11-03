import type Database from 'better-sqlite3'

// settings 表：值是 JSON（见 docs/schema-draft.md 的设置项）
export const getSetting = (db: Database.Database, key: string): unknown => {
  const v = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as string | undefined
  return v === undefined ? null : JSON.parse(v)
}
export const setSetting = (db: Database.Database, key: string, value: unknown) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))

// 2026-11-03T13:20:00Z，不带毫秒
export const now = () => new Date().toISOString().slice(0, 19) + 'Z'
