// 封面从哪里来、谁能替换谁，以及从游戏文件夹里找封面、判断截图能不能用。

// 从高到低：用户手选（含手动截图）> DLsite > 游戏目录里的图片 > RPG Maker 标题画面 > 自动截图
export type CoverSource = 'manual' | 'dlsite' | 'folder' | 'rpgmaker' | 'screenshot'
const RANK: Record<CoverSource, number> = { manual: 5, dlsite: 4, folder: 3, rpgmaker: 2, screenshot: 1 }

// 自动拿到的封面能不能换掉现在的：没有封面就能放；手选的永远不被自动替换；其余只换更高一档的
export function outranks(next: CoverSource, current: CoverSource | null): boolean {
  if (current === null) return true
  if (current === 'manual') return false
  return RANK[next] > RANK[current]
}

// 游戏目录里的图片：根目录或往下两层以内，文件名像 cover / jacket / package / thumb / title / 封面。
// 引擎的素材目录（img、www、data …）里的 title.png 是游戏自己的图，不算
const NAMES = [/cover/i, /jacket/i, /package/i, /thumb/i, /title/i, /封面/]
const WORD = /(^|[^a-z])(cover|jacket|package|thumb|thumbnail|title)([^a-z]|$)/i
const ASSET_DIR = /^(img|www|data|audio|js|assets|resources|.*_data)$/i

export function findFolderCover(paths: string[]): string | null {
  let best: { path: string; rank: number; depth: number } | null = null
  for (const path of paths) {
    const parts = path.split('/')
    const file = parts[parts.length - 1]
    const m = file.match(/^(.+)\.(jpe?g|png|webp)$/i)
    if (!m || parts.length > 3 || parts.slice(0, -1).some((d) => ASSET_DIR.test(d))) continue
    if (!WORD.test(m[1]) && !m[1].includes('封面')) continue
    const rank = NAMES.findIndex((re) => re.test(m[1]))
    const depth = parts.length
    if (!best || rank < best.rank || (rank === best.rank && depth < best.depth)) best = { path, rank, depth }
  }
  return best?.path ?? null
}

// RPG Maker MV/MZ 的标题画面：data/System.json 的 title1Name，图在同级的 img/titles1/ 下。
// MV 加密后是 .rpgmvp，MZ 是 .png_，要用 decryptRpgImage 还原
export function rpgTitleImage(paths: string[], read: (path: string) => string | undefined): { path: string; encrypted: boolean } | null {
  const lower = new Map(paths.map((p) => [p.toLowerCase(), p]))
  for (const sys of paths.filter((p) => /(^|\/)data\/system\.json$/i.test(p))) {
    let name: unknown
    try {
      name = JSON.parse((read(sys) ?? '').replace(/^﻿/, '')).title1Name
    } catch {
      continue
    }
    if (typeof name !== 'string' || !name) continue
    const base = sys.slice(0, sys.length - 'data/System.json'.length)
    for (const ext of ['png', 'rpgmvp', 'png_']) {
      const hit = lower.get(`${base}img/titles1/${name}.${ext}`.toLowerCase())
      if (hit) return { path: hit, encrypted: ext !== 'png' }
    }
  }
  return null
}

// 加密格式：16 字节的 "RPGMV" 文件头，后面是 PNG，只有前 16 字节和密钥异或过。
// PNG 的前 16 字节是固定的（文件签名 + IHDR 块头），直接换回来就行，不用密钥
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]
export function decryptRpgImage(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 32 || String.fromCharCode(...bytes.slice(0, 5)) !== 'RPGMV') return null
  const out = bytes.slice(16)
  out.set(PNG_HEAD, 0)
  return out
}

// 截图是不是近乎全黑或纯色（加载中、黑屏、窗口还没画出来）。bgra：每像素 4 字节（Electron nativeImage.toBitmap 的格式）。
// 隔点取样，和占多数的颜色（各通道中位数）差得明显的点不到 2%，就算不能用
export function isBlankImage(bgra: Uint8Array, width: number, height: number): boolean {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 20000)))
  const samples: number[] = []
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) samples.push((y * width + x) * 4)
  if (!samples.length) return true
  const median = [0, 1, 2].map((c) => {
    const hist = new Array(256).fill(0)
    for (const i of samples) hist[bgra[i + c]]++
    let n = 0
    for (let v = 0; v < 256; v++) if ((n += hist[v]) * 2 >= samples.length) return v
    return 255
  })
  const off = samples.filter((i) => [0, 1, 2].some((c) => Math.abs(bgra[i + c] - median[c]) > 24)).length
  return off / samples.length < 0.02
}

// 看文件头判断图片格式，不信扩展名
export function imageType(b: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp'
  return null
}
