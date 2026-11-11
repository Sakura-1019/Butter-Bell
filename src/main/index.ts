import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, net, Notification, protocol, safeStorage, shell } from 'electron'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import icon from '../../build/icon.ico?asset'
import { ignore, listIgnored, listInbox, mergeBundle, rejectBundle, syncArchives, volumePaths } from './inbox'
import { addPassword, listPasswords, removePassword, reorderPasswords } from './passwords'
import { addFolder, ignoreFolders, looseFolders } from './loose'
import { createExtractor, listFolder } from './extractor'
import { addTag, applyDlsite, applyManual, backfillVersions, listGames, purge, removeTag, setVersion, uninstall } from './games'
import { createCovers } from './covers'
import { imageType, isBlankImage, type CoverSource } from '../core/cover'
import { createCapture, createWindowShooter, type NotifyKey } from './capture'
import { quitGame, windowsQuitDeps } from './quit'
import { closeUnfinished, endSession, startSession } from './play'
import { createRunner } from './runner'
import { rankLaunchFiles } from '../core/launch'
import { nameHints } from '../core/name-hints'
import { searchKeyword } from '../core/names'
import { extractVersion } from '../core/version'
import { DEFAULT_SORT, type InboxSort } from '../core/inbox-view'
import { DEFAULT_LIBRARY_SORT, DEFAULT_NAV, LIBRARY_SORT_KEYS, type LibrarySort, type NavPage } from '../core/library'
import { DEFAULT_MY_TAGS, inLibrary } from '../core/genres'
import { rankCandidates, type ProductDetail } from '../core/dlsite'
import { createDlsiteClient } from '../core/dlsite-http'
import type { PostExtractAction } from './extract'
import { getSetting, now, setSetting } from './settings'
import { isNewer, latestRelease, parseRepo, releasesApi, repoUrl, type Release } from '../core/update'
import pkg from '../../package.json'

// 绿色版：数据放在程序旁边。electron-builder 的单文件绿色版运行时会解压到临时目录，
// 它把真正的程序目录放在 PORTABLE_EXECUTABLE_DIR 里；解压出来的文件夹版靠旁边的 portable 标记文件识别。
const appDir = process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(process.execPath)
if (process.env.PORTABLE_EXECUTABLE_DIR || existsSync(join(appDir, 'portable'))) {
  app.setPath('userData', join(appDir, 'Butter Bell Data'))
}
// 开发时用另一份数据（比如试首次设置向导），不碰平时的库
if (!app.isPackaged && process.env.BUTTER_BELL_DATA) app.setPath('userData', process.env.BUTTER_BELL_DATA)

// 封面用 cover://c/<文件名> 读本地数据目录里的 covers/，渲染进程碰不到 file://
// 系统通知（截图封面的提示）显示成 Butter Bell；和 electron-builder.yml 的 appId 一致
if (process.platform === 'win32') app.setAppUserModelId('io.github.butterbell')

protocol.registerSchemesAsPrivileged([{ scheme: 'cover', privileges: { standard: true, secure: true } }])

