// 启动游戏和判断游戏还在不在跑（见 GLOSSARY.md 的“游玩会话”“用 LE 启动”）。
import { win32 } from 'node:path'

export interface Proc {
  pid: number
  ppid: number
  path: string | null // 拿不到（比如管理员进程）时是 null
}

// 每次拿到一张进程快照就调一次：上一轮在跟踪的进程里还活着的，加上它们的子孙，再加上游戏文件夹里跑着的 exe。
// 很多游戏先开启动器再拉起本体，LE 也是 LEProc 拉起游戏后自己退出，所以要看整棵进程树和文件夹。返回空集合 = 游戏退出了。
// ponytail: 不防 pid 复用；两次快照之间（几秒）pid 被别的程序复用的概率可以忽略
export function trackProcesses(prev: Set<number>, procs: Proc[], folder: string): Set<number> {
  const prefix = win32.resolve(folder).toLowerCase() + '\\'
  const alive = new Set(procs.filter((p) => prev.has(p.pid) || (p.path && p.path.toLowerCase().startsWith(prefix))).map((p) => p.pid))
  for (let grew = true; grew; ) {
    grew = false
    for (const p of procs) if (!alive.has(p.pid) && alive.has(p.ppid)) alive.add(p.pid), (grew = true)
  }
  return alive
}

// leProc：设置里的 LEProc.exe；null = 不用 LE。-run 用 LE 的默认配置（日语区域）
export function launchCommand(exe: string, leProc: string | null) {
  const cwd = win32.dirname(exe)
  return leProc ? { file: leProc, args: ['-run', exe], cwd } : { file: exe, args: [] as string[], cwd }
}
