import { describe, expect, it } from 'vitest'
import { downloadedLabel, filterInbox, sortInbox, type ViewArchive, type ViewEntry } from './inbox-view'

const a = (name: string, size: number, modifiedAt: string, firstSeenAt: string, volumes = [`${name}.rar`]): ViewArchive => ({
  kind: 'archive',
  name,
  size,
  modifiedAt,
  firstSeenAt,
  volumes
})
const folder = (name: string): ViewEntry => ({ kind: 'folder', name })

const A = a('Bravo', 300, '2026-10-02T00:00:00Z', '2026-11-01T00:00:00Z')
const B = a('alpha', 100, '2026-10-03T00:00:00Z', '2026-11-03T00:00:00Z')
const C = a('Charlie 10', 200, '2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z')
const D = a('Charlie 9', 50, '2026-09-01T00:00:00Z', '2026-11-04T00:00:00Z')
const F = folder('Zulu')
const G: ViewEntry = {
  kind: 'suggestion',
  name: '狂姫',
  size: 0,
  members: [a('01_狂姫_ADV', 10, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'), a('02_狂姫_CG', 1000, '2026-10-05T00:00:00Z', '2026-10-01T00:00:00Z')]
}
const names = (l: ViewEntry[]) => l.map((e) => e.name)

describe('sortInbox', () => {
  const all = [A, B, C, D, F, G]
  it('默认：下载时间新的在前；同套按组里最新的成员；现成文件夹总在最前', () => {
    expect(names(sortInbox(all, 'modified', true))).toEqual(['Zulu', '狂姫', 'alpha', 'Bravo', 'Charlie 10', 'Charlie 9'])
  })
  it('下载时间正序', () => {
    expect(names(sortInbox(all, 'modified', false))).toEqual(['Zulu', 'Charlie 9', 'Charlie 10', 'Bravo', 'alpha', '狂姫'])
  })
  it('名称：不分大小写，数字按大小比', () => {
    expect(names(sortInbox([A, B, C, D], 'name', false))).toEqual(['alpha', 'Bravo', 'Charlie 9', 'Charlie 10'])
    expect(names(sortInbox([A, B, C, D], 'name', true))).toEqual(['Charlie 10', 'Charlie 9', 'Bravo', 'alpha'])
  })
  it('大小：同套按组里最大的成员', () => {
    expect(names(sortInbox(all, 'size', true))).toEqual(['Zulu', '狂姫', 'Bravo', 'Charlie 10', 'alpha', 'Charlie 9'])
  })
  it('加入时间', () => {
    expect(names(sortInbox([A, B, C, D], 'added', true))).toEqual(['Charlie 9', 'alpha', 'Charlie 10', 'Bravo'])
  })
  it('不改动传入的数组，组内顺序不变', () => {
    const list = [A, G]
    sortInbox(list, 'name', true)
    expect(list).toEqual([A, G])
    expect(names((sortInbox([G], 'size', false)[0] as Extract<ViewEntry, { members: unknown }>).members)).toEqual(['01_狂姫_ADV', '02_狂姫_CG'])
  })
})

describe('filterInbox', () => {
  const all = [A, B, C, D, F, G]
  it('按文件名筛，不分大小写，全角半角视为相同', () => {
    expect(names(filterInbox(all, 'ALPHA'))).toEqual(['alpha'])
    expect(names(filterInbox(all, 'ｃｈａｒｌｉｅ'))).toEqual(['Charlie 10', 'Charlie 9'])
  })
  it('分卷的文件名、同套成员、现成文件夹都算', () => {
    expect(names(filterInbox([a('X', 1, '', '', ['X.part1.rar', 'X.part2.rar'])], 'part2'))).toEqual(['X'])
    expect(names(filterInbox(all, 'cg'))).toEqual(['狂姫'])
    expect(names(filterInbox(all, 'zu'))).toEqual(['Zulu'])
  })
  it('空的搜索词不筛', () => {
    expect(filterInbox(all, '  ')).toBe(all)
  })
})

describe('downloadedLabel', () => {
  const now = new Date(2026, 10, 4, 21, 0) // 2026-11-04 晚上
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString()
  it('最近的用文字：今天、昨天、几天前', () => {
    expect(downloadedLabel(at(2026, 11, 4, 1), now)).toEqual({ kind: 'today' })
    expect(downloadedLabel(at(2026, 11, 3, 23), now)).toEqual({ kind: 'yesterday' })
    expect(downloadedLabel(at(2026, 10, 29), now)).toEqual({ kind: 'daysAgo', n: 6 })
  })
  it('今年再早的写 mm/dd，往年的写 yyyy/mm/dd，月日都补零', () => {
    expect(downloadedLabel(at(2026, 10, 28), now)).toEqual({ kind: 'date', text: '10/28' })
    expect(downloadedLabel(at(2026, 3, 5), now)).toEqual({ kind: 'date', text: '03/05' })
    expect(downloadedLabel(at(2025, 11, 27), now)).toEqual({ kind: 'date', text: '2025/11/27' })
  })
})
