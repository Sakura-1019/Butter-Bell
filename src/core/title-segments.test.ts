import { describe, expect, it } from 'vitest'
import { joinSegments, splitTitle } from './title-segments'

const texts = (s: string) => splitTitle(s).map((x) => x.text)
const offs = (s: string) => splitTitle(s).filter((x) => !x.on).map((x) => x.text)

describe('splitTitle：把 DLsite 作品名拆成词段', () => {
  it('【】整段算一个词段，空格把其余部分切开', () => {
    expect(texts('【DLC制作中！】DECOY 群青の魔女')).toEqual(['【DLC制作中！】', 'DECOY', '群青の魔女'])
  })

  it('【】和 [] ［］默认熄灭，其余默认点亮', () => {
    expect(offs('【セール中】[体験版] ［新作］ 星の庭 (完全版)')).toEqual(['【セール中】', '[体験版]', '［新作］'])
  })

  it('() （）也整段算一个词段，贴着前面的字也能拆开', () => {
    expect(texts('星の庭(完全版) 月の庭（Ver.2）')).toEqual(['星の庭', '(完全版)', '月の庭', '（Ver.2）'])
  })

  it('全角空格也切', () => {
    expect(texts('星の庭　月の庭')).toEqual(['星の庭', '月の庭'])
  })

  it('〜…〜 和 ～…～ 整段算一个词段，里面的空格不切', () => {
    expect(texts('魔女の館 〜呪いの 森〜')).toEqual(['魔女の館', '〜呪いの 森〜'])
    expect(texts('魔女の館～呪いの森～ DX')).toEqual(['魔女の館', '～呪いの森～', 'DX'])
  })

  it('「」『』不拆开，里面的空格也不切', () => {
    expect(texts('ぼくと「夏の 終わり」 2')).toEqual(['ぼくと「夏の 終わり」', '2'])
  })

  it('括号没有配对时当普通字', () => {
    expect(texts('星の【庭 月')).toEqual(['星の【庭', '月'])
    expect(texts('ひとつ〜ふたつ')).toEqual(['ひとつ〜ふたつ'])
  })

  it('空字符串没有词段', () => {
    expect(splitTitle('  ')).toEqual([])
  })
})

describe('joinSegments：把点亮的词段拼回名称', () => {
  it('默认状态拼出去掉宣传字的名称', () => {
    expect(joinSegments(splitTitle('【DLC制作中！】DECOY 群青の魔女'))).toBe('DECOY 群青の魔女')
  })

  it('保留原来词段之间的间隔：贴着的还贴着，空格还是原来的空格', () => {
    const s = splitTitle('星の庭(完全版)　月')
    expect(joinSegments(s.map((x) => ({ ...x, on: true })))).toBe('星の庭(完全版)　月')
  })

  it('熄灭中间的词段，后面的词段沿用自己前面的间隔', () => {
    const s = splitTitle('A B C').map((x) => ({ ...x, on: x.text !== 'B' }))
    expect(joinSegments(s)).toBe('A C')
  })

  it('空格后面紧跟括号时，括号词段前面的空格不丢', () => {
    const s = splitTitle('星の庭 (完全版) 〜夏〜')
    expect(joinSegments(s.map((x) => ({ ...x, on: true })))).toBe('星の庭 (完全版) 〜夏〜')
  })

  it('第一个点亮的词段前面不带间隔', () => {
    const s = splitTitle('A B C').map((x) => ({ ...x, on: x.text !== 'A' }))
    expect(joinSegments(s)).toBe('B C')
  })

  it('全部熄灭是空字符串', () => {
    expect(joinSegments(splitTitle('A B').map((x) => ({ ...x, on: false })))).toBe('')
  })
})
