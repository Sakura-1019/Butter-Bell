import { describe, expect, it } from 'vitest'
import { normalizeForMatch, searchKeyword } from './names'
import { groupArchives } from './volumes'

// 输入是压缩包的 stem（已去掉扩展名和分卷后缀）或现成文件夹名
describe('searchKeyword', () => {
  it.each([
    ['Lanternknights 製品版Ver1.00', 'Lanternknights'],
    ['LAMP騎士ver1.05', 'LAMP騎士'],
    ['KITE-ROGUE PLUS Ver.1.3.6', 'KITE-ROGUE PLUS'],
    ['PaperMoon Win ver028', 'PaperMoon'],
    ['3D_SLG_HAKO_II_ハコニワ・テツドウII_ver1_0_d_DL官方中文', '3D SLG HAKO II ハコニワ・テツドウII'],
    ['【PC】夏雲ラジオ 3', '夏雲ラジオ 3'],
    ['【PC版】LUMEN 群青の図書館', 'LUMEN 群青の図書館'],
    ['【ver1_0_1】エレナのお菓子コレクション！！', 'エレナのお菓子コレクション!!'],
    ['【MTool外挂】FalseLantern2【Ver1.2】', 'FalseLantern2'],
    ['[RPG]克里丝汀娜面包店日记   072官方中文', '克里丝汀娜面包店日记'],
    ['天体観測士 1.0.2 吹雪个人汉化V2修正版', '天体観測士'],
    ['ふたりの魔法少女ステラティア(製品版ver1.0)', 'ふたりの魔法少女ステラティア'],
    ['幸せな子竜の育て方(Ver2.0.7', '幸せな子竜の育て方'],
    ['廃村探検隊 弐DL版', '廃村探検隊 弐'],
    ['星読の教団　製品版', '星読の教団'],
    ['灯火と解放のラビリンス製品版1.32', '灯火と解放のラビリンス'],
    ['魔女のパン屋 体験版', '魔女のパン屋'],
    ["Karryn's Prison (2)", "Karryn's Prison"],
    ['三色繚乱+DLsite特典_+_購入特典_+_おまけセット_+_Crack', '三色繚乱'],
    ['エルフ姫回顧録_旅する姫と亡国の夢_特典付き版', 'エルフ姫回顧録 旅する姫と亡国の夢'],
    ['YORUNOMORI_1.03', 'YORUNOMORI'],
    ['hoshisekai_v1_0_4', 'hoshisekai'],
    ["PC  Hinata's lucky day_v1_0_5", "Hinata's lucky day"],
    ['NeonKoiDrift-0.4.5-PC', 'NeonKoiDrift'],
    ['SlimeCraft-0-46-pc', 'SlimeCraft'],
    ['Minna no Mahou Gakuen V0.44e', 'Minna no Mahou Gakuen'],
    ['The Cradle of Sleeping Stars(Ver 0.1.33)_pc', 'The Cradle of Sleeping Stars'],
    ['カラクリカジノ～時計城カラクリ～ver1_09', 'カラクリカジノ~時計城カラクリ~'],
    ['Room2.0.5_zh-CN', 'Room'],
    ['面包店六重奏V1.0.8 Windows', '面包店六重奏'],
    ['すれ違う兄妹の夏休み日記 PC', 'すれ違う兄妹の夏休み日記'],
    ['PC・製品版', ''],
    ['01_蒼の旅団アリアとニナ_ADV', '蒼の旅団アリアとニナ ADV'],
    ['夏雲ラジオ2＋', '夏雲ラジオ2+'],
    ['蒼の旅団', '蒼の旅団']
  ])('%s → %s', (stem, keyword) => {
    expect(searchKeyword(stem)).toBe(keyword)
  })

  it('分卷后缀经由压缩包的 stem 去掉', () => {
    const [a] = groupArchives([{ name: 'ヒダマリノウエンv4.00.part1.rar', size: 1 }])
    expect(searchKeyword(a.stem)).toBe('ヒダマリノウエン')
  })
})

describe('normalizeForMatch', () => {
  it('统一全角半角、大小写，去掉空格、中点和下划线', () => {
    expect(normalizeForMatch('ＬＡＭＰ騎士　ﾊｺﾆﾜ・テツドウ_II')).toBe(normalizeForMatch('lamp騎士ハコニワテツドウii'))
    expect(normalizeForMatch('ハコニワ・テツドウII')).toBe('ハコニワテツドウii')
  })
})
