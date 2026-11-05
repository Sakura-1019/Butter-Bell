// 游戏窗口标题当识别的候补词：去掉引擎名、FPS，乱码能还原就还原（第 6 项）。
// 对 Wolf RPG、吉里吉里这些读不到配置标题的游戏最有用。版本号等由 nameHints 里的 searchKeyword 统一去掉。
import { normalizeForMatch, searchKeyword } from './names'

const KANA = /[぀-ヿ]/
const HALF_KANA = /[｡-ﾟ]/
// 只有引擎名（可以带版本号或 MV、MZ、Z 这类后缀）的那一段
const ENGINE = /^(?:rpg ?maker|rpgツクール|unity|wolf ?rpg ?editor|ウディタ|吉里吉里|kirikiri|krkr|ren'?py|tyrano ?script|nw\.?js|electron|godot(?: engine)?)(?:[\s.]*[a-z0-9.]*)?$/i
const FPS = /[(（]?\s*fps\s*[:：]?\s*\d+(?:\.\d+)?\s*[)）]?/gi
const SEPARATOR = /\s+[-–—|]\s+|\s*[|｜／]\s*/

export function windowTitleHint(raw: string): string | null {
  let title = raw.trim()
  title = recoverShiftJis(title) ?? title
  if (title.includes('�') || (/[^\x00-\x7f]/.test(title) && title.includes('?'))) return null // 还原不了的乱码
  const part = title
    .replace(FPS, ' ')
    .split(SEPARATOR)
    .map((s) => s.trim())
    .find((s) => s && !ENGINE.test(s))
  return part && normalizeForMatch(searchKeyword(part)).length >= 2 ? part : null
}

// 简体中文系统上，没开 LE 的日文游戏的标题是“按 GBK 读坏的 Shift-JIS”：按 GBK 还原成字节，再按 Shift-JIS 读。
// 读出来带全角假名、不带半角假名才算还原成功（真正的中文标题这样读会冒出一堆半角假名或者读不通）。
export function recoverShiftJis(s: string): string | null {
  if (KANA.test(s) || !/[^\x00-\x7f]/.test(s)) return null
  const bytes: number[] = []
  for (const c of s) {
    const code = c.charCodeAt(0)
    if (code < 0x80) bytes.push(code)
    else {
      const b = gbkBytes().get(c)
      if (!b) return null
      bytes.push(...b)
    }
  }
  try {
    const out = new TextDecoder('shift_jis', { fatal: true }).decode(new Uint8Array(bytes))
    return KANA.test(out) && !HALF_KANA.test(out) ? out : null
  } catch {
    return null
  }
}

// GBK 的“字 → 两个字节”反查表，用解码器把所有双字节组合跑一遍得到，第一次用时才建
let table: Map<string, [number, number]> | undefined
function gbkBytes(): Map<string, [number, number]> {
  if (table) return table
  table = new Map()
  const dec = new TextDecoder('gbk')
  for (let a = 0x81; a <= 0xfe; a++)
    for (let b = 0x40; b <= 0xfe; b++) {
      if (b === 0x7f) continue
      const c = dec.decode(new Uint8Array([a, b]))
      if (c.length === 1 && c !== '�' && !table.has(c)) table.set(c, [a, b])
    }
  return table
}
