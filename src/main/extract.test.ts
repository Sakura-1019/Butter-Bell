import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { syncArchives } from './inbox'
import { addGame, passwordCandidates, postExtract, rememberPassword, setLaunchFile, uniqueFolder, type Cipher } from './extract'

// 测试用的“加密”：反转字符串。解不开的密文（换了电脑）用 'BAD' 表示
const cipher: Cipher = {
  encrypt: (s) => Buffer.from([...s].reverse().join('')),
  decrypt: (b) => {
    if (b.toString() === 'BAD') throw new Error('换了电脑')
    return [...b.toString()].reverse().join('')
  }
}
const T1 = '2026-11-03T10:00:00Z'
const T2 = '2026-11-04T10:00:00Z'

let db: Database.Database
beforeEach(() => {
  db = openDb(':memory:')
  syncArchives(db, [{ name: 'Foo.rar', size: 1 }, { name: 'Bar.rar', size: 2 }], T1)
})
const addCommon = (pw: string, last: string | null, cipherText = cipher.encrypt(pw)) =>
  db.prepare('INSERT INTO common_passwords (password_cipher, last_success_at, created_at, position) VALUES (?, ?, ?, (SELECT COUNT(*) FROM common_passwords))').run(cipherText, last, T1)
const commons = () =>
  (db.prepare('SELECT password_cipher, last_success_at FROM common_passwords ORDER BY id').all() as { password_cipher: Buffer; last_success_at: string | null }[]).map(
    (r) => [cipher.decrypt(r.password_cipher), r.last_success_at]
  )
const own = (id: number) => {
  const b = db.prepare('SELECT password_cipher FROM archives WHERE id = ?').pluck().get(id) as Buffer | null
  return b && cipher.decrypt(b)
}

describe('passwordCandidates：尝试顺序', () => {
  it('没有任何密码时只试“无密码”', () => {
    expect(passwordCandidates(db, 1, cipher).map((c) => c.password)).toEqual([''])
  })

  it('单包密码 → 无密码 → 常用密码（按表里的顺序）', () => {
    db.prepare('UPDATE archives SET password_cipher = ? WHERE id = 1').run(cipher.encrypt('mine'))
    addCommon('a', null)
    addCommon('b', '2026-01-01T00:00:00Z')
    addCommon('c', null)
    expect(passwordCandidates(db, 1, cipher).map((c) => c.password)).toEqual(['mine', '', 'a', 'b', 'c'])
  })

  it('常用密码试成功后挪到最前面', () => {
    addCommon('a', null)
    addCommon('b', null)
    addCommon('c', null)
    const c = passwordCandidates(db, 1, cipher).find((x) => x.password === 'c')!
    rememberPassword(db, 1, c, false, cipher, T2)
    expect(passwordCandidates(db, 2, cipher).map((x) => x.password)).toEqual(['', 'c', 'a', 'b'])
  })

  it('去重：常用表里和单包密码一样的不再试第二次', () => {
    db.prepare('UPDATE archives SET password_cipher = ? WHERE id = 1').run(cipher.encrypt('same'))
    addCommon('same', T1)
    addCommon('other', null)
    expect(passwordCandidates(db, 1, cipher).map((c) => c.password)).toEqual(['same', '', 'other'])
  })

  it('解不开的密文（换了电脑）直接跳过，不报错（ADR 0002）', () => {
    db.prepare('UPDATE archives SET password_cipher = ? WHERE id = 1').run(Buffer.from('BAD'))
    addCommon('x', null, Buffer.from('BAD'))
    addCommon('ok', null)
    expect(passwordCandidates(db, 1, cipher).map((c) => c.password)).toEqual(['', 'ok'])
  })

  it('常用密码带上 id，试成功后用来更新 last_success_at', () => {
    addCommon('a', null)
    expect(passwordCandidates(db, 1, cipher)).toEqual([{ password: '' }, { password: 'a', commonId: 1 }])
  })
})

describe('rememberPassword', () => {
  it('常用密码试成功：记到这个压缩包上，并更新它的 last_success_at', () => {
    addCommon('a', null)
    rememberPassword(db, 1, { password: 'a', commonId: 1 }, false, cipher, T2)
    expect(own(1)).toBe('a')
    expect(commons()).toEqual([['a', T2]])
  })

  it('用户输入并选了保存：记到压缩包上，加进常用密码表', () => {
    rememberPassword(db, 1, { password: 'typed' }, true, cipher, T2)
    expect(own(1)).toBe('typed')
    expect(commons()).toEqual([['typed', T2]])
  })

  it('用户输入、常用表里已经有：不重复添加，只更新时间', () => {
    addCommon('typed', null)
    rememberPassword(db, 1, { password: 'typed' }, true, cipher, T2)
    expect(commons()).toEqual([['typed', T2]])
  })

  it('用户输入但没选保存：哪里都不存', () => {
    rememberPassword(db, 1, { password: 'typed' }, false, cipher, T2)
    expect(own(1)).toBeNull()
    expect(commons()).toEqual([])
  })

  it('无密码就解开了：什么都不存', () => {
    rememberPassword(db, 1, { password: '' }, true, cipher, T2)
    expect(own(1)).toBeNull()
    expect(commons()).toEqual([])
  })
})

