// DLsite 解析：搜索结果页 HTML 和 product.json。只解析，不联网（联网见 dlsite-http.ts）。
import { normalizeForMatch } from './names'
import { genreTags } from './genres'

// 一条候选（见 GLOSSARY.md），用户必须亲自点选
export interface Candidate {
  code: string
  title: string
  circle: string
  coverUrl: string
  workType: string // DLsite 的作品类型，如 アドベンチャー
}

export interface ProductDetail {
  code: string
  title: string
  circle: string
  releaseDate: string // YYYY-MM-DD
  description: string
  genres: string[] // DLsite 类型词，不是标签。已按 id 换成标签库的中文名，R-18G 去掉（genres.ts）
  coverUrl: string
  series: string | null
  languageEditions: { code: string; lang: string; label: string }[]
}

// ponytail: 用正则读 DLsite 的固定页面结构，不引 HTML 解析库。页面改版时这里和样本一起更新。
export function parseSearchResults(html: string): Candidate[] {
  return html
    .split('data-list_item_product_id="')
    .slice(1)
    .map((item) => ({
      code: item.slice(0, item.indexOf('"')),
      title: decode(pick(item, /<dd class="work_name">[\s\S]*?<a [^>]*title="([^"]*)"/)),
      circle: decode(pick(item, /<dd class="maker_name">\s*<a [^>]*>([^<]*)<\/a>/)),
      coverUrl: absolute(pick(item, /'(\/\/img\.dlsite\.jp\/modpub\/[^']*_img_main\.jpg)'/)),
      workType: decode(pick(item, /class="work_category[^"]*"><a [^>]*>([^<]*)<\/a>/))
    }))
}

export function parseProduct(json: string): ProductDetail | null {
  const [p] = JSON.parse(json) as any[]
  if (!p) return null
  return {
    code: p.workno,
    title: p.work_name,
    circle: p.maker_name,
    releaseDate: String(p.regist_date ?? '').slice(0, 10),
    description: p.intro_s ?? '',
    genres: genreTags(list(p.genres).map((g: { id: unknown; name: string }) => ({ id: Number(g.id), name: g.name }))),
    coverUrl: absolute(p.image_main?.url ?? ''),
    series: p.series_name || null,
    languageEditions: list(p.language_editions).map((e: any) => ({ code: e.workno, lang: e.lang, label: e.label }))
  }
}

// 作品页网址：RJ 同人、VJ 商业、BJ 书籍各在自己的分区。资料只存了作品号，网址每次现拼
export function workUrl(code: string): string | null {
  const area = { RJ: 'maniax', VJ: 'pro', BJ: 'books' }[code.slice(0, 2)]
  return area && /^[A-Z]{2}\d+$/.test(code) ? `https://www.dlsite.com/${area}/work/=/product_id/${code}.html` : null
}

// DLsite 的列表字段有时是数组，有时是 {"3": {...}, "4": {...}} 这样的对象，也可能是 null
function list(v: unknown): any[] {
  return Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []
}

// 和关键词越像越靠前：完全一样 > 名字里包含关键词 > 其他；同档保持 DLsite 原来的顺序
export function rankCandidates<T extends { title: string }>(keyword: string, candidates: T[]): T[] {
  const k = normalizeForMatch(keyword)
  const score = (c: T) => {
    const t = normalizeForMatch(c.title)
    return t === k ? 2 : k && t.includes(k) ? 1 : 0
  }
  return candidates
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c)
}

function pick(s: string, re: RegExp): string {
  return s.match(re)?.[1] ?? ''
}

function absolute(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}
