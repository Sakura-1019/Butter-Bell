import Database from 'better-sqlite3'
import init from './migrations/001-init.sql?raw'
import passwordOrder from './migrations/002-password-order.sql?raw'
import archiveError from './migrations/003-archive-error.sql?raw'
import versionCover from './migrations/004-version-cover-mtime.sql?raw'
import windowTitle from './migrations/005-window-title.sql?raw'
import nav from './migrations/006-nav.sql?raw'
import { jaToZh } from '../core/genres'

// 按顺序排列，下标 + 1 就是迁移后的 user_version。只能往后追加。SQL 以外的步骤写成函数
const migrations: (string | ((db: Database.Database) => void))[] = [init, passwordOrder, archiveError, versionCover, windowTitle, (db) => (db.exec(nav), tagsToChinese(db))]

export function openDb(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  for (let v = version; v < migrations.length; v++) {
    db.transaction(() => {
      const m = migrations[v]
      if (typeof m === 'string') db.exec(m)
      else m(db)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

// 0.3.0：以前识别时勾上的是日文类型词，换成标签库里的中文名；中文名已经有了就并过去。用户自己起的标签对不上，不动
export function tagsToChinese(db: Database.Database): void {
  const tags = db.prepare('SELECT id, name FROM tags').all() as { id: number; name: string }[]
  const find = db.prepare('SELECT id FROM tags WHERE name = ?').pluck()
  for (const t of tags) {
    const zh = jaToZh.get(t.name)
    if (!zh) continue
    const other = find.get(zh) as number | undefined
    if (other === undefined || other === t.id) db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(zh, t.id)
    else {
      db.prepare('INSERT OR IGNORE INTO game_tags (game_id, tag_id) SELECT game_id, ? FROM game_tags WHERE tag_id = ?').run(other, t.id)
      db.prepare('DELETE FROM tags WHERE id = ?').run(t.id)
    }
  }
}
