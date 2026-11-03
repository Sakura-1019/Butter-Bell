// 用自带的 7z.exe 实际压缩、解压测试里临时生成的小压缩包
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { crc32, zstdCompressSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ExtractError, classify, extract, flatten, probe } from './sevenzip'

const EXE = resolve('resources/7zip/7z.exe')
let dir: string
const at = (...p: string[]) => join(dir, ...p)
const pack = (args: string[]) => execFileSync(EXE, ['a', '-bso0', ...args], { cwd: at('src') })
const files = (d: string) => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort()

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bb-7z-'))
  mkdirSync(at('src', '游戏'), { recursive: true })
  writeFileSync(at('src', '游戏', 'Game.exe'), 'exe')
  // 随机内容压不小，分卷才分得出来
  writeFileSync(at('src', '游戏', 'data.bin'), Buffer.from(Array.from({ length: 200_000 }, () => Math.floor(Math.random() * 256))))
  pack([at('plain.zip'), '游戏'])
  pack(['-psecret', '-mhe=on', at('head.7z'), '游戏']) // 头部也加密：不知道密码连目录都列不出来
  pack(['-psecret', at('files.zip'), '游戏']) // 只加密文件内容
  pack(['-v64k', at('split.7z'), '游戏']) // split.7z.001 / .002 …
  pack(['-ttar', at('t.tar'), '游戏'])
  writeFileSync(at('t.tar.zst'), zstdCompressSync(readFileSync(at('t.tar'))))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('probe：密码对不对，对的话解压后有多大', () => {
  it('不加密的包，什么密码都算对；返回解压后的总字节数', async () => {
    expect(await probe(EXE, at('plain.zip'), '')).toBe(200_003)
  })
  it.each(['head.7z', 'files.zip'])('%s：错的密码 null，对的密码给出大小', async (name) => {
    expect(await probe(EXE, at(name), '')).toBeNull()
    expect(await probe(EXE, at(name), 'nope')).toBeNull()
    expect(await probe(EXE, at(name), 'secret')).toBe(200_003)
  })
  it('不是压缩包：报 not-archive', async () => {
    writeFileSync(at('junk.rar'), 'not an archive')
    await expect(probe(EXE, at('junk.rar'), '')).rejects.toMatchObject({ reason: 'not-archive' })
  })
})

describe('extract', () => {
  it('普通 zip：解出全部文件，进度最后到 100', async () => {
    const seen: number[] = []
    await extract(EXE, at('plain.zip'), at('out1'), '', (p) => seen.push(p))
    expect(files(at('out1'))).toEqual(['Game.exe', 'data.bin'])
    expect(seen.at(-1)).toBe(100)
  })

  it('带密码的 7z：用对的密码解开；错的密码报 wrong-password', async () => {
    await expect(extract(EXE, at('head.7z'), at('bad'), 'nope', () => {})).rejects.toMatchObject({ reason: 'wrong-password' })
    await extract(EXE, at('head.7z'), at('out2'), 'secret', () => {})
    expect(files(at('out2'))).toEqual(['Game.exe', 'data.bin'])
  })

  it('.001 分卷：从第一卷解出全部文件', async () => {
    expect(readdirSync(dir).filter((n) => n.startsWith('split.7z.')).length).toBeGreaterThan(1)
    await extract(EXE, at('split.7z.001'), at('out3'), '', () => {})
    expect(files(at('out3'))).toEqual(['Game.exe', 'data.bin'])
  })

  it('缺最后一卷：报 missing-volume', async () => {
    mkdirSync(at('miss'))
    const vols = readdirSync(dir).filter((n) => n.startsWith('split.7z.')).sort()
    for (const v of vols.slice(0, -1)) writeFileSync(at('miss', v), readFileSync(at(v)))
    await expect(extract(EXE, at('miss', 'split.7z.001'), at('out4'), '', () => {})).rejects.toMatchObject({ reason: 'missing-volume' })
  })

  it('.tar.zst：解两层，不留中间的 tar', async () => {
    await extract(EXE, at('t.tar.zst'), at('out5'), '', () => {})
    expect(files(at('out5'))).toEqual(['Game.exe', 'data.bin'])
    expect(readdirSync(at('out5'))).toEqual(['游戏'])
  })

  // WinRAR 7 已经不能生成 RAR4、7-Zip 也不能压 rar，这里按 RAR 2.9/4 的格式手写一个“仅存储”的包
  it('RAR4（老格式）：能解开，日文文件名不乱码', async () => {
    writeFileSync(at('old.rar'), rar4([['游戏\\Game.exe', Buffer.from('exe')], ['游戏\\データ.txt', Buffer.from('こんにちは')]]))
    expect(execFileSync(EXE, ['l', '-slt', '-sccUTF-8', at('old.rar')]).toString()).toMatch(/^Type = Rar$/m) // 不是 Rar5
    expect(await probe(EXE, at('old.rar'), '')).not.toBeNull()
    await extract(EXE, at('old.rar'), at('out7'), '', () => {})
    expect(readFileSync(at('out7', '游戏', 'データ.txt'), 'utf8')).toBe('こんにちは')
  })

  it('取消：报 cancelled', async () => {
    const c = new AbortController()
    c.abort()
    const err = await extract(EXE, at('plain.zip'), at('out6'), '', () => {}, c.signal).catch((e) => e)
    expect(err).toBeInstanceOf(ExtractError)
    expect(err.reason).toBe('cancelled')
  })
})

