// 名称清洗：从压缩包的 stem（见 volumes.ts）或文件夹名得到适合去 DLsite 搜索的关键词。

const SEP = String.raw`[\s_\-+・]*`

// 按顺序执行。每条都连带吃掉前面的分隔符，替换成空格，最后再统一收拾空格。
const STRIP: RegExp[] = [
  /【[^】]*】|\[[^\]]*\]|\([^)]*\)/g, // 【PC】、[RPG]、(製品版ver1.0)、(2)
  new RegExp(String.raw`${SEP}[^\s_]*(?:官方中文|汉化|漢化)[^\s_]*`, 'g'), // DL官方中文、吹雪个人汉化V2修正版
  /^\d{1,2}_/, // 同套的编号 01_
  new RegExp(String.raw`${SEP}(?<![a-z])v(?:er)?[._\s]?\d+(?:[._]\d+)*(?:[._]?[a-z](?![a-z]))?`, 'gi'), // ver1.05、Ver.1.3.6、v1_0_4、V0.44e
  new RegExp(String.raw`${SEP}(?<![\d.])\d+(?:\.\d+)+[a-z]?(?![\d.])`, 'gi'), // 1.0.2、Room2.0.5
  /-\d+(?:-\d+)+(?=-|$)/g, // SlimeCraft-0-46
  /_/g
]

const NOISE: RegExp[] = [
  new RegExp(String.raw`${SEP}(?:DLsite特典|購入特典|特典付き版?|おまけセット|製品版|DL版|体験版|zh-CN)`, 'gi'),
  new RegExp(String.raw`(?:^|${SEP})(?:PC|Win|Windows|Crack)(?=$|[\s\-+・])`, 'gi')
]

export function searchKeyword(stem: string): string {
  let s = stem.normalize('NFKC')
  for (const re of [...STRIP, ...NOISE]) s = s.replace(re, ' ')
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s(]+|[\s(]+$/g, '')
}

// 用来比较 DLsite 结果和关键词：统一全角半角和大小写，去掉空格、中点、下划线
export function normalizeForMatch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s・·_]/g, '')
}
