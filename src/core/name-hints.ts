// 从压缩包里面找名字：压缩包名看不出内容（GAME.rar、PC.rar）时，名字常常在里面的文件夹名或引擎的配置里。
// paths 是游戏文件夹（或 7-Zip 列出的压缩包内容）里所有文件的相对路径；read 读其中一个小文本文件，读不到返回 undefined。
import { rankLaunchFiles } from './launch'
import { normalizeForMatch, searchKeyword } from './names'
import { extractWorkCode } from './rj'

export interface NameHints {
  workCode: string | null
  keywords: string[] // 去 DLsite 搜索用的关键词，最可能的在前
}

const GENERIC = new Set(['game', 'games', 'data', 'www', 'bin', 'nw', 'launcher', 'start', 'play', '本体', '游戏本体', 'ゲーム'])
const KANA = /[぀-ヿ]/

export function nameHints(stem: string, paths: string[], read: (path: string) => string | undefined): NameHints {
  const files = paths.map((p) => p.replace(/\\/g, '/'))
  const launch = rankLaunchFiles(files)
  const exe = launch.autoPick ?? launch.candidates[0]

  const titles = files.flatMap((p) => engineTitle(p, read))
  // DLsite 只认日文原名，所以带假名的标题排最前；汉化版改成的中文标题排在压缩包名后面
  // ponytail: 只按“有没有假名”粗分，够把日文原名提到前面
  const folders = exe ? exe.split('/').slice(0, -1) : topLevelDir(files)
  const ordered = [
    ...titles.filter((t) => KANA.test(t)),
    stem,
    ...titles.filter((t) => !KANA.test(t)),
    ...folders.reverse(),
    ...(exe && /.exe$/i.test(exe) ? [exe.slice(exe.lastIndexOf('/') + 1, -4)] : [])
  ]

  const seen = new Set<string>()
  const keywords: string[] = []
  for (const raw of ordered) {
    const k = searchKeyword(raw)
    const key = normalizeForMatch(k)
    if (!key || GENERIC.has(key) || seen.has(key)) continue
    seen.add(key)
    keywords.push(k)
  }

  const workCode = extractWorkCode(stem) ?? files.map(extractWorkCode).find((c) => c !== null) ?? null
  return { workCode, keywords }
}

// 引擎配置里写的作品名
function engineTitle(path: string, read: (path: string) => string | undefined): string[] {
  const name = path.toLowerCase()
  let title: string | undefined
  if (name === 'data/system.json' || name.endsWith('/data/system.json')) {
    title = json(read(path))?.gameTitle // RPG Maker MV/MZ
  } else if (name.endsWith('_data/app.info')) {
    title = read(path)?.split(/\r?\n/)[1] // Unity：第一行社团，第二行作品名
  } else if (name === 'data/system/config.tjs' || name.endsWith('/data/system/config.tjs')) {
    title = read(path)?.match(/System\.title\s*=\s*"([^"]*)"/)?.[1] // TyranoScript
  }
  return typeof title === 'string' && title.trim() ? [title.trim()] : []
}

function json(text: string | undefined): any {
  try {
    return text ? JSON.parse(text.replace(/^﻿/, '')) : undefined
  } catch {
    return undefined
  }
}

function topLevelDir(files: string[]): string[] {
  const dirs = new Set(files.filter((p) => p.includes('/')).map((p) => p.slice(0, p.indexOf('/'))))
  return dirs.size === 1 ? [...dirs] : []
}
