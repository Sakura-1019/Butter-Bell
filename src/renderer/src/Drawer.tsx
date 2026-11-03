// 详情抽屉（照原型）：封面、名称、启动、时长、状态、标签、启动文件、LE 开关、打开文件夹 / 卸载。
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameCard, LaunchOptions, Running } from '../../preload'
import { Cover, lastPlayed, playtime } from './Library'
import { ICONS } from './icons'
import { Identify, LaunchStep, errorText } from './Setup'

const STATUSES = ['playing', 'wishlist', 'completed'] as const

interface Props {
  game: GameCard | undefined // undefined = 关着
  running: Running | undefined
  leReady: boolean // 设置里指定了 LEProc.exe
  onChange: () => void // 改了什么，重新拉一次游戏列表
  onClose: () => void
  onError: (msg: string) => void
}

export default function Drawer({ game, running, leReady, onChange, onClose, onError }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-wrap') && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <>
      {game && <div className="scrim" onMouseDown={onClose} />}
      <aside className={game ? 'drawer open' : 'drawer'} aria-hidden={!game}>
        {game && <Body key={game.id} g={game} running={running} leReady={leReady} onChange={onChange} onClose={onClose} onError={onError} />}
      </aside>
    </>
  )
}

function Body({ g, running, leReady, onChange, onClose, onError }: { g: GameCard } & Omit<Props, 'game'>) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<'uninstall' | 'purge' | null>(null)
  const [modal, setModal] = useState<'identify' | 'launch' | null>(null)
  const [launchOpts, setLaunchOpts] = useState<LaunchOptions>()
  const [addingTag, setAddingTag] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const coverInput = useRef<HTMLInputElement>(null)

  // 每个操作完都刷新列表；出错了在提示条里说原因
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      onError(errorText(e))
    }
    setBusy(false)
    onChange()
  }

  useEffect(() => {
    if (!g.uninstalled) window.api.games.launchOptions(g.id).then(setLaunchOpts, () => undefined)
  }, [g.id, g.uninstalled, g.launchFile])

  const [elapsed, runSeconds] = useElapsed(running?.startedAt)
  const html = /.html?$/i.test(g.launchFile ?? '') // 浏览器里玩：不计时长

  let launch
  if (g.uninstalled) launch = null
  else if (running)
    launch = <button className="btn primary running" disabled aria-live="polite">{ICONS.play}<span className="num">{t('drawer.running', { t: elapsed })}</span></button>
  else
    launch = (
      <button className="btn primary" disabled={busy || !g.launchFile} onClick={() => act(() => window.api.games.launch(g.id))}>
        {ICONS.play}{t('drawer.launch')}
      </button>
    )

  return (
    <div className="scroll">
      <div className="top"><button className="iconbtn" onClick={onClose} aria-label={t('drawer.close')}>{ICONS.x}</button></div>
      <Cover g={g} className="d-cover" />
      <div className="d-head">
        {renaming ? (
          <input
            className="input title-input"
            defaultValue={g.title}
            autoFocus
            aria-label={t('drawer.rename')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.stopPropagation(), setRenaming(false)
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                const title = e.currentTarget.value
                setRenaming(false)
                act(() => window.api.games.update(g.id, { title }))
              }
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <h2 title={t('drawer.rename')} onDoubleClick={() => setRenaming(true)}>{g.title}</h2>
        )}
        <div className="maker">{g.circle || t('library.circleUnknown')}</div>
        <div className="d-edit">
          <button className="linkbtn" onClick={() => setRenaming(true)}>{t('drawer.rename')}</button>
          <button className="linkbtn" onClick={() => coverInput.current?.click()}>{t('drawer.changeCover')}</button>
          {!g.needsMetadata && !g.uninstalled && <button className="linkbtn" onClick={() => setModal('identify')}>{t('drawer.reidentify')}</button>}
          <input
            ref={coverInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) act(async () => window.api.games.setCover(g.id, new Uint8Array(await f.arrayBuffer())))
            }}
          />
        </div>
      </div>

      {g.needsMetadata && !g.uninstalled && (
        <div className="note">
          <strong>{t('drawer.needsTitle')}</strong>{t('drawer.needsHint')}
          <div className="acts"><button className="btn" onClick={() => setModal('identify')}>{t('drawer.identify')}</button></div>
        </div>
      )}
      {g.uninstalled && <div className="note"><strong>{t('drawer.goneTitle')}</strong>{t('drawer.goneHint')}</div>}

      {launch && <div className="d-launch">{launch}</div>}
      {launch && html && <p className="muted small d-hint">{t('drawer.htmlHint')}</p>}
      <div className="d-stats">
        <div><div className="k">{t('drawer.playtime')}</div><div className="v num" title={html ? t('drawer.htmlHint') : undefined}>{html ? t('drawer.noTiming') : playtime(t, g.playSeconds + runSeconds)}</div></div>
        <div><div className="k">{t('drawer.last')}</div><div className="v num">{lastPlayed(t, g.lastPlayedAt)}</div></div>
        <div><div className="k">{t('drawer.added')}</div><div className="v num">{t('time.date', { m: new Date(g.addedAt).getMonth() + 1, d: new Date(g.addedAt).getDate() })}</div></div>
      </div>

      <div className="d-sec">
        <h3>{t('drawer.status')}</h3>
        <div className="seg" role="radiogroup" aria-label={t('drawer.status')}>
          {STATUSES.map((s) => (
            <button key={s} role="radio" aria-checked={g.playStatus === s} aria-pressed={g.playStatus === s} onClick={() => act(() => window.api.games.update(g.id, { playStatus: s }))}>
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="d-sec">
        <h3>{t('drawer.tags')}</h3>
        <div className="tagedit">
          {g.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
              <button onClick={() => act(() => window.api.games.tag(g.id, tag, false))} aria-label={t('drawer.removeTag', { tag })}>{ICONS.x}</button>
            </span>
          ))}
          {addingTag ? (
            <input
              autoFocus
              placeholder={t('drawer.tagPlaceholder')}
              aria-label={t('drawer.tagPlaceholder')}
              onBlur={() => setAddingTag(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.stopPropagation(), setAddingTag(false)
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  const name = e.currentTarget.value
                  e.currentTarget.value = '' // 留着输入框，可以连续加
                  act(() => window.api.games.tag(g.id, name, true))
                }
              }}
            />
          ) : (
            <button className="add" onClick={() => setAddingTag(true)}>{ICONS.plus}{t('drawer.addTag')}</button>
          )}
        </div>
      </div>

      {!g.uninstalled && (
        <div className="d-sec">
          <h3>{t('drawer.launchSec')}</h3>
          <div className="rowline">
            <div className="lbl">{t('drawer.launchFile')}<small>{g.launchFile ?? t('drawer.noLaunchFile')}</small></div>
            <button className="linkbtn" disabled={!launchOpts?.candidates.length} title={launchOpts && !launchOpts.candidates.length ? t('drawer.noCandidates') : undefined} onClick={() => setModal('launch')}>
              {t('drawer.change')}
            </button>
          </div>
          {!html && ( // 网页游戏在浏览器里跑，用不上 LE
          <div className="rowline">
            <div className="lbl">{t('drawer.le')}<small>{leReady ? t('drawer.leHint') : t('drawer.leMissing')}</small></div>
            <button
              className="switch"
              role="switch"
              aria-checked={g.useLocaleEmulator}
              aria-label={t('drawer.le')}
              disabled={!leReady}
              onClick={() => act(() => window.api.games.update(g.id, { useLocaleEmulator: !g.useLocaleEmulator }))}
            />
          </div>
          )}
        </div>
      )}

      {confirm ? (
        <div className="confirm">
          <p>{t(confirm === 'uninstall' ? 'drawer.uninstallConfirm' : 'drawer.purgeConfirm')}</p>
          <div className="acts">
            <button className="btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
            <button
              className="btn danger solid"
              disabled={busy}
              onClick={() => (setConfirm(null), act(() => (confirm === 'uninstall' ? window.api.games.uninstall(g.id) : window.api.games.purge(g.id).then(onClose))))}
            >
              {t(confirm === 'uninstall' ? 'drawer.toTrash' : 'drawer.purgeGo')}
            </button>
          </div>
        </div>
      ) : (
        <div className="d-foot">
          {g.uninstalled ? <span /> : <button className="linkbtn" onClick={() => act(() => window.api.games.openFolder(g.id))}>{ICONS.folder}{t('drawer.openFolder')}</button>}
          <button className="btn danger" disabled={!!running} onClick={() => setConfirm(g.uninstalled ? 'purge' : 'uninstall')}>
            {t(g.uninstalled ? 'drawer.purge' : 'drawer.uninstall')}
          </button>
        </div>
      )}

      {modal === 'identify' && <Identify gameId={g.id} onDone={() => (setModal(null), onChange())} />}
      {modal === 'launch' && launchOpts && (
        <LaunchStep gameId={g.id} candidates={launchOpts.candidates} current={g.launchFile} onNext={() => (setModal(null), onChange())} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

// 运行中 m:ss 和已经跑了多少秒，从会话开始时间每秒算一次
function useElapsed(startedAt: string | undefined): [string, number] {
  const [nowMs, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  if (!startedAt) return ['', 0]
  const s = Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  return [`${h ? `${h}:${mm.padStart(2, '0')}` : mm}:${String(s % 60).padStart(2, '0')}`, s]
}
