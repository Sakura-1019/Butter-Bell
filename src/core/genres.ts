// 内置的 DLsite 标签库快照（genres.json，用 scripts/genres-snapshot.mjs 重新生成）。
// 类型词按 id 认：同一个 id 在不同接口里译名可能不同，一律用快照里的中文名。R-18G 整类不显示，识别时也不列。
import data from './genres.json'

const names = data.genres as Record<string, string[]> // id → [中文, 日文]
const excluded = new Set(data.excluded)

export const zhName = (id: number): string | undefined => names[id]?.[0]

// 标签库的分类索引：[大类, 类型词中文名…]
export const CATEGORIES: { name: string; tags: string[] }[] = data.categories.map((c) => ({ name: c.name, tags: c.ids.map((id) => names[id][0]) }))

// 默认的“我的标签”：DLsite 成人分区的人气分类
export const DEFAULT_MY_TAGS: string[] = data.popular.map((id) => names[id][0])

const library = new Set(CATEGORIES.flatMap((c) => c.tags))
export const inLibrary = (name: string) => library.has(name)

// product.json 的类型词 → 标签名：去掉 R-18G，有中文名的换成中文名，快照里没有的词照原样
export function genreTags(genres: { id: number; name: string }[]): string[] {
  return [...new Set(genres.filter((g) => !excluded.has(g.id)).map((g) => zhName(g.id) ?? g.name))]
}

// 0.3.0 以前识别时存的是日文类型词：日文名 → 中文名
export const jaToZh: Map<string, string> = new Map(Object.values(names).flatMap(([zh, ja]) => (ja && ja !== zh ? [[ja, zh] as [string, string]] : [])))
