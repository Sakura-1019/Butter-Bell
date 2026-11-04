// 截图封面：没封面的游戏启动后自动截一张标题画面；也可以按快捷键或在详情页手动截。
// 找窗口和截屏走一个常驻的 PowerShell（.NET + Win32），只在有游戏运行时开着；不用 desktopCapturer。
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { CoverSource } from '../core/cover'

// 截一张的结果：图片（已转成 jpg）/ 近乎全黑或纯色 / 游戏窗口不在最前面 / 没找到窗口
export type Shot = Buffer | 'blank' | 'background' | 'none'
export type NotifyKey = 'capture.start' | 'capture.done' | 'capture.failed' | 'capture.manualDone' | 'capture.manualBlank' | 'capture.manualNoWindow' | 'capture.hotkeyBusy'

interface Deps {
  running(): { gameId: number; pids: number[] }[] // 正在跑的游戏和它们的进程（含 LE 时靠文件夹找到的）
  isRunning(gameId: number): boolean
  coverSource(gameId: number): CoverSource | null
  window(pids: number[]): Promise<'none' | 'fg' | 'bg'> // 找到主窗口了吗，在不在最前面
  activate(pids: number[]): Promise<void> // 把游戏窗口切到最前面
  shoot(pids: number[]): Promise<Shot>
  save(gameId: number, bytes: Buffer, source: CoverSource): Promise<void>
  notify(key: NotifyKey): void // Windows 系统通知：游戏窗口会盖住 Butter Bell
  changed(): void // 封面换了，界面重拉游戏列表
  sleep(ms: number): Promise<void>
}

const TRIES = 5
const pidsOf = (d: Deps, id: number) => d.running().find((r) => r.gameId === id)?.pids ?? []

export function createCapture(d: Deps) {
  // 只对没有封面的游戏：窗口出现后第 5 秒开始，每 3 秒截一次，取第一张不是黑屏 / 纯色的，最多 5 次。
  // 游戏窗口不在最前面时（用户切走了）不截，也不算次数
  async function auto(gameId: number): Promise<void> {
    if (d.coverSource(gameId) !== null) return
    d.notify('capture.start')
    let seen = false
    while (d.isRunning(gameId)) {
      if ((await d.window(pidsOf(d, gameId))) !== 'none') {
        seen = true
        break
      }
      await d.sleep(2000)
    }
    if (!seen) return
    await d.sleep(5000)
    let tries = 0
    while (tries < TRIES && d.isRunning(gameId)) {
      if (d.coverSource(gameId) !== null) return // 这期间手动截了或者补了资料
      const shot = await d.shoot(pidsOf(d, gameId))
      if (Buffer.isBuffer(shot)) {
        await d.save(gameId, shot, 'screenshot')
        d.notify('capture.done')
        d.changed()
        return
      }
      if (shot === 'blank') tries++
      await d.sleep(3000)
    }
    if (tries >= TRIES) d.notify('capture.failed')
  }

  // 手动截的图算用户自己选的：有封面也换，以后不被自动替换
  async function manual(gameId: number): Promise<Shot> {
    const shot = await d.shoot(pidsOf(d, gameId))
    if (Buffer.isBuffer(shot)) {
      await d.save(gameId, shot, 'manual')
      d.changed()
    }
    return shot
  }

  return {
    auto,
    notify: d.notify,
    // 全局快捷键：截正在最前面的那个游戏
    async hotkey(): Promise<void> {
      for (const r of d.running()) {
        if ((await d.window(r.pids)) !== 'fg') continue
        const shot = await manual(r.gameId)
        d.notify(Buffer.isBuffer(shot) ? 'capture.manualDone' : shot === 'blank' ? 'capture.manualBlank' : 'capture.manualNoWindow')
        return
      }
      d.notify('capture.manualNoWindow')
    },
    // 详情页的“截取当前画面”：先把游戏窗口切到前面，倒数 3 秒（界面上同时显示）再截
    async now(gameId: number): Promise<'ok' | 'blank' | 'background' | 'none'> {
      await d.activate(pidsOf(d, gameId))
      await d.sleep(3000)
      const shot = await manual(gameId)
      return Buffer.isBuffer(shot) ? 'ok' : shot
    }
  }
}

// ---- PowerShell 那一半 ----

