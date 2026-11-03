// 启动文件判断：在解压后的游戏文件夹里给候选 exe 排序；没有 exe 时给 .html（纯 HTML 游戏）。只有一个候选时自动选中（见 GLOSSARY.md）。

export type Engine = 'rpgmaker-mv' | 'rpgmaker-mz' | 'unity' | 'renpy' | 'tyrano'

export interface LaunchRanking {
  engine: Engine | null
  autoPick: string | null
  candidates: string[] // 相对于游戏文件夹，用 / 分隔
}

// 运行库、安装器、崩溃上报这类永远不是启动文件
const EXCLUDED =
  /^(unitycrashhandler(32|64)?|notification_helper|crashpad_handler|nwjc|chromedriver|dxsetup|dxwebsetup|vc_?redist.*|uninst.*|unins\d+|ue4prereqsetup.*|oalinst)\.exe$/i

export function rankLaunchFiles(paths: string[]): LaunchRanking {
  const files = paths.map((p) => p.replace(/\\/g, '/'))
  const lower = files.map((p) => p.toLowerCase())
  const has = (prefix: string) => lower.some((p) => p.startsWith(prefix.toLowerCase()))

  const exes = files.filter((p) => /\.exe$/i.test(p) && !EXCLUDED.test(basename(p)))
  let engine: Engine | null = null
  const marked = new Set<string>()

  for (const exe of exes) {
    const dir = exe.slice(0, exe.length - basename(exe).length)
    const name = basename(exe).toLowerCase()
    const stem = basename(exe).slice(0, -4)
    const siblings = exes.filter((e) => e.startsWith(dir) && !e.slice(dir.length).includes('/'))
    const hasGameExe = siblings.some((e) => basename(e).toLowerCase() === 'game.exe')
    const rpgLauncher = name === 'game.exe' || (name === 'nw.exe' && !hasGameExe)

    let e: Engine | null = null
    if (has(`${dir}js/rmmz_core.js`) && rpgLauncher) e = 'rpgmaker-mz'
    else if (has(`${dir}www/`) && rpgLauncher) e = 'rpgmaker-mv'
    else if (has(`${dir}${stem}_Data/`)) e = 'unity'
    else if (has(`${dir}renpy/`) && has(`${dir}${stem}.py`)) e = 'renpy'
    else if (has(`${dir}tyrano/`) && name !== 'nw.exe') e = 'tyrano'
    if (e) {
      engine ??= e
      marked.add(exe)
    }
  }

  const depth = (p: string) => p.split('/').length
  // 纯 HTML 游戏（没有 exe）：最浅一层的 .html 是入口，更深的多半是游戏自己的页面
  if (!exes.length) {
    const pages = files.filter((p) => /\.html?$/i.test(p))
    const top = Math.min(...pages.map(depth))
    const candidates = pages.filter((p) => depth(p) === top).sort((a, b) => a.localeCompare(b))
    return { engine: null, autoPick: candidates.length === 1 ? candidates[0] : null, candidates }
  }
  const candidates = exes.sort(
    (a, b) => Number(marked.has(b)) - Number(marked.has(a)) || depth(a) - depth(b) || a.localeCompare(b)
  )
  const autoPick = marked.size === 1 ? [...marked][0] : candidates.length === 1 ? candidates[0] : null
  return { engine, autoPick, candidates }
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}