describe('flatten', () => {
  it('只有一个文件夹时往上提一层', async () => {
    mkdirSync(at('f1', 'Foo', 'www'), { recursive: true })
    writeFileSync(at('f1', 'Foo', 'Game.exe'), '')
    await flatten(at('f1'))
    expect(readdirSync(at('f1')).sort()).toEqual(['Game.exe', 'www'])
  })
  it('有别的文件就不动', async () => {
    mkdirSync(at('f2', 'Foo'), { recursive: true })
    writeFileSync(at('f2', 'readme.txt'), '')
    await flatten(at('f2'))
    expect(readdirSync(at('f2')).sort()).toEqual(['Foo', 'readme.txt'])
  })
})

describe('classify', () => {
  it('不认识的压缩方式（如 7-Zip 增强版的 zstd）报 unsupported', () => {
    expect(classify('ERROR: Unsupported Method : Foo\a.txt').reason).toBe('unsupported')
  })
})

// 最简单的 RAR4：标记块、主头、每个文件一个“仅存储”的文件头加数据、结束块。头部 CRC 是 CRC32 的低 16 位。
// 文件名照 WinRAR 3/4 的写法（0x200 标志）：ASCII 名 + \0 + 编码过的 UTF-16；高字节记 0，每 4 个字符前放一个 0xAA（4 个“原样 2 字节”操作）。
function rar4(entries: [string, Buffer][]): Buffer {
  const head = (type: number, flags: number, body: Buffer) => {
    const h = Buffer.alloc(7 + body.length)
    h.writeUInt8(type, 2)
    h.writeUInt16LE(flags, 3)
    h.writeUInt16LE(h.length, 5)
    body.copy(h, 7)
    h.writeUInt16LE(crc32(h.subarray(2)) & 0xffff, 0)
    return h
  }
  const parts: Buffer[] = [Buffer.from('Rar!\x1a\x07\x00', 'latin1'), head(0x73, 0, Buffer.alloc(6))]
  for (const [name, data] of entries) {
    const utf16 = [...Buffer.from(name, 'utf16le')]
    const encoded = [0]
    for (let i = 0; i < utf16.length; i += 8) encoded.push(0xaa, ...utf16.slice(i, i + 8))
    const n = Buffer.concat([Buffer.from(name.replace(/[^ -~]/g, '_'), 'latin1'), Buffer.from([0, ...encoded])])
    const b = Buffer.alloc(25 + n.length)
    b.writeUInt32LE(data.length, 0) // 压缩后大小
    b.writeUInt32LE(data.length, 4) // 原大小
    b.writeUInt8(2, 8) // Windows
    b.writeUInt32LE(crc32(data), 9)
    b.writeUInt32LE(0x5b630000, 13) // DOS 时间：2025-11-03
    b.writeUInt8(29, 17) // 解压需要的版本 2.9，也就是 RAR 3.x / 4.x
    b.writeUInt8(0x30, 18) // 仅存储
    b.writeUInt16LE(n.length, 19)
    b.writeUInt32LE(0x20, 21) // 普通文件
    n.copy(b, 25)
    parts.push(head(0x74, 0x8000 | 0x200, b), data)
  }
  parts.push(head(0x7b, 0x4000, Buffer.alloc(0)))
  return Buffer.concat(parts)
}
