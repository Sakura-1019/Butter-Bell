// 罗马音关键词转成假名，给 DLsite 搜索多两个候补（DLsite 只认日文原名）。不做汉字转换。
import { toHiragana, toKatakana } from 'wanakana'

// 整个关键词都能转成假名、转完没有剩下拉丁字母时才给 [平假名, 片假名]；英文标题转不干净，不给
export function kanaVariants(keyword: string): string[] {
  const s = keyword.normalize('NFKC').toLowerCase()
  if (!/[a-z]/.test(s)) return []
  const hira = toHiragana(s)
  if (/[a-z]/i.test(hira)) return []
  return [hira, toKatakana(s)]
}
