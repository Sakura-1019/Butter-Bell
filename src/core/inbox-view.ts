// 收件箱的排序和搜索。现成文件夹不是下载来的包，没有下载时间和大小，总排在最前；
// 同套和同套建议按组里最新 / 最大 / 最早加入的那个成员参与排序，组内顺序不变。

export type InboxSortKey = 'modified' | 'name' | 'size' | 'added'
export interface InboxSort {
  key: InboxSortKey
  desc: boolean
}
export const DEFAULT_SORT: InboxSort = { key: 'modified', desc: true }

export interface ViewArchive {
  kind: 'archive'
  name: string
  size: number
  volumes: string[]
  modifiedAt: string // 下载时间 = 文件修改时间，分卷取最新那一卷
  firstSeenAt: string // 加入时间
}
interface ViewGroup {
  kind: 'bundle' | 'suggestion'
  name: string
  size: number
  members: ViewArchive[]
}
interface ViewFolder {
  kind: 'folder'
  name: string
}
export type ViewEntry = ViewArchive | ViewGroup | ViewFolder

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const members = (e: ViewArchive | ViewGroup) => (e.kind === 'archive' ? [e] : e.members)
const max = <T>(list: T[], cmp: (a: T, b: T) => number) => list.reduce((m, x) => (cmp(x, m) > 0 ? x : m))

function compare(a: ViewArchive | ViewGroup, b: ViewArchive | ViewGroup, key: InboxSortKey): number {
  if (key === 'name') return collator.compare(a.name, b.name)
  const pick = (e: ViewArchive | ViewGroup) => {
    const ms = members(e)
    if (key === 'size') return max(ms.map((m) => m.size), (x, y) => x - y)
    return max(ms.map((m) => (key === 'modified' ? m.modifiedAt : m.firstSeenAt)), (x, y) => x.localeCompare(y))
  }
  const x = pick(a)
  const y = pick(b)
  return typeof x === 'number' ? x - (y as number) : x.localeCompare(y as string)
}

export function sortInbox<T extends ViewEntry>(entries: T[], key: InboxSortKey, desc: boolean): T[] {
  const folders = entries.filter((e) => e.kind === 'folder')
  const rest = entries.filter((e) => e.kind !== 'folder') as (T & (ViewArchive | ViewGroup))[]
  const dir = desc ? -1 : 1
  const sorted = [...rest].sort((a, b) => dir * compare(a, b, key) || collator.compare(a.name, b.name))
  return [...folders, ...sorted]
}

// 搜索：名字、分卷文件名、同套成员都算。不分大小写，NFKC 让全角半角视为相同
const fold = (s: string) => s.normalize('NFKC').toLowerCase()
export function filterInbox<T extends ViewEntry>(entries: T[], query: string): T[] {
  const q = fold(query.trim())
  if (!q) return entries
  const hit = (s: string) => fold(s).includes(q)
  const archiveHit = (a: ViewArchive) => hit(a.name) || a.volumes.some(hit)
  return entries.filter((e) => hit(e.name) || (e.kind === 'archive' ? archiveHit(e) : e.kind !== 'folder' && e.members.some(archiveHit)))
}

// 卡片上的下载时间：近的用文字（今天、昨天、几天前），今年再早的写 mm/dd，往年的写 yyyy/mm/dd
export type DownloadedLabel = { kind: 'today' | 'yesterday' } | { kind: 'daysAgo'; n: number } | { kind: 'date'; text: string }
export function downloadedLabel(iso: string, now = new Date()): DownloadedLabel {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86400000)
  if (days <= 0) return { kind: 'today' }
  if (days === 1) return { kind: 'yesterday' }
  if (days < 7) return { kind: 'daysAgo', n: days }
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  return { kind: 'date', text: d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}` }
}
