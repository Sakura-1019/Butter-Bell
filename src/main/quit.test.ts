// 退出游戏：先正常关闭，5 秒内没关掉就告诉界面，由用户决定要不要强制结束
import { describe, expect, it } from 'vitest'
import { quitGame } from './quit'

function setup(pids: number[], closesAfter: number | null) {
  let t = 0
  let gone = false
  const log: string[] = []
  const deps = {
    close: async (p: number[]) => {
      log.push(`close ${p.join(',')}`)
      if (closesAfter === 0) gone = true
    },
    kill: async (p: number[]) => {
      log.push(`kill ${p.join(',')}`)
      gone = true
    },
    alive: () => !gone && !(closesAfter !== null && t >= closesAfter),
    sleep: async (ms: number) => void (t += ms)
  }
  return { deps, log, pids }
}

describe('quitGame', () => {
  it('正常关闭：游戏几秒内退出了，就算关掉了', async () => {
    const s = setup([10, 11], 2000)
    expect(await quitGame(s.pids, 'close', s.deps)).toBe('closed')
    expect(s.log).toEqual(['close 10,11'])
  })

  it('5 秒还没关掉（比如卡住了，或者在等用户点保存）：返回 stuck，不自作主张强制结束', async () => {
    const s = setup([10], null)
    expect(await quitGame(s.pids, 'close', s.deps)).toBe('stuck')
    expect(s.log).toEqual(['close 10'])
  })

  it('强制结束：结束整个进程树', async () => {
    const s = setup([10, 11], null)
    expect(await quitGame(s.pids, 'force', s.deps)).toBe('closed')
    expect(s.log).toEqual(['kill 10,11'])
  })

  it('没有在跟踪的进程：什么都不做', async () => {
    const s = setup([], null)
    expect(await quitGame(s.pids, 'close', s.deps)).toBe('none')
    expect(s.log).toEqual([])
  })
})
