// RJ 号（以及 VJ、BJ）：DLsite 的作品编号，6 位或 8 位数字。
const CODE = /(?<![A-Z])(RJ|VJ|BJ)(\d{8}|\d{6})(?!\d)/i

export function extractWorkCode(name: string): string | null {
  const m = name.normalize('NFKC').match(CODE)
  return m ? m[1].toUpperCase() + m[2] : null
}
