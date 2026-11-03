import { expect, it } from 'vitest'
import { createDlsiteClient } from './dlsite-http'
import { rankCandidates } from './dlsite'

// 真实联网的冒烟测试，npm test 里跳过。关键词用一个 DLsite 上确实有的作品名：
//   SMOKE_KEYWORD=<作品名> npm run smoke:dlsite
it.runIf(import.meta.env.MODE === 'smoke')('用 SMOKE_KEYWORD 搜 DLsite 并拿详情', { timeout: 30_000 }, async () => {
  const keyword = process.env.SMOKE_KEYWORD
  if (!keyword) throw new Error('先设 SMOKE_KEYWORD')
  const client = createDlsiteClient()
  const candidates = rankCandidates(keyword, await client.search(keyword))
  const spaced = await client.search(`${keyword} 2`) // 空格要转成 +，写成 %20 会 403
  const detail = await client.product(candidates[0].code)
  console.log(JSON.stringify({ candidates, spacedCount: spaced.length, detail: { ...detail, description: detail?.description.slice(0, 40) } }, null, 2))
  expect(candidates[0].title).toContain(keyword)
  expect(detail?.title).toBe(candidates[0].title)
})
