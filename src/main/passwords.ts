// 常用密码表的管理（设置页）。只存 safeStorage 密文（ADR 0002），去重要先解密再比较。
import type Database from 'better-sqlite3'
import type { Cipher } from './extract'

export interface CommonPassword {
  id: number
  password: string | null // null = 这台电脑解不开（ADR 0002），只能删掉重输
}

export function listPasswords(db: Database.Database, cipher: Cipher): CommonPassword[] {
  const rows = db.prepare('SELECT id, password_cipher FROM common_passwords ORDER BY position, id').all() as { id: number; password_cipher: Buffer }[]
  return rows.map((r) => {
    try {
      return { id: r.id, password: cipher.decrypt(r.password_cipher) }
    } catch {
      return { id: r.id, password: null }
    }
  })
}

// 加在最后；已经有了就不加
export function addPassword(db: Database.Database, password: string, cipher: Cipher, now: string): void {
  if (!password.trim() || listPasswords(db, cipher).some((p) => p.password === password)) return
  db.prepare('INSERT INTO common_passwords (password_cipher, created_at, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM common_passwords))').run(
    cipher.encrypt(password),
    now
  )
}

export function removePassword(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM common_passwords WHERE id = ?').run(id)
}

// ids：排好的全部 id，解压时按这个顺序试
export function reorderPasswords(db: Database.Database, ids: number[]): void {
  const set = db.prepare('UPDATE common_passwords SET position = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => set.run(i, id)))()
}
