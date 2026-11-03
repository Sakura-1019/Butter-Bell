// 同套建议：几个压缩包名字像是同一套时给出提示，从不自动合并（见 GLOSSARY.md）。
import type { Archive } from './volumes'

// 01_蒼の旅団アリアとニナ_ADV → 编号 01，剩下的 蒼の旅団アリアとニナ_ADV
const NUMBERED = /^(\d{1,3})[_\s.-]+(.+)$/
const MIN_SHARED = 4

// ponytail: 只认“编号开头 + 名字前缀相同”这一种形状。不带编号的相似名字（存档、同名重复下载、
// 续作）噪音太大，先不提示；真遇到漏掉的再加规则。
export function suggestBundles(archives: Archive[]): Archive[][] {
  const numbered = archives
    .map((a) => ({ a, m: a.stem.match(NUMBERED) }))
    .filter((x): x is { a: Archive; m: RegExpMatchArray } => x.m !== null)
    .map(({ a, m }) => ({ a, no: Number(m[1]), rest: m[2] }))
    .sort((x, y) => (x.rest < y.rest ? -1 : x.rest > y.rest ? 1 : x.no - y.no))

  const groups: (typeof numbered)[] = []
  for (const item of numbered) {
    const last = groups[groups.length - 1]
    if (last && sharedPrefix(last[0].rest, item.rest) >= MIN_SHARED) last.push(item)
    else groups.push([item])
  }

  return groups
    .filter((g) => new Set(g.map((x) => x.no)).size === g.length && g.length > 1)
    .map((g) => g.sort((x, y) => x.no - y.no).map((x) => x.a))
}

function sharedPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

// 同套的名字：去掉编号后的共同前缀，也是以后解压出来的游戏文件夹名
export function bundleName(archives: Pick<Archive, 'stem'>[]): string {
  const rests = archives.map((a) => a.stem.match(NUMBERED)?.[2] ?? a.stem)
  const n = rests.reduce((k, r) => Math.min(k, sharedPrefix(rests[0], r)), rests[0].length)
  return rests[0].slice(0, n).replace(/[_\s.-]+$/, '')
}
