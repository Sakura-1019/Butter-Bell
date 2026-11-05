import Database from 'better-sqlite3'
import init from './migrations/001-init.sql?raw'
import passwordOrder from './migrations/002-password-order.sql?raw'
import archiveError from './migrations/003-archive-error.sql?raw'
import versionCover from './migrations/004-version-cover-mtime.sql?raw'
import windowTitle from './migrations/005-window-title.sql?raw'

// 按顺序排列，下标 + 1 就是迁移后的 user_version。只能往后追加。
const migrations = [init, passwordOrder, archiveError, versionCover, windowTitle]

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
      db.exec(migrations[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
