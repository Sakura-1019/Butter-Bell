// 游戏库的现算视图：标签筛选、按状态分组的书架、最近游玩、时长显示。界面和测试共用。

interface G {
  tags: string[]
  playStatus: 'playing' | 'wishlist' | 'completed'
  uninstalled: boolean
  lastPlayedAt: string | null
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0

// 侧栏的标签：[名字, 游戏数]，按名字排
export function tagCounts(games: G[]): [string, number][] {
  const m = new Map<string, [string, number]>()
  for (const t of games.flatMap((g) => g.tags)) {
    const k = t.toLowerCase()
    m.set(k, [m.get(k)?.[0] ?? t, (m.get(k)?.[1] ?? 0) + 1])
  }
  return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

export const withTag = <T extends G>(games: T[], tag: string) => games.filter((g) => g.tags.some((t) => same(t, tag)))

export type Shelf = 'playing' | 'wishlist' | 'completed' | 'uninstalled'
// ADR 0004：已卸载的只放在“已卸载”那一排
export function shelves<T extends G>(games: T[]): [Shelf, T[]][] {
  const keys: Shelf[] = ['playing', 'wishlist', 'completed', 'uninstalled']
  return keys
    .map((k): [Shelf, T[]] => [k, games.filter((g) => (g.uninstalled ? 'uninstalled' : g.playStatus) === k)])
    .filter(([, l]) => l.length)
}

export const recentlyPlayed = <T extends G>(games: T[]) =>
  games.filter((g) => g.lastPlayedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))

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
