// 调用自带的 7z.exe：试密码、解压、把出错信息归成几类。密码只放在命令行参数里，绝不写进日志或错误信息。
import { spawn } from 'node:child_process'
import { readdir, rename, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

export type Failure = 'wrong-password' | 'missing-volume' | 'corrupt' | 'not-archive' | 'unsupported' | 'disk-full' | 'cancelled' | 'other'

export class ExtractError extends Error {
  constructor(
    public reason: Failure,
    public detail = '',
    public space?: { need: number; free: number } // disk-full 时：要多少、还剩多少（字节）
  ) {
    super(detail ? `${reason}: ${detail}` : reason)
  }
}

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

function run(exe: string, args: string[], signal?: AbortSignal, onOut?: (chunk: string) => void): Promise<Run> {
  return new Promise((resolve, reject) => {
    // -sccUTF-8：控制台输出用 UTF-8，日文/中文文件名才不乱码；stdin 关掉，没给密码时 7-Zip 也不会卡在提问上
    const p = spawn(exe, [...args.slice(0, 1), '-sccUTF-8', ...args.slice(1)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    p.stdout.setEncoding('utf8').on('data', (s: string) => {
      stdout += s
      onOut?.(s)
    })
    p.stderr.setEncoding('utf8').on('data', (s: string) => (stderr += s))
    const abort = () => p.kill()
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort)
    p.on('error', reject)
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      resolve({ code, stdout, stderr })
    })
  })
}

export function classify(stderr: string): ExtractError {
  const firstError = stderr.split(/\r?\n/).find((l) => l.trim() && !/^ERRORS?:?\s*$/.test(l.trim()))?.trim() ?? ''
  if (/Wrong password/i.test(stderr)) return new ExtractError('wrong-password')
  if (/Missing volume|Unexpected end of archive|Cannot open the file as \[\w+\] archive/i.test(stderr)) return new ExtractError('missing-volume', firstError)
  if (/CRC Failed|Data Error|Headers Error/i.test(stderr)) return new ExtractError('corrupt', firstError)
  if (/Cannot open the file as archive/i.test(stderr)) return new ExtractError('not-archive')
  if (/Unsupported Method/i.test(stderr)) return new ExtractError('unsupported')
  if (/not enough space/i.test(stderr)) return new ExtractError('disk-full')
  return new ExtractError('other', firstError)
}

// 这个密码对不对：不对返回 null，对就返回解压后的总字节数（用来先查磁盘空间）。
// 不真的解压：先列目录（头部加密的包这一步就能判断），再只测试最小的一个加密文件
export async function probe(exe: string, archive: string, password: string, signal?: AbortSignal): Promise<number | null> {
  const l = await run(exe, ['l', '-slt', `-p${password}`, '--', archive], signal)
  if (signal?.aborted) throw new ExtractError('cancelled')
  if (/Wrong password/i.test(l.stderr)) return null
  if (l.code !== 0) throw classify(l.stderr)

  const entries = l.stdout
    .split(/\r?\n----------\r?\n/)[1]
    ?.split(/\r?\n\r?\n/)
    .map((block) => Object.fromEntries(block.split(/\r?\n/).map((line) => [line.slice(0, line.indexOf(' = ')), line.slice(line.indexOf(' = ') + 3)])))
  // 官方 7-Zip 不认识的压缩方式只显示成十六进制编号，比如“7-Zip 增强版”打包用的 zstd（04F71101）。先拦下来，不白解几个 G
  const unknown = (entries ?? []).find((e) => /(^|\s)[0-9A-F]{8}(\s|$)/.test(e.Method ?? ''))
  if (unknown) throw new ExtractError('unsupported', unknown.Method)
  const size = (entries ?? []).reduce((n, e) => n + (e.Folder === '+' ? 0 : Number(e.Size) || 0), 0)
  const encrypted = (entries ?? []).filter((e) => e.Encrypted === '+' && e.Folder !== '+')
  if (!encrypted.length) return size
  const smallest = encrypted.reduce((a, b) => (Number(b.Size) < Number(a.Size) ? b : a))
  const t = await run(exe, ['t', `-p${password}`, '--', archive, smallest.Path], signal)
  if (signal?.aborted) throw new ExtractError('cancelled')
  if (t.code === 0) return size
  if (/Wrong password/i.test(t.stderr)) return null
  throw classify(t.stderr)
}

// 解压到 dest（不存在会自动建）。progress 是 0–100。
export async function extract(exe: string, archive: string, dest: string, password: string, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  const zst = /\.zst$/i.test(archive)
  const once = async (file: string, extra: string[], scale: (p: number) => number) => {
    // 打开分卷时 7-Zip 也打百分比（“8% Open”“99%”），等出现“N% 文件数 - 文件名”才算开始解压
    let started = false
    const r = await run(exe, ['x', '-y', '-bso0', '-bsp1', `-p${password}`, `-o${dest}`, ...extra, '--', file], signal, (s) => {
      started ||= /\d+% \d+ - /.test(s)
      const m = started && s.match(/(\d+)%/g)
      if (m) onProgress(scale(parseInt(m[m.length - 1])))
    })
    if (signal?.aborted) throw new ExtractError('cancelled')
    if (r.code !== 0) throw classify(r.stderr)
    onProgress(scale(100)) // 小包解得太快，7-Zip 来不及打出 100%
  }

  if (!zst) return once(archive, [], (p) => p)

  // .tar.zst：7-Zip 先解出一个 tar，再解这个 tar，然后删掉中间的 tar（它是我们自己刚解出来的临时文件）
  await once(archive, [], (p) => p / 2)
  const inner = await readdir(dest)
  if (inner.length !== 1) return
  const tar = join(dest, inner[0])
  await once(tar, ['-ttar'], (p) => 50 + p / 2)
  await rm(tar)
}

// 解出来只有一个文件夹、没有别的文件时，把它往上提一层，免得变成 Foo\Foo\Game.exe
export async function flatten(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  if (entries.length !== 1 || !entries[0].isDirectory()) return
  const tmp = `${dir}.flat`
  await rename(join(dir, entries[0].name), tmp)
  await rmdir(dir)
  await rename(tmp, dir)
}
