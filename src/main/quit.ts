// 退出游戏（详情页的“退出游戏”）：先像点窗口右上角的 × 那样正常关闭，游戏有机会问要不要保存；
// 5 秒内没关掉就返回 stuck，界面再问用户要不要强制结束（会丢没保存的进度）。
import { execFile } from 'node:child_process'

export interface QuitDeps {
  close(pids: number[]): Promise<void> // 正常关闭：给窗口发关闭消息
  kill(pids: number[]): Promise<void> // 强制结束整个进程树
  alive(pid: number): boolean
  sleep(ms: number): Promise<void>
}

const WAIT_MS = 5000
const STEP_MS = 250

export async function quitGame(pids: number[], mode: 'close' | 'force', d: QuitDeps): Promise<'closed' | 'stuck' | 'none'> {
  if (!pids.length) return 'none'
  await (mode === 'force' ? d.kill(pids) : d.close(pids))
  for (let t = 0; t <= WAIT_MS; t += STEP_MS) {
    if (!pids.some(d.alive)) return 'closed'
    await d.sleep(STEP_MS)
  }
  return 'stuck'
}

// Windows 的 taskkill：不带 /F 是给窗口发关闭消息（游戏可以弹保存提示），带 /F /T 是强制结束整个进程树。
// 正常关闭不能带 /T：Unity 游戏会带一个没窗口的 UnityCrashHandler 子进程，带 /T 时 taskkill 因为它关不掉
// 就连主进程也不关（“这个进程的子进程还在运行”）。只给每个跟踪到的进程单独发，子进程会跟着主进程退出。
// 没有窗口的进程会报“只能强制结束”，这里不当成错误：是否关掉以 alive 为准
const taskkill = (pids: number[], force: boolean) =>
  new Promise<void>((resolve) =>
    execFile('taskkill', [...(force ? ['/F', '/T'] : []), ...pids.flatMap((p) => ['/PID', String(p)])], { windowsHide: true }, () => resolve())
  )

export const windowsQuitDeps: QuitDeps = {
  close: (pids) => taskkill(pids, false),
  kill: (pids) => taskkill(pids, true),
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM' // 管理员权限的进程看得到但碰不了，算还活着
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms))
}
