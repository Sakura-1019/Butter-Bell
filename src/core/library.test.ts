import { describe, expect, it } from 'vitest'
import { formatPlaytime, recentlyPlayed, search, shelves, tagCounts, withTag } from './library'

const g = (id: number, o: Partial<{ tags: string[]; playStatus: 'playing' | 'wishlist' | 'completed'; uninstalled: boolean; lastPlayedAt: string | null }> = {}) => ({
  id,
  tags: [],
  playStatus: 'wishlist' as const,
  uninstalled: false,
  lastPlayedAt: null,
  ...o
})

describe('标签筛选', () => {
  const games = [g(1, { tags: ['RPG', '中文'] }), g(2, { tags: ['rpg'] }), g(3, { tags: ['ADV'] }), g(4, { tags: ['RPG'], uninstalled: true })]
  it('侧栏的标签和数量：按名字排，已卸载的也算', () => {
    expect(tagCounts(games)).toEqual([['ADV', 1], ['RPG', 3], ['中文', 1]])
  })
  it('按标签筛，不分大小写', () => {
    expect(withTag(games, 'rpg').map((x) => x.id)).toEqual([1, 2, 4])
  })
})

describe('书架：按状态分组', () => {
  it('在玩 / 想玩 / 通关 / 已卸载，已卸载的只出现在已卸载那一排，空的排不显示', () => {
    const games = [g(1, { playStatus: 'completed' }), g(2, { playStatus: 'completed', uninstalled: true }), g(3, { playStatus: 'playing' })]
    expect(shelves(games).map(([k, l]) => [k, l.map((x) => x.id)])).toEqual([
      ['playing', [3]],
      ['completed', [1]],
      ['uninstalled', [2]]
    ])
  })
})

describe('最近游玩', () => {
  it('按上次游玩倒序，没玩过的不算', () => {
    const games = [g(1, { lastPlayedAt: '2026-11-01T00:00:00Z' }), g(2), g(3, { lastPlayedAt: '2026-11-03T00:00:00Z' })]
    expect(recentlyPlayed(games).map((x) => x.id)).toEqual([3, 1])
  })
})

describe('formatPlaytime', () => {
  it('不到 1 分钟、分钟、小时', () => {
    expect(formatPlaytime(0)).toEqual({ key: 'never' })
    expect(formatPlaytime(30)).toEqual({ key: 'minutes', n: 1 })
    expect(formatPlaytime(59 * 60)).toEqual({ key: 'minutes', n: 59 })
    expect(formatPlaytime(90 * 60)).toEqual({ key: 'hours', n: '1.5' })
  })
})

describe('搜索', () => {
  const games = [
    { id: 1, title: '蒼の旅団アリアとニナ', circle: 'Tin Lantern', folderName: '01_蒼の旅団' },
    { id: 2, title: 'ロゼと子竜', circle: null, folderName: 'ロゼと子竜v1.6' },
    { id: 3, title: 'Copper Lantern 2', circle: null, folderName: 'Copper Lantern 2' }
  ]
  const ids = (q: string) => search(games, q).map((x) => x.id)
  it('按名称、社团、文件夹名找，不分大小写，前后空格不算', () => {
    expect(ids('アリア')).toEqual([1])
    expect(ids('TIN')).toEqual([1])
    expect(ids('v1.6')).toEqual([2])
    expect(ids('  copper ')).toEqual([3])
  })
  it('全角半角当成一样', () => {
    expect(ids('ＣＯＰＰＥＲ')).toEqual([3])
  })
  it('空的搜索词不过滤', () => {
    expect(ids(' ')).toEqual([1, 2, 3])
  })
})
