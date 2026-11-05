import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { LANGUAGES } from './i18n'
import type { GameCard, InboxState, Job, Running, Settings as SettingsState, UpdateState } from '../../preload'
import { recentlyPlayed, search, tagCounts, withTag } from '../../core/library'
import { DEFAULT_SORT } from '../../core/inbox-view'
import Drawer from './Drawer'
import FirstRun, { needsFirstRun } from './FirstRun'
import { Bell, ICONS } from './icons'
import Inbox, { unitsOf } from './Inbox'
import Library from './Library'
import Settings from './Settings'
import Setup from './Setup'

type Page = 'all' | 'inbox' | 'recent' | 'settings'

const savedView = () => {
  try {
    return localStorage.getItem('view') === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export default function App() {
  const { t } = useTranslation()
  const [page, setPage] = useState<Page>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [view, setView] = useState<'grid' | 'list'>(savedView)
  const [games, setGames] = useState<GameCard[]>()
  const [openId, setOpenId] = useState<number | null>(null)
  const [running, setRunning] = useState<Running[]>([])
  const [settings, setSettings] = useState<SettingsState>()
  const [setup, setSetup] = useState<number[]>([]) // 等着补资料的游戏，解压完一个排一个
  const [inbox, setInbox] = useState<InboxState>()
  const [jobs, setJobs] = useState<Job[]>([])
  const [toast, setToast] = useState('')
  const [firstRun, setFirstRun] = useState(false)
  const [query, setQuery] = useState('') // 工具栏搜索，换页时清空
  const [update, setUpdate] = useState<UpdateState>()

  const loadGames = useCallback(() => window.api.games.list().then((gs) => (setGames(gs), gs)), [])

  useEffect(() => {
    loadGames()
    window.api.settings.get().then((s) => {
      setSettings(s)
      setFirstRun(needsFirstRun(s))
      if (s.language in LANGUAGES) i18n.changeLanguage(s.language)
      // 启动时问一次有没有新版本；查不到（没网、GitHub 出错）就当没有，不打扰
      if (s.checkUpdates) window.api.update.check().then(setUpdate, () => {})
    })
    window.api.update.get().then(setUpdate)
    // 启动时和窗口重新获得焦点时扫一遍仓库目录，新下载的包自己出现
    // 扫游戏目录时可能自动接回了已卸载的游戏，游戏列表也刷新
    const scan = () => window.api.inbox.scan().then((s) => (setInbox(s), loadGames()))
    scan()
    window.addEventListener('focus', scan)
    window.api.extract.jobs().then(setJobs)
    window.api.play.running().then(setRunning)
    const offJobs = window.api.extract.onJobs(setJobs)
    const offRunning = window.api.play.onRunning((r) => (setRunning(r), loadGames())) // 游戏退出时时长变了
    const offChanged = window.api.games.onChanged(() => loadGames()) // 封面在后台换了（截图、在文件夹里找到）
    const offDone = window.api.extract.onFinished(async (id) => {
      window.api.inbox.get().then(setInbox)
      const g = (await loadGames()).find((x) => x.id === id)
      // 接回的游戏资料都还在，不用再补
      if (g && (g.needsMetadata || !g.launchFile)) setSetup((q) => [...q, id])
    })
    return () => {
      window.removeEventListener('focus', scan)
      offJobs()
      offRunning()
      offChanged()
      offDone()
    }
  }, [loadGames])

  const privacy = settings?.privacyMode ?? false
  const togglePrivacy = useCallback(() => {
    setSettings((s) => s && { ...s, privacyMode: !s.privacyMode })
    window.api.settings.set('privacy_mode', !privacy).then(setSettings)
  }, [privacy])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h' && (e.preventDefault(), togglePrivacy())
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [togglePrivacy])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const go = (p: Page, tg: string | null = null) => (setPage(p), setTag(tg), setQuery(''))
  const inboxN = inbox ? unitsOf(inbox.entries).length : 0
  const runningIds = new Set(running.map((r) => r.gameId))
  const library = page === 'all' || page === 'recent'
  const shown = search(!games ? [] : page === 'recent' ? recentlyPlayed(games) : tag ? withTag(games, tag) : games, query)

  const nav = (key: Page, badge?: number) => (
    <button className="nav" aria-current={page === key && !tag} onClick={() => go(key)}>
      {ICONS[key]}
      <span className="label">{t(`nav.${key}`)}</span>
      {badge ? <span className="badge num">{badge}</span> : null}
    </button>
  )

  return (
    <div className={privacy ? 'app privacy' : 'app'}>
      <div className="titlebar" />
      <aside className="sidebar">
        <div className="brand"><Bell /><span>Butter Bell</span></div>
        {nav('all')}
        {nav('inbox', inboxN)}
        {nav('recent')}
        {games && tagCounts(games).length > 0 && (
          <>
            <div className="group-label">
              <span>{t('library.tags')}</span>
              {tag && <button onClick={() => go('all')}>{t('library.clearTag')}</button>}
            </div>
            {tagCounts(games).map(([name, n]) => (
              <button key={name} className="nav tag" aria-current={tag === name} onClick={() => go('all', name)}>
                <span className="hash">#</span>
                <span className="label">{name}</span>
                <span className="count num">{n}</span>
              </button>
            ))}
          </>
        )}
        <div className="spacer" />
        {update?.latest && update.latest.version !== update.dismissed && (
          <div className="update-note">
            <button className="nav" title={t('update.openHint')} onClick={() => window.api.update.open()}>
              <span className="dot" />
              <span className="label">{t('update.available', { v: update.latest.version })}</span>
            </button>
            <button className="iconbtn plain" aria-label={t('update.dismiss')} title={t('update.dismiss')} onClick={() => window.api.update.dismiss().then(setUpdate)}>{ICONS.x}</button>
          </div>
        )}
        {nav('settings')}
      </aside>
      <main className="main">
        <div className="toolbar">
          <h1>
            {tag ? `# ${tag}` : t(`nav.${page}`)}
            {page === 'inbox' && inbox?.dir && <span className="count num">{inboxN}</span>}
            {library && games && <span className="count num">{shown.length}</span>}
          </h1>
          <span className="grow" />
          {(library || (page === 'inbox' && !!inbox?.dir)) && (
            <label className="search">
              {ICONS.search}
              <input
                type="search"
                value={query}
                placeholder={t(page === 'inbox' ? 'inbox.search' : 'library.search')}
                aria-label={t(page === 'inbox' ? 'inbox.searchLabel' : 'library.searchLabel')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              />
            </label>
          )}
          {library && (
            <div className="seg" role="group" aria-label={t('library.view')}>
              {(['grid', 'list'] as const).map((v) => (
                <button
                  key={v}
                  className="icon"
                  aria-pressed={view === v}
                  title={t(`library.${v}`)}
                  aria-label={t(`library.${v}`)}
                  onClick={() => {
                    setView(v)
                    try {
                      localStorage.setItem('view', v)
                    } catch {
                      // 存不了就只在这次运行里记着
                    }
                  }}
                >
                  {ICONS[v]}
                </button>
              ))}
            </div>
          )}
          <button
            className={privacy ? 'btn icon on' : 'btn icon ghost'}
            aria-pressed={privacy}
            aria-label={privacy ? t('library.privacyOn') : t('library.privacy')}
            title={t('library.privacyHint')}
            onClick={togglePrivacy}
          >
            {privacy ? ICONS.eyeOff : ICONS.eye}
          </button>
        </div>
        <div className="content">
          {page === 'inbox' ? (
            inbox && (
              <Inbox
                state={inbox}
                onChange={setInbox}
                jobs={jobs}
                query={query}
                onClearQuery={() => setQuery('')}
                sort={settings?.inboxSort ?? DEFAULT_SORT}
                onSort={(sort) => {
                  setSettings((s) => s && { ...s, inboxSort: sort }) // 先换，存设置在后面
                  window.api.settings.set('inbox_sort', sort).then(setSettings)
                }}
                onAdded={async (ids) => {
                  const gs = await loadGames()
                  // 接回的游戏资料都还在，不用再补
                  setSetup((q) => [...q, ...ids.filter((id) => gs.some((g) => g.id === id && (g.needsMetadata || !g.launchFile)))])
                }}
              />
            )
          ) : page === 'settings' ? (
            settings && <Settings s={settings} onChange={setSettings} onInbox={setInbox} update={update} onUpdate={setUpdate} />
          ) : !games ? null : !games.length ? (
            <div className="empty-state"><p>{t('library.empty')}</p></div>
          ) : !shown.length && query.trim() ? (
            <div className="empty-state">
              <p>{t('library.noMatch', { q: query.trim() })}</p>
              <button className="btn" onClick={() => setQuery('')}>{t('library.clearSearch')}</button>
            </div>
          ) : !shown.length ? (
            <div className="empty-state"><p>{t(page === 'recent' ? 'library.noRecent' : 'library.noTag')}</p></div>
          ) : (
            <Library games={shown} running={runningIds} view={view} grouped={page === 'all' && !tag} recent={page === 'recent'} openId={openId} onOpen={setOpenId} />
          )}
        </div>
      </main>
      <Drawer
        game={games?.find((g) => g.id === openId)}
        running={running.find((r) => r.gameId === openId)}
        leReady={!!settings?.localeEmulatorPath}
        onChange={() => (loadGames(), window.api.inbox.get().then(setInbox))} // 卸载后压缩包回到收件箱
        onClose={() => setOpenId(null)}
        onError={setToast}
      />
      {toast && (
        <div className="toasts" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
      {firstRun && settings && (
        <FirstRun
          s={settings}
          onChange={setSettings}
          onDone={async () => {
            setFirstRun(false)
            const s = await window.api.inbox.scan() // 选完目录先扫一遍
            setInbox(s)
            if (s.entries.length) go('inbox')
          }}
        />
      )}
      {setup[0] !== undefined && (
        <Setup
          key={setup[0]}
          gameId={setup[0]}
          onDone={() => {
            setSetup((q) => q.slice(1))
            loadGames()
          }}
        />
      )}
    </div>
  )
}