describe('postExtract：解压后对压缩包的处理', () => {
  const ops = () => {
    const log: string[] = []
    const taken = new Set<string>()
    return {
      log,
      taken,
      ops: {
        trash: async (p: string) => void log.push(`trash ${p}`),
        move: async (a: string, b: string) => void log.push(`move ${a} → ${b}`),
        exists: (p: string) => taken.has(p)
      }
    }
  }
  const vols = ['Foo.part1.rar', 'Foo.part2.rar']

  it('保留：什么都不动，还在原来的目录', async () => {
    const o = ops()
    expect(await postExtract('keep', 'G:\\c', '', vols, o.ops)).toBe('')
    expect(o.log).toEqual([])
  })

  it('进回收站：每个分卷都进回收站，current_dir 变 NULL', async () => {
    const o = ops()
    expect(await postExtract('recycle', 'G:\\c', '', vols, o.ops)).toBeNull()
    expect(o.log).toEqual(['trash G:\\c\\Foo.part1.rar', 'trash G:\\c\\Foo.part2.rar'])
  })

  it('挪进已解压：每个分卷挪进“已解压”子文件夹', async () => {
    const o = ops()
    expect(await postExtract('move', 'G:\\c', '', vols, o.ops)).toBe('已解压')
    expect(o.log).toEqual(['move G:\\c\\Foo.part1.rar → G:\\c\\已解压\\Foo.part1.rar', 'move G:\\c\\Foo.part2.rar → G:\\c\\已解压\\Foo.part2.rar'])
  })

  it('“已解压”里已经有同名文件：一个都不挪，原样保留', async () => {
    const o = ops()
    o.taken.add('G:\\c\\已解压\\Foo.part2.rar')
    expect(await postExtract('move', 'G:\\c', '', vols, o.ops)).toBe('')
    expect(o.log).toEqual([])
  })
})

describe('uniqueFolder', () => {
  it('不重名就用原名，重名依次加 (2)、(3)', () => {
    const taken = new Set(['G:\\butter\\Foo', 'G:\\butter\\Foo (2)'])
    expect(uniqueFolder('G:\\butter', 'Bar', (p) => taken.has(p))).toBe('Bar')
    expect(uniqueFolder('G:\\butter', 'Foo', (p) => taken.has(p))).toBe('Foo (3)')
  })
})

describe('addGame 和 setLaunchFile：解压结果写进数据库', () => {
  it('新游戏：名称先用文件夹名，状态想玩；压缩包标成已解压并指向它', () => {
    const id = addGame(db, { folderName: 'Foo', launchFile: 'Foo/Game.exe', members: [{ id: 1, subfolder: null, currentDir: '已解压' }] }, T2)
    expect(db.prepare('SELECT title, folder_name, launch_file, play_status, source_kind, added_at FROM games WHERE id = ?').get(id)).toEqual({
      title: 'Foo',
      folder_name: 'Foo',
      launch_file: 'Foo/Game.exe',
      play_status: 'wishlist',
      source_kind: null,
      added_at: T2
    })
    expect(db.prepare('SELECT state, game_id, current_dir, subfolder, extracted_at, needs_password FROM archives WHERE id = 1').get()).toEqual({
      state: 'extracted',
      game_id: id,
      current_dir: '已解压',
      subfolder: null,
      extracted_at: T2,
      needs_password: 0
    })
  })

  it('没有自动选中的启动文件时 launch_file 是 NULL，用户选了以后记住', () => {
    const id = addGame(db, { folderName: 'Foo', launchFile: null, members: [{ id: 1, subfolder: null, currentDir: '' }] }, T2)
    expect(db.prepare('SELECT launch_file FROM games WHERE id = ?').pluck().get(id)).toBeNull()
    setLaunchFile(db, id, 'bin/Start.exe')
    expect(db.prepare('SELECT launch_file FROM games WHERE id = ?').pluck().get(id)).toBe('bin/Start.exe')
  })

  it('同套：每个压缩包记各自的子文件夹', () => {
    const id = addGame(db, { folderName: 'Set', launchFile: null, members: [{ id: 1, subfolder: 'Foo', currentDir: null }, { id: 2, subfolder: 'Bar', currentDir: null }] }, T2)
    expect(db.prepare('SELECT subfolder, game_id, current_dir FROM archives ORDER BY id').all()).toEqual([
      { subfolder: 'Foo', game_id: id, current_dir: null },
      { subfolder: 'Bar', game_id: id, current_dir: null }
    ])
  })
})
