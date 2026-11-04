import { describe, expect, it } from 'vitest'
import { kanaVariants } from './romaji'

describe('kanaVariants', () => {
  it('整个关键词都是罗马音：给出平假名和片假名', () => {
    expect(kanaVariants('hoshisekai')).toEqual(['ほしせかい', 'ホシセカイ'])
    expect(kanaVariants('Yorunomori')).toEqual(['よるのもり', 'ヨルノモリ'])
  })

  it('空格和数字照留', () => {
    expect(kanaVariants('kanade 2')).toEqual(['かなで 2', 'カナデ 2'])
  })

  it.each(['Still Alive', 'Copper Lantern 2', 'LAMP騎士', 'Cursed Armor'])('%s 转完还剩拉丁字母，不给', (k) =>
    expect(kanaVariants(k)).toEqual([])
  )

  it.each(['ハコニワ', '星読の教団', '123', ''])('%s 没有罗马音，不给', (k) => expect(kanaVariants(k)).toEqual([]))
})
