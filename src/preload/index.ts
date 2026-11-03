import { contextBridge, ipcRenderer } from 'electron'
import type { InboxEntry } from '../main/inbox'
import type { Job } from '../main/extractor'
import type { PostExtractAction } from '../main/extract'
import type { GameCard } from '../main/games'
import type { Candidate, ProductDetail } from '../core/dlsite'
import type { LaunchRanking } from '../core/launch'
import type { Running } from '../main/runner'
import type { CommonPassword } from '../main/passwords'
import type { listIgnored } from '../main/inbox'
import type { Release } from '../core/update'

export interface Settings {
  archiveDir: string | null
  libraryDir: string | null
  postExtractAction: PostExtractAction | null
  localeEmulatorPath: string | null
  privacyMode: boolean
  privacyOnStart: boolean
  checkUpdates: boolean
  theme: 'system' | 'light' | 'dark'
  language: string
}
export type LaunchOptions = LaunchRanking & { current: string | null }
export type SettingKey = 'post_extract_action' | 'privacy_mode' | 'privacy_on_start' | 'check_updates' | 'theme' | 'locale_emulator_path' | 'language'
export interface UpdateState {
  configured: boolean // package.json 里写了仓库；没写就不检查
  current: string
  latest: Release | null // 比当前新的正式版
  dismissed: string | null // 侧栏上点了“×”的版本
}

export interface InboxState {
  dir: string | null // 仓库目录；还没选时是 null
  entries: InboxEntry[]
}

// 订阅主进程推来的事件，返回取消订阅的函数
function on<T>(channel: string, fn: (v: T) => void) {
  const h = (_e: unknown, v: T) => fn(v)
  ipcRenderer.on(channel, h)
  return () => void ipcRenderer.removeListener(channel, h)
}

// 渲染进程能碰到的全部主进程能力都列在这里，别处不要再开口子。
const api = {
  inbox: {
    get: (): Promise<InboxState> => ipcRenderer.invoke('inbox:get'),
    scan: (): Promise<InboxState> => ipcRenderer.invoke('inbox:scan'),
    chooseDir: (): Promise<InboxState> => ipcRenderer.invoke('inbox:choose-dir'),
    merge: (ids: number[]): Promise<InboxState> => ipcRenderer.invoke('inbox:merge', ids),
    reject: (ids: number[]): Promise<InboxState> => ipcRenderer.invoke('inbox:reject', ids),
    ignore: (ids: number[], on: boolean): Promise<InboxState> => ipcRenderer.invoke('inbox:ignore', ids, on),
    ignoreFolders: (names: string[], on: boolean): Promise<InboxState> => ipcRenderer.invoke('inbox:ignore-folders', names, on),
    ignored: (): Promise<ReturnType<typeof listIgnored>> => ipcRenderer.invoke('inbox:ignored'),
    addFolders: (names: string[]): Promise<{ ids: number[]; state: InboxState }> => ipcRenderer.invoke('inbox:add-folders', names)
  },
  games: {
    list: (): Promise<GameCard[]> => ipcRenderer.invoke('games:list'),
    launchOptions: (id: number): Promise<LaunchOptions> => ipcRenderer.invoke('games:launch-options', id),
    setLaunch: (id: number, file: string): Promise<void> => ipcRenderer.invoke('games:set-launch', id, file),
    hints: (id: number): Promise<{ keyword: string; keywords: string[]; workCode: string | null; folderName: string }> => ipcRenderer.invoke('games:hints', id),
    applyDlsite: (id: number, code: string, tags: string[]): Promise<void> => ipcRenderer.invoke('games:apply-dlsite', id, code, tags),
    applyManual: (id: number, title: string, cover: Uint8Array): Promise<void> => ipcRenderer.invoke('games:apply-manual', id, title, cover),
    launch: (id: number): Promise<void> => ipcRenderer.invoke('games:launch', id),
    update: (id: number, patch: { playStatus?: GameCard['playStatus']; useLocaleEmulator?: boolean; title?: string }): Promise<void> =>
      ipcRenderer.invoke('games:update', id, patch),
    tag: (id: number, name: string, on: boolean): Promise<void> => ipcRenderer.invoke('games:tag', id, name, on),
    setCover: (id: number, cover: Uint8Array): Promise<void> => ipcRenderer.invoke('games:set-cover', id, cover),
    openFolder: (id: number): Promise<void> => ipcRenderer.invoke('games:open-folder', id),
    uninstall: (id: number): Promise<void> => ipcRenderer.invoke('games:uninstall', id),
    purge: (id: number): Promise<void> => ipcRenderer.invoke('games:purge', id)
  },
  play: {
    running: (): Promise<Running[]> => ipcRenderer.invoke('play:running'),
    onRunning: (fn: (r: Running[]) => void) => on('play:running', fn)
  },
  passwords: {
    list: (): Promise<CommonPassword[]> => ipcRenderer.invoke('passwords:list'),
    add: (pw: string): Promise<CommonPassword[]> => ipcRenderer.invoke('passwords:add', pw),
    remove: (id: number): Promise<CommonPassword[]> => ipcRenderer.invoke('passwords:remove', id),
    reorder: (ids: number[]): Promise<CommonPassword[]> => ipcRenderer.invoke('passwords:reorder', ids)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (key: SettingKey, value: unknown): Promise<Settings> => ipcRenderer.invoke('settings:set', key, value),
    choose: (key: 'archive_dir' | 'library_dir' | 'locale_emulator_path'): Promise<Settings> => ipcRenderer.invoke('settings:choose', key)
  },
  update: {
    get: (): Promise<UpdateState> => ipcRenderer.invoke('update:get'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    dismiss: (): Promise<UpdateState> => ipcRenderer.invoke('update:dismiss'),
    open: (): Promise<void> => ipcRenderer.invoke('update:open')
  },
  dlsite: {
    search: (keyword: string): Promise<Candidate[]> => ipcRenderer.invoke('dlsite:search', keyword),
    product: (code: string): Promise<ProductDetail | null> => ipcRenderer.invoke('dlsite:product', code)
  },
  extract: {
    postAction: (): Promise<PostExtractAction | null> => ipcRenderer.invoke('extract:post-action'),
    jobs: (): Promise<Job[]> => ipcRenderer.invoke('extract:jobs'),
    // 返回 false = 用户没选游戏目录，没开始
    start: (units: { key: string; ids: number[] }[], action?: PostExtractAction, remember?: boolean): Promise<boolean> =>
      ipcRenderer.invoke('extract:start', units, action, remember),
    retry: (key: string, password?: string, save?: boolean): Promise<void> => ipcRenderer.invoke('extract:retry', key, password, save),
    cancel: (key: string): Promise<void> => ipcRenderer.invoke('extract:cancel', key),
    onJobs: (fn: (jobs: Job[]) => void) => on('extract:jobs', fn),
    onFinished: (fn: (gameId: number) => void) => on('extract:finished', fn)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
export type { CommonPassword }
export type { InboxEntry, Job, PostExtractAction, GameCard, Candidate, ProductDetail, Running }