// 找进程的主窗口：可见、没最小化、不是别人的子窗口、客户区至少 320×200 里最大的那个；截客户区（不含标题栏）。
// SetProcessDPIAware：高分屏下坐标和截屏都按真实像素算，不然会错位
const SCRIPT = String.raw`[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class BBWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  public static void Init() { SetProcessDPIAware(); }
  public static IntPtr Find(HashSet<uint> pids, out Rectangle rect) {
    IntPtr best = IntPtr.Zero;
    Rectangle bestR = Rectangle.Empty;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !IsWindowVisible(h) || IsIconic(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      RECT r;
      if (!GetClientRect(h, out r)) return true;
      POINT p = new POINT();
      if (!ClientToScreen(h, ref p)) return true;
      int w = r.R - r.L, ht = r.B - r.T;
      if (w < 320 || ht < 200 || w * ht <= bestR.Width * bestR.Height) return true;
      best = h;
      bestR = new Rectangle(p.X, p.Y, w, ht);
      return true;
    }, IntPtr.Zero);
    rect = bestR;
    return best;
  }
  public static bool IsForeground(IntPtr h) { return GetForegroundWindow() == h; }
  // 不模拟按键（按 Alt 会让游戏弹菜单）：借当前前台窗口的输入队列，Windows 才肯切前台。最大化的窗口不还原
  public static void Activate(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    uint dummy;
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fg, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    AttachThreadInput(me, fg, false);
  }
  public static void Shot(Rectangle r, string file) {
    using (Bitmap bmp = new Bitmap(r.Width, r.Height))
    using (Graphics g = Graphics.FromImage(bmp)) {
      g.CopyFromScreen(r.X, r.Y, 0, 0, r.Size);
      bmp.Save(file, ImageFormat.Png);
    }
  }
}
'@
[BBWin]::Init()
function Say($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $cmd, $pidList, $file = $line -split "` + '`' + String.raw`t"
    $set = New-Object 'System.Collections.Generic.HashSet[uint32]'
    foreach ($p in ($pidList -split ',')) { if ($p) { [void]$set.Add([uint32]$p) } }
    $rect = [System.Drawing.Rectangle]::Empty
    $h = [BBWin]::Find($set, [ref]$rect)
    if ($h -eq [IntPtr]::Zero) { Say 'none' }
    elseif ($cmd -eq 'activate') { [BBWin]::Activate($h); Say 'ok' }
    elseif (-not [BBWin]::IsForeground($h)) { Say 'bg' }
    else {
      if ($cmd -eq 'shot') { [BBWin]::Shot($rect, $file) }
      Say 'fg'
    }
  } catch { Say 'error' }
}`

interface ImageTools {
  // 读 PNG：BGRA 像素和尺寸（Electron 的 nativeImage）；转成适合当封面的 jpg
  decode(file: string): { bgra: Uint8Array; width: number; height: number } | null
  toJpeg(file: string): Buffer
  isBlank(bgra: Uint8Array, width: number, height: number): boolean
  remove(file: string): Promise<void>
}

export function createWindowShooter(tmpDir: string, img: ImageTools) {
  let ps: ChildProcess | null = null
  let buf = ''
  const waiting: ((line: string) => void)[] = []
  let chain: Promise<unknown> = Promise.resolve()

  function start() {
    if (ps) return ps
    const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        waiting.shift()?.(line)
      }
    })
    child.on('exit', () => {
      if (ps === child) ps = null
      buf = ''
      for (const w of waiting.splice(0)) w('error')
    })
    return (ps = child)
  }

  // 一次只发一条命令，按顺序拿回一行结果
  const ask = (cmd: string, pids: number[], file = '') =>
    (chain = chain.then(
      () =>
        new Promise<string>((resolve) => {
          if (!pids.length) return resolve('none')
          waiting.push(resolve)
          start().stdin!.write(`${cmd}\t${pids.join(',')}\t${file}\n`)
        })
    )) as Promise<string>

  let n = 0
  return {
    window: async (pids: number[]) => {
      const r = await ask('find', pids)
      return r === 'fg' || r === 'bg' ? r : 'none'
    },
    activate: async (pids: number[]) => void (await ask('activate', pids)),
    // 截到临时文件，判断能不能用，转成 jpg 读进来；临时文件不管成不成都删掉，不合格的图不留在磁盘上
    async shoot(pids: number[]): Promise<Shot> {
      const file = join(tmpDir, `butter-bell-shot-${process.pid}-${++n}.png`)
      try {
        const r = await ask('shot', pids, file)
        if (r === 'bg') return 'background'
        if (r !== 'fg') return 'none'
        const pic = img.decode(file)
        if (!pic || img.isBlank(pic.bgra, pic.width, pic.height)) return 'blank'
        return img.toJpeg(file)
      } finally {
        await img.remove(file)
      }
    },
    stop() {
      ps?.kill()
      ps = null
    }
  }
}
