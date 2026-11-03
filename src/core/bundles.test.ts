import { describe, expect, it } from 'vitest'
import { groupArchives } from './volumes'
import { bundleName, suggestBundles } from './bundles'

const names = (list: string[]) =>
  suggestBundles(groupArchives(list.map((name) => ({ name, size: 1 })))).map((g) => g.map((a) => a.firstVolumeName))

describe('suggestBundles', () => {
  it('编号开头、中间同名的几个压缩包建议成一套', () => {
    expect(
      names([
        '01_蒼の旅団アリアとニナ_ADV.rar',
        'Paper Garden.rar',
        '02_蒼の旅団アリアとニナ_動画.rar',
        '03_蒼の旅団アリアとニナ_CG集.rar'
      ])
    ).toEqual([['01_蒼の旅団アリアとニナ_ADV.rar', '02_蒼の旅団アリアとニナ_動画.rar', '03_蒼の旅団アリアとニナ_CG集.rar']])
  })

  it('分卷组按一个压缩包参与', () => {
    expect(names(['01_Foo Game_本体.part1.rar', '01_Foo Game_本体.part2.rar', '02_Foo Game_特典.zip'])).toEqual([
      ['01_Foo Game_本体.part1.rar', '02_Foo Game_特典.zip']
    ])
  })

  it('不带编号的相似名字不提示（存档、不同作品、同名重复下载）', () => {
    expect(
      names([
        '存档.rar',
        '存档 (2).rar',
        '夏雲ラジオ2＋.part1.rar',
        '夏雲ラジオ2～Perfect Edition～.part1.rar',
        'NeonKoi2.rar',
        '【PC】NeonKoi2.rar',
        '雨宿りの喫茶店 第1話.rar',
        '雨宿りの喫茶店 第2話.rar'
      ])
    ).toEqual([])
  })

  it('编号相同或名字不同的不算一套', () => {
    expect(names(['01_蒼の旅団_ADV.rar', '02_小さな竜と大きな森.rar', '01_蒼の旅団_CG.rar'])).toEqual([])
  })
})

describe('bundleName', () => {
  it('取去掉编号后的共同前缀，去掉末尾的分隔符', () => {
    const set = suggestBundles(groupArchives(['01_蒼の旅団アリアとニナ_ADV.rar', '02_蒼の旅団アリアとニナ_動画.rar'].map((name) => ({ name, size: 1 }))))[0]
    expect(bundleName(set)).toBe('蒼の旅団アリアとニナ')
  })
})
