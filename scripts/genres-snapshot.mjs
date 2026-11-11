// 重新生成内置的 DLsite 标签库快照 src/core/genres.json。用法：node scripts/genres-snapshot.mjs [已下载的目录]
// 只读 5 个页面，每次间隔 2 秒。给了目录就直接读里面的文件（文件名见 FILES），不联网。
// 来源和取舍见交接文档“DLsite 标签和更新日期的调查结论”：中文名用 fsr/modal/lists，人气分类用 maniax 搜索页的 hot_genre，R-18G 整类去掉。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = {
  'maniax-zh_CN.json': 'https://www.dlsite.com/maniax/fsr/modal/lists?locale=zh_CN',
  'maniax-ja_JP.json': 'https://www.dlsite.com/maniax/fsr/modal/lists?locale=ja_JP',
  'home-zh_CN.json': 'https://www.dlsite.com/home/fsr/modal/lists?locale=zh_CN',
  'home-ja_JP.json': 'https://www.dlsite.com/home/fsr/modal/lists?locale=ja_JP',
  'maniax-search.html': 'https://www.dlsite.com/maniax/fsr/=/language/jp/order/trend/?locale=zh_CN'
}
// modal 里这几个还是日文，换成 /maniax/genre/list?locale=zh_CN 页面上的官方中文
const FIX = { 516: '跑团剧本', 517: '跑团回放合集', 518: '跑团规则书', 117: '放置play' }

const dir = process.argv[2]
const text = {}
for (const [name, url] of Object.entries(FILES)) {
  if (dir) text[name] = readFileSync(join(dir, name), 'utf8')
  else {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' } })
    if (!res.ok) throw new Error(`${url} 返回 ${res.status}`)
    text[name] = await res.text()
    await new Promise((r) => setTimeout(r, 2000))
  }
}

const values = (name) => Object.values(JSON.parse(text[name]).genre_lists).flatMap((c) => c.values.map((v) => ({ id: +v.value, name: v.name, cat: c.category_name })))
const zh = new Map()
for (const v of [...values('maniax-zh_CN.json'), ...values('home-zh_CN.json')]) if (!zh.has(v.id)) zh.set(v.id, { name: FIX[v.id] ?? v.name, cat: v.cat })
const jaList = [...values('maniax-ja_JP.json'), ...values('home-ja_JP.json')]
const ja = new Map()
for (const v of jaList) if (!ja.has(v.id)) ja.set(v.id, v.name)

const categories = []
for (const [id, v] of zh) {
  let c = categories.find((c) => c.name === v.cat)
  if (!c) categories.push((c = { name: v.cat, ids: [] }))
  c.ids.push(id)
}
const isR18G = (cat) => cat.startsWith('R-18G')
const excluded = [...new Set([...categories.filter((c) => isR18G(c.name)).flatMap((c) => c.ids), ...jaList.filter((v) => isR18G(v.cat)).map((v) => v.id)])].sort((a, b) => a - b)
const hot = [...text['maniax-search.html'].matchAll(/\{"val":"(\d+)","text":"(?:[^"\\]|\\.)*","category":"genre","type":"hot_genre"\}/g)].map((m) => +m[1])
const popular = [...new Set(hot)].filter((id) => !excluded.includes(id))
if (!popular.length || !zh.size) throw new Error('没解析出来，DLsite 页面可能改版了')

const out = {
  source: 'DLsite /maniax/ 和 /home/ 的 fsr/modal/lists（zh_CN、ja_JP）；人气分类是 maniax 搜索页的 hot_genre；R-18G 整类去掉',
  fetched: new Date().toISOString().slice(0, 10),
  categories: categories.filter((c) => !isR18G(c.name)).map((c) => ({ ...c, ids: c.ids.filter((id) => !excluded.includes(id)) })), // 日文版把个别词归在 R-18G 里，也一起去掉
  excluded, // R-18G 的 id：标签库不显示，识别时也不列
  popular, // 默认的“我的标签”
  genres: Object.fromEntries([...zh].map(([id, v]) => [id, ja.has(id) ? [v.name, ja.get(id)] : [v.name]])) // id → [中文, 日文]
}
writeFileSync(new URL('../src/core/genres.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`类型词 ${zh.size}，有日文名 ${ja.size}，人气 ${hot.length} → 去掉 R-18G 后 ${popular.length}，R-18G ${excluded.length}`)
console.log(popular.map((id) => zh.get(id).name).join(' '))
