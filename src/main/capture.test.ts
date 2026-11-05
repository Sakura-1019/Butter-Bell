// 截图封面的时机和结果（PowerShell、图片解码都换成假的）
import { describe, expect, it } from 'vitest'
import type { CoverSource } from '../core/cover'
import { createCapture, type Shot } from './capture'

function setup(shots: Shot[], opt: { cover?: CoverSource | null; running?: () => boolean; window?: () => Promise<'none' | 'fg' | 'bg'>; titles?: (string | null)[] } = {}) {
  const log: string[] = []
  const saved: [number, string, CoverSource][] = []
  const titles: [number, string][] = []
  let finds = 0
  const cap = createCapture({
    running: () => [{ gameId: 1, pids: [10] }],
    isRunning: opt.running ?? (() => true),
    coverSource: () => opt.cover ?? null,
    window: opt.window ?? (async () => (++finds < 3 ? 'none' : 'fg')), // 第 3 次才看到窗口
    activate: async () => void log.push('activate'),
    shoot: async () => shots.shift() ?? 'blank',
    title: async () => (opt.titles ?? []).shift() ?? null,
    saveTitle: (id, t) => void titles.push([id, t]),
    save: async (id, bytes, src) => void saved.push([id, String(bytes), src]),
    notify: (key) => void log.push(key),
    changed: () => void log.push('changed'),
    sleep: async (ms) => void log.push(`sleep ${ms}`)
  })
  return { cap, log, saved, titles }
}
const img = (s: string) => Buffer.from(s)

describe('自动截图', () => {
  it('窗口出现后等 5 秒，每 3 秒截一张，取第一张不是黑屏的，存成截图封面', async () => {
    const { cap, log, saved } = setup(['blank', 'blank', img('good')])
    await cap.auto(1)
    expect(saved).toEqual([[1, 'good', 'screenshot']])
    expect(log).toEqual(['capture.start', 'sleep 2000', 'sleep 2000', 'sleep 5000', 'sleep 3000', 'sleep 3000', 'capture.done', 'changed'])
  })

  it('游戏窗口不在最前面时不截、也不算次数', async () => {
    const { cap, saved } = setup(['background', 'background', 'blank', img('ok')])
    await cap.auto(1)
    expect(saved).toEqual([[1, 'ok', 'screenshot']])
  })

  it('5 次都是黑屏：放弃，提示可以手动截', async () => {
    const { cap, log, saved } = setup(['blank', 'blank', 'blank', 'blank', 'blank', img('late')])
    await cap.auto(1)
    expect(saved).toEqual([])
    expect(log.filter((l) => l.startsWith('capture'))).toEqual(['capture.start', 'capture.failed'])
  })

  it('已经有封面：不截', async () => {
    const { cap, log } = setup([img('x')], { cover: 'rpgmaker' })
    await cap.auto(1)
    expect(log).toEqual([])
  })

  it('游戏退出了：停下，什么都不提示', async () => {
    let n = 0
    const { cap, log, saved } = setup(['blank', img('x')], { running: () => ++n < 5 })
    await cap.auto(1)
    expect(saved).toEqual([])
    expect(log.filter((l) => l.startsWith('capture'))).toEqual(['capture.start'])
  })
})

describe('手动截图', () => {
  it('快捷键：截前台的那个游戏，算手选，有封面也换', async () => {
    const { cap, saved, log } = setup([img('mine')], { cover: 'dlsite', window: async () => 'fg' })
    await cap.hotkey()
    expect(saved).toEqual([[1, 'mine', 'manual']])
    expect(log).toContain('capture.manualDone')
  })

  it('详情页按钮：先把游戏窗口切到前面，倒数 3 秒再截；黑屏不换', async () => {
    const { cap, saved, log } = setup(['blank'], { window: async () => 'fg' })
    expect(await cap.now(1)).toBe('blank')
    expect(log.slice(0, 2)).toEqual(['activate', 'sleep 3000'])
    expect(saved).toEqual([])
  })
})

describe('记下窗口标题（识别时当候补词）', () => {
  it('窗口出现后等 10 秒读一次标题，原样存下', async () => {
    const { cap, log, titles } = setup([], { titles: ['魔女の館 - WOLF RPG Editor'] })
    await cap.recordTitle(1)
    expect(titles).toEqual([[1, '魔女の館 - WOLF RPG Editor']])
    expect(log).toEqual(['sleep 2000', 'sleep 2000', 'sleep 10000'])
  })

  it('清洗后没用的标题（只有引擎名、读不到）不存，免得盖掉以前存的', async () => {
    for (const t of ['RPG Maker MZ', null]) {
      const { cap, titles } = setup([], { titles: [t] })
      await cap.recordTitle(1)
      expect(titles).toEqual([])
    }
  })

  it('没等到窗口游戏就退出了：不读', async () => {
    let n = 0
    const { cap, titles } = setup([], { running: () => ++n < 2, titles: ['魔女の館'] })
    await cap.recordTitle(1)
    expect(titles).toEqual([])
  })
})
