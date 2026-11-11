import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProduct, parseSearchResults, rankCandidates, workUrl } from './dlsite'

// 照 DLsite 页面结构写的样本（2026-11-03 对照真实响应），作品都是虚构的，测试不联网
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('parseSearchResults', () => {
  it('读出 RJ 号、名字、社团、封面、作品类型', () => {
    expect(parseSearchResults(fixture('dlsite-search-single.html'))).toEqual([
      {
        code: 'RJ00473501',
        title: '蒼の旅団アリアとニナ',
        circle: 'Tin Lantern',
        coverUrl: 'https://img.dlsite.jp/modpub/images2/work/doujin/RJ00474000/RJ00473501_img_main.jpg',
        workType: 'アドベンチャー'
      }
    ])
  })

  it('多条结果按页面顺序全部读出，HTML 实体会解码', () => {
    const results = parseSearchResults(fixture('dlsite-search-multi.html'))
    expect(results).toHaveLength(30)
    expect(results[0]).toMatchObject({
      code: 'RJ00748612',
      title: 'ほのぼの、日常。 〜距離感バグりな子猫と、無自覚超密着ひなたぼっこ生活～',
      circle: '月見堂(旧:三色だんご屋)'
    })
    expect(results.map((r) => r.title)).toContain('【朗読&BGM&環境音】いっしょぐらし 〜ふわふわ子猫編〜【CV:星野ひかり】')
    expect(results.every((r) => /^(RJ|VJ|BJ)\d+$/.test(r.code) && r.title && r.circle && r.coverUrl.startsWith('https://'))).toBe(true)
  })

  it('没有结果时返回空数组', () => {
    expect(parseSearchResults(fixture('dlsite-search-empty.html'))).toEqual([])
  })
})

describe('parseProduct', () => {
  it('读出 product.json 里要用的字段', () => {
    expect(parseProduct(fixture('dlsite-product-RJ00398036.json'))).toMatchObject({
      code: 'RJ00398036',
      title: '【二択当て】【推理】星屑カジノへようこそ〜2匹の猫と2択当てゲーム〜',
      circle: '夢見工房',
      releaseDate: '2025-06-29',
      coverUrl: 'https://img.dlsite.jp/modpub/images2/work/doujin/RJ00399000/RJ00398036_img_main.jpg',
      genres: ['奇幻', '動物', '温馨', '推理', 'ギャンブル', '治愈', '日常/生活', '学園もの'], // 快照里有的 id 换成中文名，没有的照原样
      series: '星屑カジノ',
      languageEditions: [
        { code: 'RJ00398036', lang: 'JPN', label: '日本語' },
        { code: 'RJ00419765', lang: 'CHI_HANS', label: '簡体中文' }
      ]
    })
  })

  it('简介取 intro_s；没有语言版本时是空数组', () => {
    const p = parseProduct(fixture('dlsite-product-RJ00473501.json'))!
    expect(p.description.startsWith('◆三種のコンテンツを収録した姫と旅の物語◆')).toBe(true)
    expect(p.languageEditions).toEqual([])
    expect(p.series).toBe('姫シリーズ')
  })

  it('language_editions 是对象（键是数字字符串）时也能读出全部语言版本', () => {
    const p = parseProduct(fixture('dlsite-product-editions-object.json'))!
    expect(p.languageEditions).toEqual([
      { code: 'RJ01099001', lang: 'JPN', label: '日本語' },
      { code: 'RJ01099002', lang: 'ENG', label: '英語' },
      { code: 'RJ01099003', lang: 'CHI_HANS', label: '簡体中文' }
    ])
    expect(p.genres).toEqual(['像素', '冒険'])
  })

  it('类型词去掉 R-18G，按 id 用快照里的中文名（不同接口译名不同时也统一）', () => {
    const genres = [{ id: 199, name: '猟奇' }, { id: 157, name: '催眠' }, { id: 431, name: 'ドット' }]
    const p = parseProduct(JSON.stringify([{ workno: 'RJ01099009', work_name: 'x', maker_name: 'y', genres }]))!
    expect(p.genres).toEqual(['暗示', '像素'])
  })

  it('language_editions 和 genres 是 null 或缺失时得到空数组', () => {
    const base = { workno: 'RJ01099009', work_name: 'x', maker_name: 'y' }
    for (const extra of [{ language_editions: null, genres: null }, {}]) {
      const p = parseProduct(JSON.stringify([{ ...base, ...extra }]))!
      expect(p.languageEditions).toEqual([])
      expect(p.genres).toEqual([])
    }
  })

  it('查不到的 RJ 号（返回 []）得到 null', () => {
    expect(parseProduct(fixture('dlsite-product-notfound.json'))).toBeNull()
  })
})

describe('rankCandidates', () => {
  const r = (code: string, title: string) => ({ code, title, circle: '', coverUrl: '', workType: '' })

  it('名字和关键词越像越靠前，其余保持 DLsite 的顺序', () => {
    const ranked = rankCandidates('ハコニワ・テツドウ II', [
      r('RJ1', '全然関係ない作品'),
      r('RJ2', 'ハコニワ・テツドウ 体験版'),
      r('RJ3', '3D SLG ハコニワ・テツドウⅡ'),
      r('RJ4', 'ハコニワテツドウII'),
      r('RJ5', 'もうひとつ関係ない')
    ])
    expect(ranked.map((c) => c.code)).toEqual(['RJ4', 'RJ3', 'RJ1', 'RJ2', 'RJ5'])
  })
})

describe('workUrl', () => {
  it('RJ 号是同人区，VJ 号是商业区，BJ 号是书籍区', () => {
    expect(workUrl('RJ00473501')).toBe('https://www.dlsite.com/maniax/work/=/product_id/RJ00473501.html')
    expect(workUrl('VJ001234')).toBe('https://www.dlsite.com/pro/work/=/product_id/VJ001234.html')
    expect(workUrl('BJ001234')).toBe('https://www.dlsite.com/books/work/=/product_id/BJ001234.html')
  })

  it('不是作品号时返回 null，不拼网址', () => {
    expect(workUrl('')).toBeNull()
    expect(workUrl('RJ12/../x')).toBeNull()
  })
})
