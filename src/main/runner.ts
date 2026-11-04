// 启动游戏、盯着它的进程树，退出时结束游玩会话。只统计从这里启动的游玩。
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { launchCommand, trackProcesses, type Proc } from '../core/play'
import { endSession, heartbeat, startSession } from './play'
import { now } from './settings'

export interface Running {
  gameId: number
  startedAt: string
}

interface Deps {
  db: Database.Database
  openPath(path: string): Promise<string> // shell.openPath：直接 spawn 不行（要管理员权限）时退回它，返回空字符串 = 成功
  onChange(running: Running[]): void
}

// 一个常驻的 PowerShell 每 3 秒列一次进程（只在有游戏在跑时开着）。不用原生模块，本机装不了需要编译的东西。
const SCRIPT = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, ExecutablePath) { "$($p.ProcessId)\`t$($p.ParentProcessId)\`t$($p.ExecutablePath)" }
  '---'
  Start-Sleep -Seconds 3
}`
const GRACE_MS = 60_000 // 一个进程都还没看到时（比如在等 UAC 确认）最多等这么久

export function createRunner({ db, openPath, onChange }: Deps) {
  const games = new Map<number, { sessionId: number; startedAt: string; t0: number; folder: string; pids: Set<number>; seen: boolean }>()
  let ps: ChildProcess | null = null

  const list = (): Running[] => [...games].map(([gameId, g]) => ({ gameId, startedAt: g.startedAt }))

  function tick(procs: Proc[]) {
    const t = now()
    let changed = false
    for (const [gameId, g] of games) {
      g.pids = trackProcesses(g.pids, procs, g.folder)
      if (g.pids.size) g.seen = true
      if (g.pids.size || (!g.seen && Date.now() - g.t0 < GRACE_MS)) heartbeat(db, g.sessionId, t)
      else endSession(db, g.sessionId, t), games.delete(gameId), (changed = true)
    }
    if (changed) onChange(list())
    if (!games.size) ps?.kill(), (ps = null)
  }

  function watch() {
    if (ps) return
    const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    ps = child
    let buf = ''
    let procs: Proc[] = []
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        if (line === '---') tick(procs), (procs = [])
        else {
          const [pid, ppid, path] = line.split('\t')
          procs.push({ pid: Number(pid), ppid: Number(ppid), path: path || null })
        }
      }
    })
    // PowerShell 意外退出：还有游戏在跑就重开一个
    child.on('exit', () => {
      if (ps === child) (ps = null), games.size && setTimeout(watch, 3000)
    })
  }

  return {
    list,
    // 截图用：这个游戏现在的进程（进程树 + 文件夹里的 exe，LE 启动的也靠文件夹找到）
    pids: (gameId: number): number[] => [...(games.get(gameId)?.pids ?? [])],
    // exe：启动文件的完整路径；folder：游戏文件夹；leProc：要用 LE 时是 LEProc.exe 的路径
    async launch(gameId: number, exe: string, folder: string, leProc: string | null): Promise<void> {
      if (games.has(gameId)) return
      const cmd = launchCommand(exe, leProc)
      const pid = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(cmd.file, cmd.args, { cwd: cmd.cwd, detached: true, stdio: 'ignore' })
        child.once('spawn', () => (child.unref(), resolve(child.pid ?? null)))
        child.once('error', async (e) => {
          // 要管理员权限的游戏 spawn 会失败，交给资源管理器（会弹 UAC）；LE 本身打不开就直接报错
          if (leProc) return reject(e)
          const err = await openPath(exe)
          err ? reject(new Error(err)) : resolve(null)
        })
      })
      const startedAt = now()
      // 用 LE 时 LEProc 拉起游戏后马上退出，游戏要靠文件夹认出来，所以不算“已经看到”，给一段宽限
      const seen = pid !== null && !leProc
      games.set(gameId, { sessionId: startSession(db, gameId, startedAt), startedAt, t0: Date.now(), folder, pids: new Set(pid ? [pid] : []), seen })
      onChange(list())
      watch()
    },
    stop() {
      ps?.kill()
    }
  }
}
