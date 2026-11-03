import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDlsiteClient } from './dlsite-http'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

function fakeNetwork(body: string, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const waits: number[] = []
  const client = createDlsiteClient({
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> })
      return new Response(body, { status })
    },
    wait: async (ms) => {
      waits.push(ms)
    }
  })
  return { client, calls, waits }
}

describe('createDlsiteClient', () => {
  it('搜索：空格写成 +，带 Accept-Language: ja，返回解析好的候选', async () => {
    const { client, calls } = fakeNetwork(fixture('dlsite-search-single.html'))
    const results = await client.search('夏雲ラジオ 3')
    expect(calls[0].url).toBe(
      'https://www.dlsite.com/maniax/fsr/=/language/jp/keyword/%E5%A4%8F%E9%9B%B2%E3%83%A9%E3%82%B8%E3%82%AA+3/'
    )
    expect(calls[0].headers['Accept-Language']).toBe('ja')
    expect(calls[0].headers['User-Agent']).toMatch(/Mozilla/)
    expect(results[0].code).toBe('RJ00473501')
  })

  it('详情：按 RJ 号请求 product.json', async () => {
    const { client, calls } = fakeNetwork(fixture('dlsite-product-RJ00398036.json'))
    const p = await client.product('RJ00398036')
    expect(calls[0].url).toBe('https://www.dlsite.com/maniax/api/=/product.json?workno=RJ00398036')
    expect(p?.circle).toBe('夢見工房')
  })

  it('请求之间隔 1–2 秒，第一个请求不等', async () => {
    const { client, waits } = fakeNetwork('[]')
    await Promise.all([client.product('RJ00398036'), client.product('RJ00473501'), client.product('RJ123456')])
    expect(waits).toHaveLength(2)
    for (const ms of waits) {
      expect(ms).toBeGreaterThanOrEqual(1000)
      expect(ms).toBeLessThanOrEqual(2000)
    }
  })

  it('HTTP 出错时抛出，带上状态码', async () => {
    const { client } = fakeNetwork('', 403)
    await expect(client.search('x')).rejects.toThrow('403')
  })

  it('不是作品号的输入不发请求', async () => {
    const { client, calls } = fakeNetwork('[]')
    await expect(client.product('../etc')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
