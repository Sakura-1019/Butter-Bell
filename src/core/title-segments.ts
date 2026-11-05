// 识别页拼名称：把 DLsite 作品名拆成词段，用户点亮 / 熄灭，再拼回去。
// 例："【DLC制作中！】DECOY 群青の魔女" → 【DLC制作中！】(熄灭) | DECOY | 群青の魔女

export interface Segment {
  text: string
  gap: string // 原名里这个词段前面的间隔（空格，或贴着时是空字符串），拼回去时照用
  on: boolean
}

// 整段算一个词段的括号：前四种贴着字也拆开；【】和 [] ［］几乎都是宣传字，默认熄灭
const SPLIT = { '【': '】', '[': ']', '［': '］', '(': ')', '（': '）' } as Record<string, string>
const OFF = new Set(['【', '[', '［'])
// 不拆、只是里面的空格不切的：〜副标题〜 和引号，都是名字的一部分
const KEEP = { '〜': '〜', '～': '～', '「': '」', '『': '』' } as Record<string, string>

export function splitTitle(name: string): Segment[] {
  const out: Segment[] = []
  let cur = ''
  let gap = ''
  const push = (on = true) => {
    if (!cur) return
    out.push({ text: cur, gap: out.length ? gap : '', on })
    cur = ''
    gap = ''
  }
  for (let i = 0; i < name.length; ) {
    const c = name[i]
    if (/\s/.test(c)) {
      push()
      gap += c
      i++
      continue
    }
    const close = SPLIT[c] ?? KEEP[c]
    const end = close ? name.indexOf(close, i + 1) : -1
    if (end < 0) {
      cur += c
      i++
    } else if (SPLIT[c]) {
      push()
      cur = name.slice(i, end + 1)
      push(!OFF.has(c))
      i = end + 1
    } else if (c === '〜' || c === '～') {
      // 〜副标题〜 单独成一个词段
      push()
      cur = name.slice(i, end + 1)
      push()
      i = end + 1
    } else {
      cur += name.slice(i, end + 1) // 引号连着前后的字，算在同一个词段里
      i = end + 1
    }
  }
  push()
  return out
}

export function joinSegments(segments: Segment[]): string {
  return segments
    .filter((s) => s.on)
    .map((s, i) => (i ? s.gap : '') + s.text)
    .join('')
}
