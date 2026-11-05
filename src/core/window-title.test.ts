import { describe, expect, it } from 'vitest'
import { recoverShiftJis, windowTitleHint } from './window-title'

// 造乱码：日文按 Shift-JIS 存成字节，再被简体中文系统按 GBK 读出来（没开 LE 的老游戏就是这样）
const sjis = (() => {
  const map = new Map<string, number[]>()
  const dec = new TextDecoder('shift_jis')
  for (let a = 0x81; a <= 0xfc; a++)
    for (let b = 0x40; b <= 0xfc; b++) {
      const c = dec.decode(new Uint8Array([a, b]))
      if (c.length === 1 && c !== '�' && !map.has(c)) map.set(c, [a, b])
    }
  return (s: string) => new Uint8Array([...s].flatMap((c) => (c.charCodeAt(0) < 0x80 ? [c.charCodeAt(0)] : map.get(c)!)))
})()
const garble = (s: string) => new TextDecoder('gbk').decode(sjis(s))

describe('recoverShiftJis：把 GBK 读坏的日文还原回来', () => {
  it('能还原成带假名的日文', () => {
    expect(garble('魔女の館へようこそ')).not.toBe('魔女の館へようこそ')
    expect(recoverShiftJis(garble('魔女の館へようこそ'))).toBe('魔女の館へようこそ')
    expect(recoverShiftJis(garble('ドキドキ学園 Ver1.02'))).toBe('ドキドキ学園 Ver1.02')
  })

  it('正常的中文、日文、英文不动', () => {
    expect(recoverShiftJis('诅咒铠甲II')).toBeNull()
    expect(recoverShiftJis('星の庭')).toBeNull()
    expect(recoverShiftJis('Starlit Garden')).toBeNull()
  })
})

describe('windowTitleHint：窗口标题清洗成候补词', () => {
  it('去掉引擎名那一段', () => {
    expect(windowTitleHint('魔女の館 - RPGツクールMV')).toBe('魔女の館')
    expect(windowTitleHint('Unity 2021.3.1f1 | Starlit Garden')).toBe('Starlit Garden')
    expect(windowTitleHint('星の庭 – WOLF RPG Editor')).toBe('星の庭')
    expect(windowTitleHint('吉里吉里Z／月の庭')).toBe('月の庭')
  })

  it('有好几段时取第一段（后面多半是章节名）', () => {
    expect(windowTitleHint('魔女の館 - 第1章 森')).toBe('魔女の館')
  })

  it('去掉 FPS 计数', () => {
    expect(windowTitleHint('星の庭 FPS:60')).toBe('星の庭')
    expect(windowTitleHint('星の庭 (FPS 59.9)')).toBe('星の庭')
  })

  it('乱码能还原就用还原后的', () => {
    expect(windowTitleHint(garble('魔女の館へようこそ'))).toBe('魔女の館へようこそ')
  })

  it('带 ? 或 � 的非英文标题当乱码丢掉', () => {
    expect(windowTitleHint('魔女の?館')).toBeNull()
    expect(windowTitleHint('魔女の�館')).toBeNull()
    expect(windowTitleHint('Who are you?')).toBe('Who are you?')
  })

  it('只有引擎名、太短、空的不要', () => {
    expect(windowTitleHint('RPG Maker MZ')).toBeNull()
    expect(windowTitleHint('Unity')).toBeNull()
    expect(windowTitleHint('A')).toBeNull()
    expect(windowTitleHint('  ')).toBeNull()
  })
})
