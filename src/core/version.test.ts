import { describe, expect, it } from 'vitest'
import { extractVersion } from './version'

describe('extractVersion', () => {
  it.each([
    ['LAMP騎士ver1.05', '1.05'],
    ['KITE-ROGUE PLUS Ver.1.3.6', '1.3.6'],
    ['hoshisekai_v1_0_4', '1.0.4'],
    ['魔女の森V0.44e', '0.44e'],
    ['天体観測士 1.0.2 吹雪个人汉化V2修正版', '1.0.2'],
    ['ふたりの魔法少女ステラティア(製品版ver1.0)', '1.0'],
    ['Lanternknights 製品版Ver1.00', '1.00'],
    ['【ver1_0_1】エレナのお菓子コレクション！！', '1.0.1'],
    ['幸せな子竜の育て方(Ver2.0.7', '2.0.7'],
    ['灯火と解放のラビリンス製品版1.32', '1.32'],
    ['YORUNOMORI_1.03', '1.03'],
    ['Room2.0.5', '2.0.5'],
    ['SlimeCraft-0-46', '0.46'],
    ['OppaiQuest-0.4.5-PC', '0.4.5'],
    ['3D_SLG_HAKO_II_ver1_0_d_DL官方中文', '1.0d'],
    ['ＬＡＭＰ騎士ｖｅｒ１．０５', '1.05'], // 全角
    ['PaperMoon Win ver028', '028']
  ])('%s → %s', (name, v) => expect(extractVersion(name)).toBe(v))

  it.each(['夏雲ラジオ 3', 'Moonvale', '3D_SLG_HAKO_II', 'Revenge2', 'GAME', '01_狂姫_ADV', 'RJ01234567'])('%s 没有版本号', (name) =>
    expect(extractVersion(name)).toBeNull()
  )
})
