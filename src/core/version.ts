// 从压缩包名或文件夹名里取出版本号（names.ts 的 searchKeyword 只负责把它删掉）。
// 结果统一成“数字用点连起来 + 可能的一个字母后缀”：v1_0_4 → 1.0.4，V0.44e → 0.44e。

const PATTERNS: RegExp[] = [
  /(?<![a-z])v(?:er)?[._\s]?(\d+(?:[._]\d+)*)(?:[._]?([a-z]))?(?![a-z])/i, // ver1.05、Ver.1.3.6、v1_0_4、V0.44e
  /(?<![\d.])(\d+(?:\.\d+)+)([a-z])?(?![\d.a-z])/i, // 1.0.2、Room2.0.5
  /-(\d+(?:-\d+)+)()(?=-|$)/ // SlimeCraft-0-46
]

export function extractVersion(name: string): string | null {
  // 汉化补丁自己的版本（吹雪个人汉化V2修正版）不是游戏的版本
  const s = name.normalize('NFKC').replace(/[^\s_]*(?:官方中文|汉化|漢化)[^\s_]*/g, ' ')
  for (const re of PATTERNS) {
    const m = s.match(re)
    if (m) return m[1].split(/[._-]/).join('.') + (m[2] ?? '').toLowerCase()
  }
  return null
}
