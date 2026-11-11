import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { LANGUAGES } from './i18n'
import type { GameCard, InboxState, Job, Running, Settings as SettingsState, UpdateState } from '../../preload'
import { DEFAULT_LIBRARY_SORT, DEFAULT_NAV, NO_FILTER, applyFilter, hasFilter, pageGames, recentGroups, search, sortGames, splitRecentExtract, type Filter, type GamePage, type NavPage } from '../../core/library'
import { DEFAULT_SORT } from '../../core/inbox-view'
import Drawer from './Drawer'
import FilterBar from './Filter'
import FirstRun, { needsFirstRun } from './FirstRun'
import { ICONS } from './icons'
import Inbox, { unitsOf } from './Inbox'
import Library, { type Section } from './Library'
import Lockup from './Lockup'
import NavList from './NavList'
import Settings from './Settings'
import Setup from './Setup'

type Page = NavPage | 'settings'

const savedView = () => {
  try {
    return localStorage.getItem('view') === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export default function App() {
  const { t } = useTranslation()
  const [page, setPage] = useState<Page>('recent') // 打开程序总停在最近游玩
  const [filter, setFilter] = useState<Filter>(NO_FILTER) // 换页面就清空
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

  const anyUninstalled = !!games?.some((g) => g.uninstalled)
  // 已卸载的都接回或移除了：“已卸载”从左侧消失，停在那一页的回到游戏库
  useEffect(() => {
    if (games && page === 'uninstalled' && !anyUninstalled) setPage('library')
  }, [games, page, anyUninstalled])

  const go = (p: Page) => (setPage(p), setFilter(NO_FILTER), setQuery(''))
  const saveSetting = <K extends keyof SettingsState>(field: K, key: Parameters<typeof window.api.settings.set>[0], value: SettingsState[K]) => {
    setSettings((s) => s && { ...s, [field]: value }) // 先换，存设置在后面
    return window.api.settings.set(key, value).then(setSettings)
  }
  const inboxN = inbox ? unitsOf(inbox.entries).length : 0
  const runningIds = new Set(running.map((r) => r.gameId))
  const gamePage = page !== 'inbox' && page !== 'settings' ? page : null
  const myTags = settings?.myTags ?? []
  const sort = settings?.librarySort ?? DEFAULT_LIBRARY_SORT
  const onPage = games && gamePage ? search(pageGames(games, gamePage), query) : []
  const shown = gamePage && hasFilter(gamePage) ? applyFilter(onPage, filter) : onPage
  const filtering = !!filter.status || filter.tags.length > 0

  let sections: Section[] = []
  if (gamePage === 'recent')
    sections = recentGroups(shown, new Date()).map(([k, list]) => ({ key: k, title: t(`library.recentGroup.${k}`), games: list }))
  else if (gamePage === 'library' && !filtering && !query.trim()) {
    // “最近解压”放最上面，和下面不重复；有筛选或搜索时不分组
    const [recent, rest] = splitRecentExtract(shown)
    sections = recent.length
      ? [
          { key: 'recent', title: t('library.recentExtract'), games: recent, action: <button className="linkbtn shelf-act" onClick={() => window.api.games.clearRecent().then(loadGames)}>{t('library.clearRecent')}</button> },
          ...(rest.length ? [{ key: 'rest', title: t('library.rest'), games: sortGames(rest, sort) }] : [])
        ]
      : [{ key: 'all', title: null, games: sortGames(rest, sort) }]
  } else if (gamePage) sections = [{ key: 'all', title: null, games: gamePage === 'uninstalled' ? shown : sortGames(shown, sort) }]

  const emptyText = (p: GamePage) =>
    p === 'recent' ? (
      <div className="empty-state">
        <p>{t('library.noRecent')}</p>
        <div className="empty-acts">
          <button className="btn" onClick={() => go('library')}>{t('library.goLibrary')}</button>
          <button className="btn" onClick={() => go('inbox')}>{t('library.goInbox')}</button>
        </div>
      </div>
    ) : (
      <div className="empty-state"><p>{t(`library.empty.${p}`)}</p></div>
    )

  let content
  if (page === 'inbox')
    content = inbox && (
      <Inbox
        state={inbox}
        onChange={setInbox}
        jobs={jobs}
        query={query}
        onClearQuery={() => setQuery('')}
        sort={settings?.inboxSort ?? DEFAULT_SORT}
        onSort={(s) => saveSetting('inboxSort', 'inbox_sort', s)}
        onAdded={async (ids) => {
          const gs = await loadGames()
          // 接回的游戏资料都还在，不用再补
          setSetup((q) => [...q, ...ids.filter((id) => gs.some((g) => g.id === id && (g.needsMetadata || !g.launchFile)))])
        }}
      />
    )
  else if (page === 'settings') content = settings && <Settings s={settings} onChange={setSettings} onInbox={setInbox} update={update} onUpdate={setUpdate} />
  else if (!games || !gamePage) content = null
  else if (!pageGames(games, gamePage).length) content = emptyText(gamePage)
  else if (!shown.length)
    content = (
      <div className="empty-state">
        <p>{query.trim() && !filtering ? t('library.noMatch', { q: query.trim() }) : t('filter.noMatch')}</p>
        <button className="btn" onClick={() => (setQuery(''), setFilter(NO_FILTER))}>{t('filter.clearAll')}</button>
      </div>
    )
  else
    content = (
      <Library
        sections={sections}
        running={runningIds}
        view={view}
        recent={page === 'recent'}
        openId={openId}
        onOpen={setOpenId}
        onFavorite={(g) => window.api.games.update(g.id, { favorite: !g.favorite }).then(loadGames)}
      />
    )

  return (
    <div className={privacy ? 'app privacy' : 'app'}>
      <div className="titlebar" />
      <aside className="sidebar">
        <div className="brand"><Lockup /></div>
        <NavList
          order={settings?.navOrder ?? DEFAULT_NAV}
          hidden={anyUninstalled ? [] : ['uninstalled']}
          current={page}
          badges={{ inbox: inboxN }}
          onGo={go}
          onReorder={(order) => saveSetting('navOrder', 'nav_order', order)}
        />
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
        <button className="nav" aria-current={page === 'settings'} onClick={() => go('settings')}>
          {ICONS.settings}
          <span className="label">{t('nav.settings')}</span>
        </button>
      </aside>
      <main className="main">
        <div className="toolbar">
          <h1>
            {t(`nav.${page}`)}
            {page === 'inbox' && inbox?.dir && <span className="count num">{inboxN}</span>}
            {gamePage && games && <span className="count num">{shown.length}</span>}
          </h1>
          <span className="grow" />
          {(gamePage || (page === 'inbox' && !!inbox?.dir)) && (
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
          {gamePage && (
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
            className={privacy ? 'btn icon privacy-btn on' : 'btn icon privacy-btn ghost'}
            aria-pressed={privacy}
            aria-label={privacy ? t('library.privacyOn') : t('library.privacy')}
            title={t('library.privacyHint')}
            onClick={togglePrivacy}
          >
            {privacy ? ICONS.eyeOff : ICONS.eye}
          </button>
        </div>
        {gamePage && hasFilter(gamePage) && games && pageGames(games, gamePage).length > 0 && (
          <FilterBar
            key={gamePage}
            page={gamePage}
            games={onPage}
            all={games}
            filter={filter}
            onFilter={setFilter}
            sort={sort}
            onSort={(s) => saveSetting('librarySort', 'library_sort', s)}
            myTags={myTags}
            onMyTags={(tags) => {
              // 移出“我的标签”的词也不再用来筛选
              setFilter((f) => ({ ...f, tags: f.tags.filter((x) => tags.some((y) => y.toLowerCase() === x.toLowerCase())) }))
              saveSetting('myTags', 'my_tags', tags)
            }}
            onDeleteTag={async (name) => {
              setFilter((f) => ({ ...f, tags: f.tags.filter((x) => x.toLowerCase() !== name.toLowerCase()) }))
              setSettings(await window.api.games.deleteTag(name))
              await loadGames()
            }}
          />
        )}
        <div className="content">{content}</div>
      </main>
      <Drawer
        game={games?.find((g) => g.id === openId)}
        running={running.find((r) => r.gameId === openId)}
        leReady={!!settings?.localeEmulatorPath}
        myTags={myTags}
        onMyTags={(tags) => saveSetting('myTags', 'my_tags', tags)}
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