// 和 styles.css 里的 --ground / --muted 保持一致
const titleBar = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#212121', symbolColor: '#b4b4b4', height: 36 }
    : { color: '#ffffff', symbolColor: '#5e5e59', height: 36 }

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: titleBar().color,
    icon, // 开发时任务栏也显示自己的图标；打包后 exe 自带同一个图标
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBar(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  nativeTheme.on('updated', () => win.setTitleBarOverlay(titleBar()))
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(join(dataDir, 'library.db'))
  closeUnfinished(db) // 上次崩溃或强退时没结束的游玩会话
  backfillVersions(db) // 0.2.0 以前进库的游戏补上版本号
  // 手动截图的全局快捷键；false = 关掉
  const captureHotkey = (): string | false => {
    const v = getSetting(db, 'capture_hotkey')
    return v === false ? false : typeof v === 'string' ? v : 'CommandOrControl+Alt+F12' // Ctrl+Shift+F12 常被别的程序占用
  }
  nativeTheme.themeSource = (getSetting(db, 'theme') as 'system' | 'light' | 'dark' | null) ?? 'system'
  if (getSetting(db, 'privacy_on_start') === true) setSetting(db, 'privacy_mode', true)
  const coversDir = join(dataDir, 'covers')
  // 封面：手选 > DLsite > 游戏目录里的图片 > RPG Maker 标题画面 > 自动截图，换掉的旧文件都删掉
  const covers = createCovers(db, dataDir)
  // 新进库或接回的游戏：在游戏文件夹里找封面（目录里的图片、RPG Maker 标题画面），找不到不影响入库
  const folderCover = (id: number) => covers.fromFolder(id, gameRow(id).dir).catch(() => undefined)
  protocol.handle('cover', (req) => net.fetch(pathToFileURL(join(coversDir, basename(decodeURIComponent(new URL(req.url).pathname)))).toString()))

  // 收件箱。每个调用都返回最新的收件箱，界面直接拿来重画。
  let loose: string[] = [] // 上次扫描游戏目录得到的现成文件夹
  const inbox = () => ({ dir: getSetting(db, 'archive_dir') as string | null, entries: listInbox(db, loose) })
  // 现成文件夹加进库（和已卸载游戏同名就接回）；启动文件按文件夹内容判断
  const addFolderGame = async (folder: string) => {
    const launch = rankLaunchFiles(await listFolder(join(getSetting(db, 'library_dir') as string, folder)))
    const id = addFolder(db, { folderName: folder, launchFile: launch.autoPick, launchCandidates: launch.candidates, version: extractVersion(folder) }, now())
    await folderCover(id)
    return id
  }
  const scan = async () => {
    const dir = getSetting(db, 'archive_dir') as string | null
    if (dir && existsSync(dir)) syncArchives(db, await listFiles(dir), now())
    const lib = getSetting(db, 'library_dir') as string | null
    if (lib && existsSync(lib)) {
      const found = looseFolders(db, await listDirs(lib))
      for (const r of found.reattach) await addFolderGame(r.folder) // 比如从回收站还原了已卸载的游戏：自动接回
      loose = found.loose
    } else loose = []
    return inbox()
  }
  ipcMain.handle('inbox:get', inbox)
  ipcMain.handle('inbox:scan', scan)
  ipcMain.handle('inbox:choose-dir', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openDirectory'] })
    if (!r.canceled && r.filePaths[0]) setSetting(db, 'archive_dir', r.filePaths[0])
    return scan()
  })
  ipcMain.handle('inbox:merge', (_e, ids: unknown) => (mergeBundle(db, checkIds(ids), now()), inbox()))
  ipcMain.handle('inbox:reject', (_e, ids: unknown) => (rejectBundle(db, checkIds(ids)), inbox()))
  ipcMain.handle('inbox:ignore', (_e, ids: unknown, on: unknown) => (ignore(db, checkIds(ids), on === true), inbox()))
  ipcMain.handle('inbox:ignore-folders', (_e, names: unknown, on: unknown) => (ignoreFolders(db, checkNames(names), on === true, now()), scan()))
  // 返回新加入（或接回）的游戏 id，界面接着弹补资料
  ipcMain.handle('inbox:add-folders', async (_e, names: unknown) => {
    const ids: number[] = []
    for (const n of checkNames(names)) if (loose.includes(n)) ids.push(await addFolderGame(n))
    return { ids, state: await scan() }
  })

  ipcMain.handle('inbox:ignored', () => listIgnored(db))

  // 右键菜单：压缩包移入回收站（每个分卷 shell.trashItem，绝不永久删除），界面上已经确认过
  ipcMain.handle('inbox:trash', async (_e, ids: unknown) => {
    const dir = getSetting(db, 'archive_dir') as string
    for (const id of checkIds(ids)) for (const p of volumePaths(db, id)) await shell.trashItem(join(dir, p))
    return scan()
  })
  // 在资源管理器中显示：压缩包选中第一个分卷，现成文件夹选中文件夹本身
  ipcMain.handle('inbox:reveal', (_e, kind: unknown, id: unknown) => {
    if (kind === 'folder') {
      if (typeof id !== 'string' || !loose.includes(id)) throw new Error('没有这个文件夹')
      return shell.showItemInFolder(join(getSetting(db, 'library_dir') as string, id))
    }
    const first = volumePaths(db, checkIds([id])[0])[0]
    if (first) shell.showItemInFolder(join(getSetting(db, 'archive_dir') as string, first))
  })

  // 解压。进度和结果用事件推给界面
  const cipher = { encrypt: (s: string) => safeStorage.encryptString(s), decrypt: (b: Buffer) => safeStorage.decryptString(b) }
  const send = (channel: string, ...args: unknown[]) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, ...args))
  const extractor = createExtractor({
    db,
    exe: app.isPackaged ? join(process.resourcesPath, '7zip', '7z.exe') : join(app.getAppPath(), 'resources', '7zip', '7z.exe'),
    cipher,
    ops: {
      trash: (p) => shell.trashItem(p),
      move: async (from, to) => {
        await mkdir(dirname(to), { recursive: true })
        await rename(from, to)
      },
      exists: existsSync
    },
    onJobs: (jobs) => send('extract:jobs', jobs),
    onFinished: async (gameId) => (await folderCover(gameId), send('extract:finished', gameId))
  })
  ipcMain.handle('extract:post-action', () => getSetting(db, 'post_extract_action'))
  ipcMain.handle('extract:jobs', () => extractor.jobs())
  // 双击弹窗里“解压位置”用系统对话框选；只接受这里选出来的路径，界面传不进别的
  const targets = new Set<string>()
  ipcMain.handle('extract:choose-target', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    targets.add(r.filePaths[0])
    return r.filePaths[0]
  })
  // action：第一次解压时弹窗选的；不传就用设置里记住的。
  // 单位上可以带这一次的 password / save / target / action（双击弹窗）
  ipcMain.handle('extract:start', async (e, units: unknown, action: unknown, remember: unknown) => {
    const okUnit = (u: any) =>
      typeof u?.key === 'string' && Array.isArray(u.ids) && u.ids.every(Number.isInteger) &&
      (u.password === undefined || typeof u.password === 'string') &&
      (u.target === undefined || (targets.has(u.target) && existsSync(u.target))) &&
      (u.action === undefined || ['keep', 'recycle', 'move'].includes(u.action))
    if (!Array.isArray(units) || !units.every(okUnit)) throw new Error('units 不对')
    const chosen = action ?? getSetting(db, 'post_extract_action')
    if (!['keep', 'recycle', 'move'].includes(chosen as string)) throw new Error('解压后处理不对')
    let lib = getSetting(db, 'library_dir') as string | null
    if (!lib || !existsSync(lib)) {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title: '选择游戏目录', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return false
      setSetting(db, 'library_dir', (lib = r.filePaths[0]))
    }
    if (action && remember === true) setSetting(db, 'post_extract_action', action)
    extractor.start(units.map((u) => ({ key: u.key, ids: u.ids, password: u.password, save: u.save === true, target: u.target, action: u.action })), chosen as PostExtractAction)
    return true
  })
  ipcMain.handle('extract:retry', (_e, key: unknown, password: unknown, save: unknown) => {
    if (typeof key !== 'string' || (password !== undefined && typeof password !== 'string')) throw new Error('参数不对')
    extractor.retry(key, password, save === true)
  })
  ipcMain.handle('extract:cancel', (_e, key: unknown) => typeof key === 'string' && extractor.cancel(key))

  // 游戏库、启动文件、DLsite 候选
  const gameRow = (id: unknown) => {
    if (!Number.isInteger(id)) throw new Error('id 必须是整数')
    const g = db.prepare('SELECT id, folder_name, cover_file FROM games WHERE id = ?').get(id) as { id: number; folder_name: string; cover_file: string | null } | undefined
    if (!g) throw new Error('没有这个游戏')
    // folder_name 一般相对于游戏目录；双击弹窗解压到游戏目录外的，存的是完整路径（resolve 两种都认）
    return { ...g, dir: resolve(getSetting(db, 'library_dir') as string, g.folder_name) }
  }
  const launchOptions = async (id: unknown) => {
    const g = gameRow(id)
    const current = db.prepare('SELECT launch_file FROM games WHERE id = ?').pluck().get(g.id) as string | null
    return { ...rankLaunchFiles(existsSync(g.dir) ? await listFolder(g.dir) : []), current }
  }
  ipcMain.handle('games:list', () => listGames(db))
  ipcMain.handle('games:launch-options', (_e, id: unknown) => launchOptions(id))
  ipcMain.handle('games:set-launch', async (_e, id: unknown, file: unknown) => {
    if (!(await launchOptions(id)).candidates.includes(file as string)) throw new Error('不是这个游戏里的 exe')
    db.prepare('UPDATE games SET launch_file = ? WHERE id = ?').run(file, id)
  })
  // 预填的关键词：解压出来的内容里读到的名字优先，读不到就用文件夹名清洗出来的关键词
  ipcMain.handle('games:hints', async (_e, id: unknown) => {
    const g = gameRow(id)
    const stem = basename(g.folder_name).replace(/ \(\d+\)$/, '')
    const read = (p: string) => {
      try {
        const file = join(g.dir, p)
        return statSync(file).size < 256 * 1024 ? readFileSync(file, 'utf8') : undefined
      } catch {
        return undefined
      }
    }
    const windowTitle = db.prepare('SELECT window_title FROM games WHERE id = ?').pluck().get(g.id) as string | null
    const hints = nameHints(stem, existsSync(g.dir) ? await listFolder(g.dir) : [], read, windowTitle)
    return { ...hints, keyword: hints.keywords[0] ?? searchKeyword(stem), folderName: basename(g.folder_name) }
  })

  // 用 Chromium 的网络栈：跟随系统代理设置，Node 自带的 fetch 不走代理
  const dlsite = createDlsiteClient({ fetch: net.fetch as typeof fetch })
  const details = new Map<string, ProductDetail>() // 选定时用，不用再请求一次
  ipcMain.handle('dlsite:search', async (_e, keyword: unknown) => {
    if (typeof keyword !== 'string' || !keyword.trim()) return []
    return rankCandidates(keyword, await dlsite.search(keyword))
  })
  ipcMain.handle('dlsite:product', async (_e, code: unknown) => {
    const d = await dlsite.product(String(code))
    if (d) details.set(d.code, d)
    return d
  })

  // replaceManual：现在的封面是用户手选的时候，候选详情里勾了“同时换成 DLsite 封面”
  ipcMain.handle('games:apply-dlsite', async (_e, id: unknown, code: unknown, tags: unknown, replaceManual: unknown, title: unknown) => {
    const g = gameRow(id)
    const d = details.get(String(code))
    if (!d) throw new Error('先取详情')
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string' && d.genres.includes(t))) throw new Error('标签不对')
    if (typeof title !== 'string' || !title.trim()) throw new Error('名称不能是空的')
    const manual = db.prepare('SELECT cover_source FROM games WHERE id = ?').pluck().get(g.id) === 'manual'
    let bytes: Uint8Array | null = null
    if (!manual || replaceManual === true) {
      const res = await net.fetch(d.coverUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`封面下载失败：${res.status}`)
      bytes = new Uint8Array(await res.arrayBuffer())
    }
    applyDlsite(db, g.id, d, null, tags, title)
    if (bytes) await covers.put(g.id, bytes, 'dlsite')
  })
  ipcMain.handle('games:apply-manual', async (_e, id: unknown, title: unknown, bytes: unknown) => {
    const g = gameRow(id)
    // 封面可选：没给就只写名称
    if (typeof title !== 'string' || !title.trim()) throw new Error('名称不能是空的')
    if (bytes != null && !(bytes instanceof Uint8Array && imageType(bytes))) throw new Error('封面要是 jpg / png / webp 图片')
    if (bytes) await covers.put(g.id, bytes, 'manual')
    applyManual(db, g.id, title, bytes ? (db.prepare('SELECT cover_file FROM games WHERE id = ?').pluck().get(g.id) as string) : null)
  })

  // 启动和计时
  const runner = createRunner({
    db,
    openPath: (p) => shell.openPath(p),
    onChange: (r) => {
      send('play:running', r)
      syncHotkey()
      if (!r.length) shooter.stop() // 截图用的 PowerShell 只在有游戏运行时开着
    }
  })

  // 截图封面：没封面的游戏启动后自动截一张；Ctrl+Alt+F12（设置里可改、可关）或详情页按钮手动截
  const shooter = createWindowShooter(tmpdir(), {
    decode: (file) => {
      const im = nativeImage.createFromPath(file)
      if (im.isEmpty()) return null
      const { width, height } = im.getSize()
      return { bgra: im.toBitmap(), width, height }
    },
    toJpeg: (file) => {
      let im = nativeImage.createFromPath(file)
      if (im.getSize().width > 1280) im = im.resize({ width: 1280, quality: 'best' })
      return im.toJPEG(90)
    },
    isBlank: isBlankImage,
    remove: (file) => rm(file, { force: true })
  })
  const hotkeyLabel = () => {
    const k = captureHotkey()
    return k ? k.replace('CommandOrControl', 'Ctrl') : null
  }
  // 系统通知的文字（游戏窗口会盖住 Butter Bell，所以不用界面里的提示条）
  const NOTES: Record<NotifyKey, () => [string, string]> = {
    'capture.start': () => ['正在截取封面', '请停留在标题画面'],
    'capture.done': () => ['已截取临时封面', hotkeyLabel() ? `不满意可以按 ${hotkeyLabel()} 重截` : '不满意可以在详情页“截取当前画面”重截'],
    'capture.failed': () => ['没截到封面', hotkeyLabel() ? `画面一直是黑的或纯色。到想要的画面时按 ${hotkeyLabel()} 手动截取` : '画面一直是黑的或纯色，可以在详情页手动截取'],
    'capture.manualDone': () => ['已换成截图封面', '以后不会被自动替换'],
    'capture.manualBlank': () => ['没有换封面', '画面几乎全黑或是纯色'],
    'capture.manualNoWindow': () => ['没有换封面', '没找到游戏窗口，或者游戏不在最前面'],
    'capture.hotkeyBusy': () => ['截图快捷键用不了', `${hotkeyLabel()} 被别的程序占用了，可以在设置里换一个`]
  }
  const capture = createCapture({
    running: () => runner.list().map((r) => ({ gameId: r.gameId, pids: runner.pids(r.gameId) })),
    isRunning: (id) => runner.list().some((r) => r.gameId === id),
    coverSource: (id) => db.prepare('SELECT cover_source FROM games WHERE id = ?').pluck().get(id) as CoverSource | null,
    window: shooter.window,
    activate: shooter.activate,
    shoot: shooter.shoot,
    title: shooter.title,
    saveTitle: (id, title) => void db.prepare('UPDATE games SET window_title = ? WHERE id = ?').run(title, id),
    // 手动截的算用户自己选的，直接换；自动截的只在还没封面时放上
    save: async (id, bytes, src) => void (src === 'manual' ? await covers.put(id, bytes, src) : await covers.offer(id, bytes, src)),
    notify: (key) => {
      const [title, body] = NOTES[key]()
      if (Notification.isSupported()) new Notification({ title, body, icon }).show()
    },
    changed: () => send('games:changed'),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms))
  })
  // 全局快捷键只在有游戏运行时注册，不占着别的程序的键
  let registered: string | null = null
  let warnedBusy = false
  function syncHotkey() {
    const want = runner.list().length ? captureHotkey() : false
    if (registered && registered !== want) globalShortcut.unregister(registered), (registered = null)
    if (want && !registered) {
      if (globalShortcut.register(want, () => void capture.hotkey().catch(() => undefined))) registered = want
      // 被别的程序占了：这次运行里提醒一次，不默默失效
      else if (!warnedBusy) (warnedBusy = true), capture.notify('capture.hotkeyBusy')
    }
  }
  // 详情页的“退出游戏”：force = false 先正常关闭（5 秒没关掉返回 stuck，界面再问要不要强制结束）。
  // 关掉以后 runner 下一次看进程时照常结束游玩会话、记下时长
  ipcMain.handle('games:quit', async (_e, id: unknown, force: unknown) => {
    const g = gameRow(id)
    return quitGame(runner.pids(g.id), force === true ? 'force' : 'close', windowsQuitDeps)
  })
  ipcMain.handle('games:capture', async (_e, id: unknown) => {
    const g = gameRow(id)
    if (!runner.list().some((r) => r.gameId === g.id)) throw new Error('游戏没在运行')
    return capture.now(g.id)
  })
  ipcMain.handle('play:running', () => runner.list())
  ipcMain.handle('games:launch', async (_e, id: unknown) => {
    const g = gameRow(id)
    const row = db.prepare('SELECT launch_file, use_locale_emulator, uninstalled_at FROM games WHERE id = ?').get(g.id) as { launch_file: string | null; use_locale_emulator: number; uninstalled_at: string | null }
    if (row.uninstalled_at) throw new Error('已卸载')
    if (!row.launch_file) throw new Error('还没选启动文件')
    const exe = join(g.dir, row.launch_file)
    if (!existsSync(exe)) throw new Error(`找不到启动文件：${exe}`)
    db.prepare('UPDATE games SET recent_extract_at = NULL WHERE id = ?').run(g.id) // 启动一次就移出“最近解压”
    // 纯 HTML 游戏用默认浏览器打开。拿不到游戏进程，所以只记“上次游玩”，不计时长
    if (/.html?$/i.test(row.launch_file)) {
      const err = await shell.openPath(exe)
      if (err) throw new Error(err)
      const t = now()
      return endSession(db, startSession(db, g.id, t), t)
    }
    const le = row.use_locale_emulator ? (getSetting(db, 'locale_emulator_path') as string | null) : null
    if (row.use_locale_emulator && (!le || !existsSync(le))) throw new Error('没找到 Locale Emulator，去设置里指定 LEProc.exe')
    await runner.launch(g.id, exe, g.dir, le)
    void capture.auto(g.id).catch(() => undefined) // 没封面的游戏：截一张标题画面当临时封面
    void capture.recordTitle(g.id).catch(() => undefined) // 窗口标题：识别信息时当候补词
  })

  // 详情抽屉里能改的东西
  ipcMain.handle('games:update', (_e, id: unknown, patch: unknown) => {
    const g = gameRow(id)
    const p = patch as { playStatus?: unknown; useLocaleEmulator?: unknown; title?: unknown; version?: unknown; favorite?: unknown }
    if (p.favorite !== undefined) db.prepare('UPDATE games SET favorite = ? WHERE id = ?').run(p.favorite === true ? 1 : 0, g.id)
    if (p.version !== undefined) {
      if (typeof p.version !== 'string' || p.version.length > 64) throw new Error('版本号不对')
      setVersion(db, g.id, p.version) // 手动改过的，以后接回新版本也不再自动覆盖
    }
    if (p.playStatus !== undefined) {
      if (!['playing', 'wishlist', 'completed'].includes(p.playStatus as string)) throw new Error('状态不对')
      db.prepare('UPDATE games SET play_status = ? WHERE id = ?').run(p.playStatus, g.id)
    }
    if (p.useLocaleEmulator !== undefined) db.prepare('UPDATE games SET use_locale_emulator = ? WHERE id = ?').run(p.useLocaleEmulator === true ? 1 : 0, g.id)
    if (p.title !== undefined) {
      if (typeof p.title !== 'string' || !p.title.trim()) throw new Error('名称不能是空的')
      db.prepare('UPDATE games SET title = ? WHERE id = ?').run(p.title.trim(), g.id)
    }
  })
  // 游戏库“最近解压”的“清空”：只移出分组，游戏不动
  ipcMain.handle('games:clear-recent', () => void db.prepare('UPDATE games SET recent_extract_at = NULL').run())
  // 删除自定义标签：从所有游戏上摘掉，也从“我的标签”里去掉
  ipcMain.handle('tags:delete', (_e, name: unknown) => {
    if (typeof name !== 'string' || inLibrary(name)) throw new Error('只能删除自定义标签')
    db.transaction(() => {
      db.prepare('DELETE FROM tags WHERE name = ?').run(name)
      setSetting(db, 'my_tags', myTags().filter((t) => t.toLowerCase() !== name.toLowerCase()))
    })()
    return settings()
  })
  ipcMain.handle('games:tag', (_e, id: unknown, name: unknown, on: unknown) => {
    const g = gameRow(id)
    if (typeof name !== 'string') throw new Error('标签不对')
    if (on === true) addTag(db, g.id, name)
    else removeTag(db, g.id, name)
  })
  ipcMain.handle('games:set-cover', async (_e, id: unknown, bytes: unknown) => {
    const g = gameRow(id)
    if (!(bytes instanceof Uint8Array)) throw new Error('封面要是 jpg / png / webp 图片')
    await covers.put(g.id, bytes, 'manual')
  })
  // 只打开库里记着的 DLsite 作品页，不接受界面传来的网址
  ipcMain.handle('games:open-dlsite', async (_e, id: unknown) => {
    const url = listGames(db).find((x) => x.id === gameRow(id).id)?.dlsiteUrl
    if (url) await shell.openExternal(url)
  })
  ipcMain.handle('games:open-folder', async (_e, id: unknown) => {
    const err = await shell.openPath(gameRow(id).dir)
    if (err) throw new Error(err)
  })
  // 卸载：整个游戏文件夹进回收站（shell.trashItem，绝不永久删除），记录留着
  ipcMain.handle('games:uninstall', async (_e, id: unknown) => {
    const g = gameRow(id)
    if (runner.list().some((r) => r.gameId === g.id)) throw new Error('游戏还在运行')
    // 已卸载的游戏的 folder_name 可能已经被别的游戏用了，绝不能再去回收它
    if (db.prepare('SELECT uninstalled_at FROM games WHERE id = ?').pluck().get(g.id)) throw new Error('已经卸载了')
    // 只会是游戏目录下的一层，或者双击弹窗选的位置下面的一层（存完整路径）；绝不回收盘符根
    const folderOk = isAbsolute(g.folder_name) ? dirname(g.dir) !== g.dir && !/^\.\.?$/.test(basename(g.dir)) : !/[\\/]|^\.\.?$/.test(g.folder_name)
    if (!g.folder_name || !folderOk) throw new Error('游戏文件夹不对')
    if (existsSync(g.dir)) await shell.trashItem(g.dir)
    uninstall(db, g.id, now())
  })
  ipcMain.handle('games:purge', async (_e, id: unknown) => {
    const cover = purge(db, gameRow(id).id)
    if (cover) await rm(join(dataDir, cover), { force: true })
  })

  // 常用密码表：界面上默认遮住，明文只在这几个调用里给设置页
  const passwords = () => listPasswords(db, cipher)
  ipcMain.handle('passwords:list', passwords)
  ipcMain.handle('passwords:add', (_e, pw: unknown) => {
    if (typeof pw !== 'string') throw new Error('密码不对')
    addPassword(db, pw, cipher, now())
    return passwords()
  })
  ipcMain.handle('passwords:remove', (_e, id: unknown) => (removePassword(db, checkIds([id])[0]), passwords()))
  ipcMain.handle('passwords:reorder', (_e, ids: unknown) => (reorderPasswords(db, checkIds(ids)), passwords()))

  // 设置
  const settings = () => ({
    archiveDir: getSetting(db, 'archive_dir') as string | null,
    libraryDir: getSetting(db, 'library_dir') as string | null,
    postExtractAction: getSetting(db, 'post_extract_action') as PostExtractAction | null,
    localeEmulatorPath: getSetting(db, 'locale_emulator_path') as string | null,
    privacyMode: getSetting(db, 'privacy_mode') === true,
    privacyOnStart: getSetting(db, 'privacy_on_start') === true,
    checkUpdates: getSetting(db, 'check_updates') !== false,
    theme: (getSetting(db, 'theme') as 'system' | 'light' | 'dark' | null) ?? 'system',
    language: (getSetting(db, 'language') as string | null) ?? 'zh-CN',
    inboxSort: (getSetting(db, 'inbox_sort') as InboxSort | null) ?? DEFAULT_SORT,
    captureHotkey: captureHotkey(), // false = 关掉
    myTags: myTags(),
    navOrder: (getSetting(db, 'nav_order') as NavPage[] | null) ?? DEFAULT_NAV,
    librarySort: (getSetting(db, 'library_sort') as LibrarySort | null) ?? DEFAULT_LIBRARY_SORT
  })
  // “我的标签”：筛选里显示的词、识别时默认勾上的词。没改过就是内置的人气分类
  function myTags(): string[] {
    return (getSetting(db, 'my_tags') as string[] | null) ?? DEFAULT_MY_TAGS
  }
  ipcMain.handle('settings:get', settings)
  ipcMain.handle('settings:set', (_e, key: unknown, value: unknown) => {
    const ok: Record<string, (v: unknown) => boolean> = {
      post_extract_action: (v) => v === null || ['keep', 'recycle', 'move'].includes(v as string), // null = 下次解压时再问
      privacy_mode: (v) => typeof v === 'boolean',
      privacy_on_start: (v) => typeof v === 'boolean',
      check_updates: (v) => typeof v === 'boolean',
      theme: (v) => ['system', 'light', 'dark'].includes(v as string),
      locale_emulator_path: (v) => v === null,
      language: (v) => typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(v), // 有哪些语言由界面决定
      inbox_sort: (v) => ['modified', 'name', 'size', 'added'].includes((v as InboxSort)?.key) && typeof (v as InboxSort).desc === 'boolean' && Object.keys(v as object).length === 2,
      my_tags: (v) => Array.isArray(v) && v.length <= 2000 && v.every((t) => typeof t === 'string' && t.trim() !== '' && t.length <= 64),
      nav_order: (v) => Array.isArray(v) && v.length === DEFAULT_NAV.length && DEFAULT_NAV.every((k) => v.includes(k)),
      library_sort: (v) => LIBRARY_SORT_KEYS.includes((v as LibrarySort)?.key) && typeof (v as LibrarySort).desc === 'boolean' && Object.keys(v as object).length === 2,
      capture_hotkey: (v) => v === false || (typeof v === 'string' && /^[A-Za-z0-9+]{1,64}$/.test(v)) // Electron 的快捷键写法，如 CommandOrControl+Alt+F12
    }
    if (!ok[key as string]?.(value)) throw new Error('设置项不对')
    // 新的截图快捷键先试着注册一下：写法不对或者被别的程序占了，就不存
    if (key === 'capture_hotkey' && typeof value === 'string') {
      if (registered) globalShortcut.unregister(registered), (registered = null)
      let usable = false
      try {
        usable = globalShortcut.register(value, () => undefined)
      } catch {
        // 写法不对
      }
      if (usable) globalShortcut.unregister(value)
      if (!usable) {
        syncHotkey()
        throw new Error('这个快捷键用不了，可能被别的程序占用了')
      }
    }
    if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    else setSetting(db, key as string, value)
    if (key === 'theme') nativeTheme.themeSource = value as 'system' | 'light' | 'dark'
    if (key === 'capture_hotkey') syncHotkey()
    return settings()
  })
  // 选文件夹 / 选 LEProc.exe 用系统对话框，路径不从界面传进来
  ipcMain.handle('settings:choose', async (e, key: unknown) => {
    if (!['archive_dir', 'library_dir', 'locale_emulator_path'].includes(key as string)) throw new Error('设置项不对')
    const le = key === 'locale_emulator_path'
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, le
      ? { title: '选择 LEProc.exe', properties: ['openFile'], filters: [{ name: 'LEProc.exe', extensions: ['exe'] }] }
      : { properties: ['openDirectory'] })
    if (!r.canceled && r.filePaths[0]) setSetting(db, key as string, r.filePaths[0])
    return settings()
  })

  // 检查更新：只问 GitHub 最新的正式版号，不下载、不上传库里的任何东西。
  // 仓库写在 package.json 的 repository 里，没写就什么请求都不发。
  const repo = parseRepo((pkg as { repository?: unknown }).repository)
  let latest: Release | null = null
  const update = () => ({
    configured: !!repo,
    repoUrl: repo && repoUrl(repo),
    current: app.getVersion(),
    latest: latest && isNewer(latest.version, app.getVersion()) ? latest : null,
    dismissed: getSetting(db, 'dismissed_update') as string | null
  })
  ipcMain.handle('update:get', update)
  ipcMain.handle('update:check', async () => {
    if (!repo) return update()
    const res = await net.fetch(releasesApi(repo), { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Butter-Bell' } })
    if (res.status === 404) latest = null // 还没发过正式版
    else if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`)
    else latest = latestRelease(await res.json(), repo)
    return update()
  })
  // 侧栏的“×”：这个版本不再提示，出了更新的才再提示
  ipcMain.handle('update:dismiss', () => (latest && setSetting(db, 'dismissed_update', latest.version), update()))
  ipcMain.handle('update:open', () => latest && shell.openExternal(latest.url))
  // 只打开 package.json 里写的仓库，不接受界面传网址
  ipcMain.handle('update:open-repo', () => repo && shell.openExternal(repoUrl(repo)))

  createWindow()
  // 还没封面（或只有截图）的游戏，在文件夹里再找一遍；后台慢慢来，不挡启动
  ;(async () => {
    const ids = db.prepare("SELECT id FROM games WHERE uninstalled_at IS NULL AND (cover_source IS NULL OR cover_source = 'screenshot')").pluck().all() as number[]
    for (const id of ids) await folderCover(id)
    if (ids.length) send('games:changed')
  })()
  app.on('before-quit', () => (runner.stop(), shooter.stop(), globalShortcut.unregisterAll()))
})

// 只读：列出仓库目录根下的文件名、大小和修改时间（= 下载时间），不进子文件夹，不碰文件内容
async function listFiles(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile())
  return Promise.all(
    files.map(async (e) => {
      const s = await stat(join(dir, e.name))
      return { name: e.name, size: s.size, mtime: s.mtime.toISOString().slice(0, 19) + 'Z' }
    })
  )
}

// 只读：游戏目录下一层的文件夹名
async function listDirs(dir: string) {
  return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
}

function checkNames(names: unknown): string[] {
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) throw new Error('names 必须是字符串数组')
  return names
}

function checkIds(ids: unknown): number[] {
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) throw new Error('ids 必须是整数数组')
  return ids
}

app.on('window-all-closed', () => app.quit())
