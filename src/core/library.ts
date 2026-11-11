// 游戏库的现算视图：各页面放哪些游戏、筛选、排序、最近游玩分组、时长显示。界面和测试共用。

type PlayStatus = 'playing' | 'wishlist' | 'completed'
interface G {
  title: string
  tags: string[]
  playStatus: PlayStatus
  uninstalled: boolean
  favorite: boolean
  lastPlayedAt: string | null
  addedAt: string
  playSeconds: number
  recentExtractAt: string | null
}

// 左侧导航。长按可以拖动改顺序，设置固定在最下面，不在这里
export type NavPage = 'recent' | 'library' | 'favorites' | 'inbox' | 'completed' | 'uninstalled'
export const DEFAULT_NAV: NavPage[] = ['recent', 'library', 'favorites', 'inbox', 'completed', 'uninstalled']
export type GamePage = Exclude<NavPage, 'inbox'>

export type LibrarySortKey = 'added' | 'lastPlayed' | 'title' | 'playtime'
export interface LibrarySort {
  key: LibrarySortKey
  desc: boolean
}
export const LIBRARY_SORT_KEYS: LibrarySortKey[] = ['added', 'lastPlayed', 'title', 'playtime']
export const DEFAULT_LIBRARY_SORT: LibrarySort = { key: 'added', desc: true }

// ADR 0004：已卸载的游戏只在“已卸载”页出现
export function pageGames<T extends G>(games: T[], page: GamePage): T[] {
  if (page === 'uninstalled') return games.filter((g) => g.uninstalled)
  const live = games.filter((g) => !g.uninstalled)
  if (page === 'recent') return live.filter((g) => g.lastPlayedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))
  if (page === 'favorites') return live.filter((g) => g.favorite)
  if (page === 'completed') return live.filter((g) => g.playStatus === 'completed')
  return live
}
// 能按状态筛的页面；已通关本身就是通关的游戏，没有状态选项
export const hasStatusFilter = (page: GamePage) => page === 'library' || page === 'favorites'
export const hasFilter = (page: GamePage) => hasStatusFilter(page) || page === 'completed'

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
const hasTag = (g: G, tag: string) => g.tags.some((t) => same(t, tag))

// 状态单选；多个标签之间是“且”，越选越少
export interface Filter {
  status: PlayStatus | null
  tags: string[]
}
export const NO_FILTER: Filter = { status: null, tags: [] }
export const applyFilter = <T extends G>(games: T[], f: Filter) => games.filter((g) => (!f.status || g.playStatus === f.status) && f.tags.every((t) => hasTag(g, t)))
// 再加上这个标签还剩几个游戏（已选的标签就是现在的结果数）
export const countWithTag = (games: G[], f: Filter, tag: string) => applyFilter(games, { ...f, tags: [...f.tags, tag] }).length

// 筛选面板里的标签：“我的标签”里在这一页至少有一个游戏在用的词，按游戏数从多到少
export function usedTags(games: G[], myTags: string[]): string[] {
  return myTags
    .map((t, i) => ({ t, i, n: games.filter((g) => hasTag(g, t)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.t)
}
export const tagUseCount = (games: G[], tag: string) => games.filter((g) => !g.uninstalled && hasTag(g, tag)).length

export function sortGames<T extends G>(games: T[], { key, desc }: LibrarySort): T[] {
  const by: Record<LibrarySortKey, (a: T, b: T) => number> = {
    added: (a, b) => a.addedAt.localeCompare(b.addedAt),
    lastPlayed: (a, b) => (a.lastPlayedAt ?? '').localeCompare(b.lastPlayedAt ?? ''),
    title: (a, b) => a.title.localeCompare(b.title, 'zh'),
    playtime: (a, b) => a.playSeconds - b.playSeconds
  }
  return [...games].sort((a, b) => (desc ? -1 : 1) * by[key](a, b))
}

// 游戏库最上面的“最近解压”：按进库时间新的在前，和下面不重复
export function splitRecentExtract<T extends G>(games: T[]): [T[], T[]] {
  const recent = games.filter((g) => g.recentExtractAt).sort((a, b) => b.recentExtractAt!.localeCompare(a.recentExtractAt!))
  return [recent, games.filter((g) => !g.recentExtractAt)]
}

// 最近游玩按时间分组：3 天内 / 7 天内 / 30 天内 / 更早，没有游戏的组不要。组内保持传进来的顺序
export type RecentGroup = 'd3' | 'd7' | 'd30' | 'older'
export function recentGroups<T extends G>(games: T[], now: Date): [RecentGroup, T[]][] {
  const days = (g: T) => (now.getTime() - new Date(g.lastPlayedAt!).getTime()) / 864e5
  const limits: [RecentGroup, number][] = [['d3', 3], ['d7', 7], ['d30', 30], ['older', Infinity]]
  const out: [RecentGroup, T[]][] = limits.map(([k]) => [k, []])
  for (const g of games) out[limits.findIndex(([, max]) => days(g) <= max)][1].push(g)
  return out.filter(([, l]) => l.length)
}

// 返回 i18n 的键和数字，界面去翻译
export function formatPlaytime(seconds: number): { key: 'never' } | { key: 'minutes'; n: number } | { key: 'hours'; n: string } {
  if (!seconds) return { key: 'never' }
  if (seconds < 3600) return { key: 'minutes', n: Math.max(1, Math.round(seconds / 60)) }
  return { key: 'hours', n: (seconds / 3600).toFixed(1) }
}

// 工具栏搜索：名称、社团、文件夹名里包含搜索词就算。全角半角、大小写都不区分
const fold = (s: string) => s.normalize('NFKC').toLowerCase()
export function search<T extends { title: string; circle: string | null; folderName: string }>(games: T[], query: string): T[] {
  const q = fold(query.trim())
  if (!q) return games
  return games.filter((g) => [g.title, g.circle ?? '', g.folderName].some((s) => fold(s).includes(q)))
}
