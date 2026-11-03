// 访问 DLsite 的薄 HTTP 层。请求一个接一个发，中间隔 1–2 秒；解析交给 dlsite.ts。
import { parseProduct, parseSearchResults, type Candidate, type ProductDetail } from './dlsite'

const BASE = 'https://www.dlsite.com/maniax'
const HEADERS = {
  'Accept-Language': 'ja',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
}

interface Deps {
  fetch?: typeof globalThis.fetch
  wait?: (ms: number) => Promise<void>
}

export function createDlsiteClient({
  fetch = globalThis.fetch,
  wait = (ms) => new Promise((r) => setTimeout(r, ms))
}: Deps = {}) {
  let queue: Promise<unknown> = Promise.resolve()
  let first = true

  // ponytail: 每个请求前都固定等 1–2 秒，不管上一个请求过去多久；搜索是用户点出来的，够用
  const get = (url: string): Promise<string> => {
    const run = queue.then(async () => {
      if (!first) await wait(1000 + Math.random() * 1000)
      first = false
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) throw new Error(`DLsite 返回 ${res.status}：${url}`)
      return res.text()
    })
    queue = run.catch(() => {})
    return run
  }

  return {
    // 关键词里的空格必须是 +，写成 %20 DLsite 会返回 403
    async search(keyword: string): Promise<Candidate[]> {
      const k = encodeURIComponent(keyword.trim()).replace(/%20/g, '+')
      return parseSearchResults(await get(`${BASE}/fsr/=/language/jp/keyword/${k}/`))
    },

    async product(code: string): Promise<ProductDetail | null> {
      if (!/^(RJ|VJ|BJ)\d+$/.test(code)) throw new Error(`不是作品号：${code}`)
      return parseProduct(await get(`${BASE}/api/=/product.json?workno=${code}`))
    }
  }
}
