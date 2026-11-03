import { describe, expect, it } from 'vitest'
import { rankLaunchFiles } from './launch'

// 路径都相对于游戏文件夹，样本取自用户 G:\butter 和 G:\butter_compressed 里已解压的游戏
describe('rankLaunchFiles', () => {
  it('RPG Maker MZ：选 Game.exe，自带的 MTool 工具排在后面', () => {
    const r = rankLaunchFiles([
      'Game.exe',
      'notification_helper.exe',
      'js/rmmz_core.js',
      'package.json',
      'Tool/MTool.exe',
      'Tool/nw.exe',
      'Tool/nwjc.exe',
      'Tool/chromedriver.exe',
      'Tool/notification_helper.exe',
      'Tool/loaders/inject.exe'
    ])
    expect(r.engine).toBe('rpgmaker-mz')
    expect(r.autoPick).toBe('Game.exe')
    expect(r.candidates[0]).toBe('Game.exe')
    expect(r.candidates).not.toContain('notification_helper.exe')
    expect(r.candidates).not.toContain('Tool/nwjc.exe')
  })

  it('RPG Maker MV 在内层文件夹里：选 Game.exe', () => {
    const r = rankLaunchFiles([
      '1.不会机翻的小白建议查看.txt',
      'Copper Lantern 2(内层)/Game.exe',
      'Copper Lantern 2(内层)/GameNoNwjs.exe',
      'Copper Lantern 2(内层)/www/index.html',
      'Copper Lantern 2(内层)/www/js/rpg_core.js'
    ])
    expect(r.engine).toBe('rpgmaker-mv')
    expect(r.autoPick).toBe('Copper Lantern 2(内层)/Game.exe')
  })

  it('RPG Maker MV 只有 nw.exe 时选 nw.exe', () => {
    const r = rankLaunchFiles(['nw.exe', 'www/js/rpg_core.js', 'notification_helper.exe'])
    expect(r.autoPick).toBe('nw.exe')
  })

  it('Unity：选旁边有 _Data 文件夹的 exe，排除 UnityCrashHandler', () => {
    const r = rankLaunchFiles([
      'HoshiyomiSeijo.exe',
      'HoshiyomiSeijo_Data/il2cpp_data/Metadata/global-metadata.dat',
      'UnityCrashHandler64.exe',
      'UnityPlayer.dll',
      'GameAssembly.dll'
    ])
    expect(r).toEqual({ engine: 'unity', autoPick: 'HoshiyomiSeijo.exe', candidates: ['HoshiyomiSeijo.exe'] })
  })

  it("Ren'Py：选和 .py 同名的 exe，lib 里的 python 排后面", () => {
    const r = rankLaunchFiles([
      'SummerGame.exe',
      'SummerGame-32.exe',
      'SummerGame.py',
      'renpy/__init__.py',
      'lib/py3-windows-x86_64/python.exe',
      'lib/py3-windows-x86_64/pythonw.exe',
      'lib/py3-windows-x86_64/SummerGame.exe'
    ])
    expect(r.engine).toBe('renpy')
    expect(r.autoPick).toBe('SummerGame.exe')
  })

  it('TyranoBuilder：选根目录的游戏 exe', () => {
    const r = rankLaunchFiles(['MyNovel.exe', 'nw.exe', 'nw.dll', 'tyrano/libs.js', 'data/scenario/first.ks'])
    expect(r.engine).toBe('tyrano')
    expect(r.autoPick).toBe('MyNovel.exe')
  })

  it('排除安装器和运行库', () => {
    const r = rankLaunchFiles([
      'Game.exe',
      'DirectX/DXSETUP.exe',
      'vcredist_x86.exe',
      'VC_redist.x64.exe',
      'unins000.exe',
      'Uninstall.exe',
      'crashpad_handler.exe'
    ])
    expect(r).toEqual({ engine: null, autoPick: 'Game.exe', candidates: ['Game.exe'] })
  })

  it('认不出引擎又有多个 exe 时不自动选，浅的排前面', () => {
    const r = rankLaunchFiles(['bin/tool.exe', 'Launcher.exe', 'Config.exe', 'data.xp3'])
    expect(r.autoPick).toBeNull()
    expect(r.candidates).toEqual(['Config.exe', 'Launcher.exe', 'bin/tool.exe'])
  })

  it('没有 exe 的 HTML 游戏：最浅一层的 .html 是候选，只有一个就自动选中', () => {
    expect(rankLaunchFiles(['Degrees of Starlight 0.5.5.9.html', 'img/a.png'])).toEqual({
      engine: null,
      autoPick: 'Degrees of Starlight 0.5.5.9.html',
      candidates: ['Degrees of Starlight 0.5.5.9.html']
    })
    // ひとりぼっちの灯台：入口在根上，data/ 里还有几百个页面，不列出来
    expect(rankLaunchFiles(['000_start_todai.html', 'data/000_start000.html', 'data/001_op000.HTM', '玩前必看说明.txt'])).toMatchObject({
      autoPick: '000_start_todai.html',
      candidates: ['000_start_todai.html']
    })
    expect(rankLaunchFiles(['index.html', 'readme.htm'])).toMatchObject({ autoPick: null, candidates: ['index.html', 'readme.htm'] })
  })

  it('有 exe 时不把 .html 当候选（RPG Maker 的 www/index.html 之类）', () => {
    expect(rankLaunchFiles(['Game.exe', 'www/index.html', 'manual.html']).candidates).toEqual(['Game.exe'])
  })

  it('什么都没有就没有候选', () => {
    expect(rankLaunchFiles(['readme.txt'])).toEqual({ engine: null, autoPick: null, candidates: [] })
  })

  it('Windows 的反斜杠路径也认', () => {
    expect(rankLaunchFiles(['Inner\\Game.exe', 'Inner\\www\\js\\rpg_core.js']).autoPick).toBe('Inner/Game.exe')
  })
})
