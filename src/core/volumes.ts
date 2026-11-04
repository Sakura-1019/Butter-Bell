// 把仓库目录里的文件分成压缩包：一个压缩包由一个或多个分卷组成（见 GLOSSARY.md）。

export interface FileEntry {
  name: string
  size: number
  mtime?: string // 文件修改时间（ISO），也就是下载时间；只有扫描仓库目录时才有
}

export interface Archive {
  firstVolumeName: string // 现有分卷里序号最小的那个，和 ADR 0001 的身份一致
  stem: string // 去掉扩展名和分卷后缀的名字，如 Foo.part1.rar → Foo
  format: string // rar / 7z / zip / zst
  multiVolume: boolean
  volumes: FileEntry[] // 按序号排好
  totalSize: number
  missing: number[] // 1 到最大序号之间缺的分卷；最后几卷缺了看不出来
}

const VOLUME_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  // Foo.part1.rar、Foo_part01.rar、Foo.part01 (2).rar
  [/^(.*)[._]part(\d+)((?: \(\d+\))?)\.rar$/i, () => 'rar'],
  // Foo.7z.001、Foo_7z.001、Foo.zip.001
  [/^(.*)[._](7z|zip|rar)\.(\d{3})()$/i, (m) => m[2].toLowerCase()],
  // Foo.001：7-Zip 按内容识别，交给它就行
  [/^(.*)\.(\d{3})()$/, () => '7z']
]

const SINGLE = /\.(rar|7z|zip|zst)$/i

export function groupArchives(files: FileEntry[]): Archive[] {
  const groups = new Map<string, { format: string; multiVolume: boolean; stem: string; parts: { seq: number; file: FileEntry }[] }>()

  for (const file of files) {
    let key: string | undefined
    let format = ''
    let seq = 1
    let stem = ''
    for (const [re, fmt] of VOLUME_PATTERNS) {
      const m = file.name.match(re)
      if (!m) continue
      format = fmt(m)
      const digits = m[m.length - 2]
      seq = Number(digits)
      stem = m[1]
      key = `${m[1]}\0${format}\0${m[m.length - 1]}`
      break
    }
    if (key === undefined) {
      const m = file.name.match(SINGLE)
      if (!m) continue
      format = m[1].toLowerCase()
      stem = file.name.replace(/\.[^.]+$/, '').replace(/[._]tar(\.zst)?$/i, '')
      key = `\0single\0${file.name}`
    }
    const g = groups.get(key) ?? { format, stem, multiVolume: !key.startsWith('\0single'), parts: [] }
    g.parts.push({ seq, file })
    groups.set(key, g)
  }

  return [...groups.values()].map((g) => {
    g.parts.sort((a, b) => a.seq - b.seq)
    const have = new Set(g.parts.map((p) => p.seq))
    const max = g.parts[g.parts.length - 1].seq
    const missing: number[] = []
    for (let i = 1; i < max; i++) if (!have.has(i)) missing.push(i)
    const volumes = g.parts.map((p) => p.file)
    return {
      firstVolumeName: volumes[0].name,
      stem: g.stem,
      format: g.format,
      multiVolume: g.multiVolume,
      volumes,
      totalSize: volumes.reduce((s, v) => s + v.size, 0),
      missing
    }
  })
}
