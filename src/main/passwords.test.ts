// 设置页的常用密码表：查看、增删、排顺序（ADR 0002：只存 safeStorage 密文）
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDb } from './db'
import init from './migrations/001-init.sql?raw'
import { addPassword, listPasswords, removePassword, reorderPasswords } from './passwords'
import { passwordCandidates } from './extract'

const cipher = {
  encrypt: (s: string) => Buffer.from(`enc:${s}`),
  decrypt: (b: Buffer) => {
    if (!b.toString().startsWith('enc:')) throw new Error('换了电脑')
    return b.toString().slice(4)
  }
}
const T = '2026-11-03T10:00:00Z'
let db: Database.Database
beforeEach(() => {
  db = openDb(':memory:')
})
const shown = () => listPasswords(db, cipher).map((p) => p.password)

describe('常用密码表', () => {
  it('新加的排在最后；和已有的一样就不重复加；空的不加', () => {
    addPassword(db, 'a', cipher, T)
    addPassword(db, 'b', cipher, T)
    addPassword(db, 'a', cipher, T)
    addPassword(db, '  ', cipher, T)
    expect(shown()).toEqual(['a', 'b'])
    expect(db.prepare('SELECT password_cipher FROM common_passwords').pluck().all().map(String)).toEqual(['enc:a', 'enc:b']) // 只存密文
  })

  it('删除', () => {
    addPassword(db, 'a', cipher, T)
    addPassword(db, 'b', cipher, T)
    removePassword(db, listPasswords(db, cipher)[0].id)
    expect(shown()).toEqual(['b'])
  })

  it('排顺序：解压时就按这个顺序试', () => {
    for (const p of ['a', 'b', 'c']) addPassword(db, p, cipher, T)
    const [a, b, c] = listPasswords(db, cipher).map((p) => p.id)
    reorderPasswords(db, [c, a, b])
    expect(shown()).toEqual(['c', 'a', 'b'])
    db.exec("INSERT INTO archives (first_volume_name, total_size, format, current_dir, first_seen_at) VALUES ('x.rar', 1, 'rar', '', '')")
    expect(passwordCandidates(db, 1, cipher).map((p) => p.password)).toEqual(['', 'c', 'a', 'b'])
  })

  it('解不开的密文（换了电脑）列出来但 password 是 null，可以删掉', () => {
    db.prepare("INSERT INTO common_passwords (password_cipher, created_at, position) VALUES (?, ?, 0)").run(Buffer.from('其他电脑的密文'), T)
    addPassword(db, 'a', cipher, T)
    expect(shown()).toEqual([null, 'a'])
  })
})

it('升级旧数据库：已有的常用密码按“最近成功的在前，没成功过的按添加顺序”排好', () => {
  db = new Database(':memory:')
  db.exec(init)
  db.pragma('user_version = 1')
  const add = db.prepare('INSERT INTO common_passwords (password_cipher, last_success_at, created_at) VALUES (?, ?, ?)')
  add.run(cipher.encrypt('never1'), null, T)
  add.run(cipher.encrypt('old'), '2026-01-01T00:00:00Z', T)
  add.run(cipher.encrypt('new'), '2026-10-01T00:00:00Z', T)
  add.run(cipher.encrypt('never2'), null, T)
  migrate(db)
  expect(shown()).toEqual(['new', 'old', 'never1', 'never2'])
})
