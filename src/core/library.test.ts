import { describe, expect, it } from 'vitest'
import { applyFilter, countWithTag, formatPlaytime, hasStatusFilter, pageGames, recentGroups, search, sortGames, splitRecentExtract, usedTags } from './library'

type Status = 'playing' | 'wishlist' | 'completed'
type Opts = { title: string; tags: string[]; playStatus: Status; uninstalled: boolean; favorite: boolean; lastPlayedAt: string | null; addedAt: string; playSeconds: number; recentExtractAt: string | null }
const g = (id: number, o: Partial<Opts> = {}) => ({
  id,
  title: String(id),
  tags: [] as string[],
  playStatus: 'wishlist' as Status,
  uninstalled: false,
  favorite: false,
  lastPlayedAt: null as string | null,
  addedAt: '2026-01-01',
  playSeconds: 0,
  recentExtractAt: null as string | null,
  ...o
})

describe('各页面放哪些游戏', () => {
  const games = [
    g(1, { playStatus: 'completed', favorite: true, lastPlayedAt: '2026-11-01T00:00:00Z' }),
    g(2, { playStatus: 'completed', favorite: true, uninstalled: true, lastPlayedAt: '2026-11-05T00:00:00Z' }),
    g(3, { playStatus: 'playing', lastPlayedAt: '2026-11-03T00:00:00Z' }),
    g(4)
  ]
  const ids = (p: Parameters<typeof pageGames>[1]) => pageGames(games, p).map((x) => x.id)
  it('已卸载的只在已卸载页', () => {
    expect(ids('library')).toEqual([1, 3, 4])
    expect(ids('completed')).toEqual([1])
    expect(ids('favorites')).toEqual([1])
    expect(ids('uninstalled')).toEqual([2])
  })
  it('最近游玩：只有玩过的，按上次游玩倒序', () => {
    expect(ids('recent')).toEqual([3, 1])
  })
  it('能按状态筛的只有游戏库和收藏', () => {
    expect((['library', 'favorites', 'completed', 'recent'] as const).map(hasStatusFilter)).toEqual([true, true, false, false])
  })
})

describe('筛选', () => {
  const games = [g(1, { tags: ['RPG', '治愈'], playStatus: 'completed' }), g(2, { tags: ['rpg'] }), g(3, { tags: ['治愈'], playStatus: 'completed' })]
  it('状态加标签，标签之间是“且”，不分大小写', () => {
    expect(applyFilter(games, { status: 'completed', tags: ['治愈'] }).map((x) => x.id)).toEqual([1, 3])
    expect(applyFilter(games, { status: null, tags: ['rpg', '治愈'] }).map((x) => x.id)).toEqual([1])
  })
  it('再加一个标签还剩几个', () => {
    expect(countWithTag(games, { status: 'completed', tags: [] }, 'RPG')).toBe(1)
  })
  it('筛选面板只列“我的标签”里有游戏在用的，按游戏数从多到少', () => {
    expect(usedTags(games, ['空的', 'RPG', '治愈'])).toEqual(['RPG', '治愈'])
    expect(usedTags([g(1, { tags: ['治愈'] })], ['空的', 'RPG', '治愈'])).toEqual(['治愈'])
  })
})

describe('排序', () => {
  const games = [g(1, { title: 'b', addedAt: '2026-01-02', playSeconds: 5 }), g(2, { title: 'a', addedAt: '2026-01-03', playSeconds: 1 }), g(3, { title: 'c', addedAt: '2026-01-01', playSeconds: 9 })]
  const ids = (s: Parameters<typeof sortGames>[1]) => sortGames(games, s).map((x) => x.id)
  it('加入时间、名称、时长，正反两个方向', () => {
    expect(ids({ key: 'added', desc: true })).toEqual([2, 1, 3])
    expect(ids({ key: 'title', desc: false })).toEqual([2, 1, 3])
    expect(ids({ key: 'playtime', desc: true })).toEqual([3, 1, 2])
  })
})

describe('最近解压', () => {
  it('和其余游戏分开，不重复，按进库时间新的在前', () => {
    const games = [g(1), g(2, { recentExtractAt: '2026-11-01T00:00:00Z' }), g(3, { recentExtractAt: '2026-11-02T00:00:00Z' })]
    const [recent, rest] = splitRecentExtract(games)
    expect([recent.map((x) => x.id), rest.map((x) => x.id)]).toEqual([[3, 2], [1]])
  })
})

describe('最近游玩的时间分组', () => {
  it('3 天内 / 7 天内 / 30 天内 / 更早，空的组不要', () => {
    const now = new Date('2026-11-11T12:00:00Z')
    const games = [g(1, { lastPlayedAt: '2026-11-10T12:00:00Z' }), g(2, { lastPlayedAt: '2026-11-08T11:00:00Z' }), g(3, { lastPlayedAt: '2026-09-01T00:00:00Z' })]
    expect(recentGroups(games, now).map(([k, l]) => [k, l.map((x) => x.id)])).toEqual([['d3', [1]], ['d7', [2]], ['older', [3]]])
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
