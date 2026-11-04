import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { ignore, listIgnored, listInbox, mergeBundle, rejectBundle, syncArchives, volumePaths } from './inbox'
import { ignoreFolders } from './loose'

const f = (name: string, size = 100) => ({ name, size })
const T1 = '2026-11-03T10:00:00Z'
const T2 = '2026-11-04T10:00:00Z'

let db: Database.Database
beforeEach(() => {
  db = openDb(':memory:')
})

const rows = () => db.prepare('SELECT first_volume_name, total_size, format, current_dir, state, first_seen_at FROM archives ORDER BY id').all()
const volumes = () => db.prepare('SELECT archive_id, seq, file_name, size FROM volumes ORDER BY archive_id, seq').all()

describe('syncArchives', () => {
  it('每个压缩包写一行 archives，每个分卷写一行 volumes', () => {
    syncArchives(db, [f('Foo.part2.rar', 2), f('Foo.part1.rar', 1), f('Bar.7z', 5), f('cover.jpg')], T1)
    expect(rows()).toEqual([
      { first_volume_name: 'Foo.part1.rar', total_size: 3, format: 'rar', current_dir: '', state: 'inbox', first_seen_at: T1 },
      { first_volume_name: 'Bar.7z', total_size: 5, format: '7z', current_dir: '', state: 'inbox', first_seen_at: T1 }
    ])
    expect(volumes()).toEqual([
      { archive_id: 1, seq: 1, file_name: 'Foo.part1.rar', size: 1 },
      { archive_id: 1, seq: 2, file_name: 'Foo.part2.rar', size: 2 },
      { archive_id: 2, seq: 1, file_name: 'Bar.7z', size: 5 }
    ])
  })

  it('重复扫描不重复插入，first_seen_at 保持第一次的时间', () => {
    const files = [f('Foo.part1.rar', 1), f('Foo.part2.rar', 2), f('Bar.7z', 5)]
    syncArchives(db, files, T1)
    syncArchives(db, files, T2)
    expect(rows()).toHaveLength(2)
    expect(volumes()).toHaveLength(3)
    expect(rows().every((r: any) => r.first_seen_at === T1)).toBe(true)
  })

  it('消失的压缩包 current_dir 记成 NULL，回来后恢复，id 不变', () => {
    syncArchives(db, [f('Foo.rar'), f('Bar.rar')], T1)
    syncArchives(db, [f('Foo.rar')], T2)
    expect(rows().map((r: any) => r.current_dir)).toEqual(['', null])
    syncArchives(db, [f('Foo.rar'), f('Bar.rar')], T2)
    expect(rows().map((r: any) => r.current_dir)).toEqual(['', ''])
    expect(rows()).toHaveLength(2)
  })

  it('同名不同大小是另一个压缩包（ADR 0001）', () => {
    syncArchives(db, [f('Foo.rar', 1)], T1)
    syncArchives(db, [f('Foo.rar', 2)], T2)
    expect(rows().map((r: any) => [r.total_size, r.current_dir])).toEqual([[1, null], [2, '']])
  })

  it('补齐分卷后总大小变了，算新的压缩包，旧的记成消失', () => {
    syncArchives(db, [f('Foo.part1.rar', 1)], T1)
    syncArchives(db, [f('Foo.part1.rar', 1), f('Foo.part2.rar', 2)], T2)
    expect(rows().map((r: any) => [r.total_size, r.current_dir])).toEqual([[1, null], [3, '']])
  })

  it('已忽略的压缩包重新扫描后仍是忽略', () => {
    syncArchives(db, [f('Foo.rar')], T1)
    ignore(db, [1], true)
    syncArchives(db, [f('Foo.rar')], T2)
    expect(rows()[0]).toMatchObject({ state: 'ignored' })
  })
})

const SET = ['01_蒼の旅団アリアとニナ_ADV.rar', '02_蒼の旅団アリアとニナ_動画.rar', '03_蒼の旅団アリアとニナ_CG集.rar']

