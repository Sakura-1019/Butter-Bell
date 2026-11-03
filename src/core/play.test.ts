import { describe, expect, it } from 'vitest'
import { launchCommand, trackProcesses, type Proc } from './play'

const DIR = String.raw`G:\butter\蒼の旅団`
const p = (pid: number, ppid: number, path: string | null): Proc => ({ pid, ppid, path })

describe('trackProcesses：游戏还在不在跑', () => {
  it('启动器拉起子进程后自己退出：子进程接着算', () => {
    let s = trackProcesses(new Set([100]), [p(100, 1, String.raw`C:\Other\launcher.exe`)], DIR)
    s = trackProcesses(s, [p(100, 1, String.raw`C:\Other\launcher.exe`), p(200, 100, String.raw`C:\Elsewhere\game.exe`)], DIR)
    expect([...s].sort()).toEqual([100, 200])
    s = trackProcesses(s, [p(200, 100, String.raw`C:\Elsewhere\game.exe`)], DIR)
    expect([...s]).toEqual([200])
    expect(trackProcesses(s, [], DIR).size).toBe(0)
  })

  it('孙进程也算（父进程先出现在同一张快照里）', () => {
    const s = trackProcesses(new Set([1]), [p(3, 2, null), p(2, 1, null), p(1, 0, null)], DIR)
    expect([...s].sort()).toEqual([1, 2, 3])
  })

  it('游戏文件夹里的进程都算，不管是谁启动的（LE 拉起游戏后 LEProc 马上退出）；大小写不敏感', () => {
    const s = trackProcesses(new Set([9]), [p(50, 4, String.raw`g:\BUTTER\蒼の旅団\Game.exe`), p(51, 4, String.raw`G:\butter\蒼の旅団 (2)\Game.exe`)], DIR)
    expect([...s]).toEqual([50])
  })

  it('不认识的进程不算；死掉的进程从集合里去掉', () => {
    expect(trackProcesses(new Set([7]), [p(8, 1, String.raw`C:\x.exe`)], DIR).size).toBe(0)
  })
})

describe('launchCommand：启动参数', () => {
  const exe = String.raw`G:\butter\蒼の旅団\bin\Game.exe`
  it('直接运行启动文件，工作目录是 exe 所在目录', () => {
    expect(launchCommand(exe, null)).toEqual({ file: exe, args: [], cwd: String.raw`G:\butter\蒼の旅団\bin` })
  })
  it('用 LE：LEProc.exe -run <启动文件>，工作目录同样是 exe 所在目录', () => {
    const le = String.raw`D:\Tools\LE\LEProc.exe`
    expect(launchCommand(exe, le)).toEqual({ file: le, args: ['-run', exe], cwd: String.raw`G:\butter\蒼の旅団\bin` })
  })
})
