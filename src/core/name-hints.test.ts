import { describe, expect, it } from 'vitest'
import { nameHints } from './name-hints'

// 样本来自 G:\butter 和 G:\butter_compressed 里已解压的游戏
const reader = (files: Record<string, string>) => (path: string) => files[path]

describe('nameHints', () => {
  it('RPG Maker：System.json 里的日文标题排在压缩包名前面', () => {
    const paths = ['Game.exe', 'js/rmmz_core.js', 'data/System.json', 'package.json']
    const read = reader({ 'data/System.json': '\uFEFF{"gameTitle":"絶対に迷わない異世界ガイドブックver1.00"}' })
    expect(nameHints('異世界ガイドブックver1.00', paths, read).keywords).toEqual([
      '絶対に迷わない異世界ガイドブック',
      '異世界ガイドブック'
    ])
  })

  it('压缩包名看不出内容时，用内层文件夹名；不是日文的标题排在后面', () => {
    const paths = [
      '资源说明.txt',
      'Copper Lantern 2(内层)/Game.exe',
      'Copper Lantern 2(内层)/www/js/rpg_core.js',
      'Copper Lantern 2(内层)/www/data/System.json'
    ]
    const read = reader({ 'Copper Lantern 2(内层)/www/data/System.json': '{"gameTitle":"铜灯笼II"}' })
    expect(nameHints('GAME', paths, read).keywords).toEqual(['铜灯笼II', 'Copper Lantern 2'])
  })

  it('Unity：app.info 的第二行是作品名，exe 名重复时只留一个', () => {
    const paths = ['HoshiyomiSeijo.exe', 'HoshiyomiSeijo_Data/app.info', 'UnityCrashHandler64.exe', 'UnityPlayer.dll']
    const read = reader({ 'HoshiyomiSeijo_Data/app.info': 'KirakiraKeikaku\nHoshiyomiSeijo' })
    expect(nameHints('PC', paths, read).keywords).toEqual(['HoshiyomiSeijo', 'ほしよみせいじょ', 'ホシヨミセイジョ'])
  })

  it('TyranoScript：Config.tjs 里的 System.title', () => {
    const paths = ['MyNovel.exe', 'tyrano/libs.js', 'data/system/Config.tjs']
    const read = reader({ 'data/system/Config.tjs': ';System.title = "ふたりの夏休み";\n;System.version = 1' })
    expect(nameHints('110', paths, read).keywords).toEqual(['ふたりの夏休み', '110', 'MyNovel'])
  })

  it('没有 exe 的 HTML 游戏：用唯一的顶层文件夹名', () => {
    const paths = ['ひとりぼっちの灯台/000_start_todai.html', 'ひとりぼっちの灯台/data/001_op000.html', '玩前必看说明.txt']
    expect(nameHints('WIN', paths, () => undefined).keywords).toEqual(['ひとりぼっちの灯台'])
  })

  it('文件夹名里的 RJ 号也认', () => {
    const paths = ['RJ00398036/1.本編WAV/01.wav', 'RJ00398036/3.高画質メインイラスト.jpg']
    expect(nameHints('A760888', paths, () => undefined).workCode).toBe('RJ00398036')
  })

  it('Game、www、nw 这类通用名字不当关键词；坏掉的 JSON 不报错', () => {
    const paths = ['Game/Game.exe', 'Game/www/js/rpg_core.js', 'Game/www/data/System.json']
    const read = reader({ 'Game/www/data/System.json': '{坏的' })
    expect(nameHints('Windows', paths, read)).toEqual({ workCode: null, keywords: [] })
  })

  it('罗马音的关键词：紧跟着加平假名、片假名两个候补；英文标题不加', () => {
    expect(nameHints('yorunomori_v1_0_4', [], () => undefined).keywords).toEqual(['yorunomori', 'よるのもり', 'ヨルノモリ'])
    expect(nameHints('Still Alive Ver.1.25', [], () => undefined).keywords).toEqual(['Still Alive'])
  })
})

describe('nameHints：游戏窗口标题', () => {
  const paths = ['Game.exe', 'Data.wolf']
  it('带假名的窗口标题排最前，和配置里读到的标题一样', () => {
    expect(nameHints('GAME', paths, () => undefined, '魔女の館へようこそ - WOLF RPG Editor').keywords[0]).toBe('魔女の館へようこそ')
  })

  it('不带假名的窗口标题排在压缩包名后面；清洗后是通用名字的不要', () => {
    expect(nameHints('星の庭ver1.0', paths, () => undefined, '星之庭 汉化版').keywords.slice(0, 2)).toEqual(['星の庭', '星之庭'])
    expect(nameHints('星の庭', paths, () => undefined, 'Game').keywords).toEqual(['星の庭'])
  })

  it('没有窗口标题时和以前一样', () => {
    expect(nameHints('星の庭', paths, () => undefined, null).keywords).toEqual(['星の庭'])
  })
})