describe('listInbox', () => {
  it('普通压缩包：名称、大小、类型、分卷、缺卷', () => {
    syncArchives(db, [f('Foo.part1.rar', 1), f('Foo.part3.rar', 3), f('Bar.7z', 5)], T1)
    expect(listInbox(db)).toEqual([
      { kind: 'archive', id: 2, name: 'Bar', format: '7z', size: 5, volumes: ['Bar.7z'], missing: [], modifiedAt: T1, firstSeenAt: T1 },
      { kind: 'archive', id: 1, name: 'Foo', format: 'rar', size: 4, volumes: ['Foo.part1.rar', 'Foo.part3.rar'], missing: [2], modifiedAt: T1, firstSeenAt: T1 }
    ])
  })

  it('下载时间是文件修改时间，分卷取最新那一卷；扫描时更新', () => {
    const m = (name: string, mtime: string) => ({ name, size: 1, mtime })
    syncArchives(db, [m('Foo.part1.rar', '2026-10-01T00:00:00Z'), m('Foo.part2.rar', '2026-10-02T00:00:00Z')], T1)
    expect(listInbox(db)[0]).toMatchObject({ modifiedAt: '2026-10-02T00:00:00Z', firstSeenAt: T1 })
    syncArchives(db, [m('Foo.part1.rar', '2026-10-05T00:00:00Z'), m('Foo.part2.rar', '2026-10-02T00:00:00Z')], T2)
    expect(listInbox(db)[0]).toMatchObject({ modifiedAt: '2026-10-05T00:00:00Z', firstSeenAt: T1 })
  })

  it('消失的和忽略的不出现', () => {
    syncArchives(db, [f('A.rar'), f('B.rar'), f('C.rar')], T1)
    syncArchives(db, [f('A.rar'), f('B.rar')], T2)
    ignore(db, [2], true)
    expect(listInbox(db).map((e) => e.kind === 'archive' && e.name)).toEqual(['A'])
  })

  it('忽略可以撤销', () => {
    syncArchives(db, [f('A.rar')], T1)
    ignore(db, [1], true)
    ignore(db, [1], false)
    expect(listInbox(db)).toHaveLength(1)
  })

  it('编号开头的同名压缩包给出同套建议', () => {
    syncArchives(db, [...SET.map((n) => f(n)), f('Other.rar')], T1)
    const out = listInbox(db)
    expect(out.map((e) => e.kind)).toEqual(['suggestion', 'archive'])
    const s = out[0]
    if (s.kind !== 'suggestion') throw new Error()
    expect(s.name).toBe('蒼の旅団アリアとニナ')
    expect(s.members.map((m) => m.id)).toEqual([1, 2, 3])
    expect(s.size).toBe(300)
  })

  it('“不是同一套”持久保存：下次扫描不再提示，三个包各自独立', () => {
    syncArchives(db, SET.map((n) => f(n)), T1)
    rejectBundle(db, [3, 1, 2])
    syncArchives(db, SET.map((n) => f(n)), T2)
    expect(listInbox(db).map((e) => e.kind)).toEqual(['archive', 'archive', 'archive'])
  })

  it('“合并为一项”写进 bundles，之后显示成一个同套', () => {
    syncArchives(db, SET.map((n) => f(n)), T1)
    mergeBundle(db, [1, 2, 3], T2)
    syncArchives(db, SET.map((n) => f(n)), T2)
    const out = listInbox(db)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'bundle', name: '蒼の旅団アリアとニナ', size: 300 })
    expect(db.prepare('SELECT name, created_at FROM bundles').all()).toEqual([{ name: '蒼の旅団アリアとニナ', created_at: T2 }])
  })

  it('同套里一个包忽略了，剩下的仍在同套里', () => {
    syncArchives(db, SET.map((n) => f(n)), T1)
    mergeBundle(db, [1, 2, 3], T2)
    ignore(db, [3], true)
    const [b] = listInbox(db)
    expect(b.kind === 'bundle' && b.members.map((m) => m.id)).toEqual([1, 2])
  })
})

describe('listIgnored：设置里恢复被忽略的条目', () => {
  it('列出忽略的压缩包（找不到了的不列）和忽略的现成文件夹；恢复后回到收件箱', () => {
    syncArchives(db, [f('Foo.part1.rar', 1), f('Foo.part2.rar', 2), f('Bar.7z', 5), f('Gone.zip')], T1)
    ignore(db, [1, 2, 3], true)
    syncArchives(db, [f('Foo.part1.rar', 1), f('Foo.part2.rar', 2), f('Bar.7z', 5)], T2) // Gone.zip 不在了
    ignoreFolders(db, ['Some Game'], true, T1)
    expect(listIgnored(db)).toEqual({
      archives: [
        { id: 2, name: 'Bar', size: 5 },
        { id: 1, name: 'Foo', size: 3 }
      ],
      folders: ['Some Game']
    })
    ignore(db, [1], false)
    expect(listIgnored(db).archives.map((a) => a.id)).toEqual([2])
    expect(listInbox(db).map((e) => e.name)).toEqual(['Foo'])
  })
})

describe('volumePaths', () => {
  it('分卷相对于仓库目录的路径；找不到了的是空数组', () => {
    syncArchives(db, [f('Foo.part1.rar'), f('Foo.part2.rar'), f('Bar.rar')], T1)
    expect(volumePaths(db, 1)).toEqual(['Foo.part1.rar', 'Foo.part2.rar'])
    db.prepare("UPDATE archives SET current_dir = '已解压' WHERE id = 1").run()
    expect(volumePaths(db, 1)).toEqual(['已解压/Foo.part1.rar', '已解压/Foo.part2.rar'])
    syncArchives(db, [f('Foo.part1.rar'), f('Foo.part2.rar')], T2)
    expect(volumePaths(db, 2)).toEqual([])
  })
})
