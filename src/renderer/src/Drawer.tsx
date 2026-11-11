// 详情抽屉（照原型）：封面、名称、启动、时长、状态、标签、启动文件、LE 开关、打开文件夹 / 卸载。
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameCard, LaunchOptions, Running } from '../../preload'
import { Cover, lastPlayed, playtime } from './Library'
import { ICONS } from './icons'
import { Identify, LaunchStep, errorText } from './Setup'

const STATUSES = ['playing', 'wishlist', 'completed'] as const

// 选中“通关”时炸开的星点：每颗飞出去的方向和距离
const SPARKS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 + (i % 2) * 0.3
  const r = 26 + (i % 3) * 12
  return { '--x': `${Math.round(Math.cos(angle) * r * 1.5)}px`, '--y': `${Math.round(Math.sin(angle) * r * 0.75)}px` } as React.CSSProperties
})

interface Props {
  game: GameCard | undefined // undefined = 关着
  running: Running | undefined
  leReady: boolean // 设置里指定了 LEProc.exe
  myTags: string[] // 加标签时列出来的词
  onMyTags: (tags: string[]) => void // 新起的标签也加进我的标签
  onChange: () => void // 改了什么，重新拉一次游戏列表
  onClose: () => void
  onError: (msg: string) => void
}

export default function Drawer({ game, running, leReady, myTags, onMyTags, onChange, onClose, onError }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-wrap') && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <>
      {game && <div className="scrim" onMouseDown={onClose} />}
      <aside className={game ? 'drawer open' : 'drawer'} aria-hidden={!game}>
        {game && <Body key={game.id} g={game} running={running} leReady={leReady} myTags={myTags} onMyTags={onMyTags} onChange={onChange} onClose={onClose} onError={onError} />}
      </aside>
    </>
  )
}

function Body({ g, running, leReady, myTags, onMyTags, onChange, onClose, onError }: { g: GameCard } & Omit<Props, 'game'>) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<'uninstall' | 'purge' | null>(null)
  const [modal, setModal] = useState<'identify' | 'launch' | null>(null)
  const [launchOpts, setLaunchOpts] = useState<LaunchOptions>()
  const [addingTag, setAddingTag] = useState(false)
  const [sparks, setSparks] = useState(false) // 刚点了“通关”，放一次星点；打开已通关的游戏时不放
  const [draftTitle, setDraftTitle] = useState<string | null>(null) // null = 没在改名称
  const renaming = draftTitle !== null
  const [editingVersion, setEditingVersion] = useState(false)
  const [countdown, setCountdown] = useState(0) // “截取当前画面”的倒数
  // 退出游戏：closing = 已经发了关闭，等游戏退出（runner 看到进程没了，running 变空才回到 idle）；stuck = 5 秒没关掉
  const [quitState, setQuitState] = useState<'idle' | 'closing' | 'stuck'>('idle')
  useEffect(() => {
    if (!running) setQuitState('idle')
  }, [running])
  const quit = async (force: boolean) => {
    setQuitState('closing')
    try {
      if ((await window.api.games.quit(g.id, force)) === 'stuck') setQuitState('stuck')
    } catch (e) {
      setQuitState('idle')
      onError(errorText(e))
    }
  }
  // 运行中按钮悬停（或键盘聚焦）时变成“退出游戏”。刚点完启动、鼠标还停在按钮上时不变：要先移开再移回来（armed）
  const [hover, setHover] = useState(false)
  const [armed, setArmed] = useState(true)
  const [keyFocus, setKeyFocus] = useState(false)
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

  // 改名称时 Esc 只取消改名，不关详情页；焦点不在输入框里也一样。关详情页时这个状态跟着没了，也就是放弃
  useEffect(() => {
    if (!renaming) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-wrap')) return
      e.stopPropagation()
      setDraftTitle(null)
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [renaming])
  const saveTitle = () => {
    if (!draftTitle?.trim()) return
    const title = draftTitle
    setDraftTitle(null)
    act(() => window.api.games.update(g.id, { title }))
  }

  const [elapsed, runSeconds] = useElapsed(running?.startedAt)
  // 截取当前画面：主进程把游戏窗口切到前面、等 3 秒再截；这边同时倒数
  const capture = async () => {
    setCountdown(3)
    const tick = setInterval(() => setCountdown((n) => Math.max(1, n - 1)), 1000)
    try {
      const r = await window.api.games.capture(g.id)
      onError(t(`drawer.capture${r === 'ok' ? 'Ok' : r === 'blank' ? 'Blank' : r === 'background' ? 'Background' : 'None'}`))
    } catch (e) {
      onError(errorText(e))
    }
    clearInterval(tick)
    setCountdown(0)
    onChange()
  }
  const html = /.html?$/i.test(g.launchFile ?? '') // 浏览器里玩：不计时长

  const pointer = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => (setHover(false), setArmed(true)),
    onFocus: (e: React.FocusEvent<HTMLButtonElement>) => setKeyFocus(e.currentTarget.matches(':focus-visible')),
    onBlur: () => setKeyFocus(false)
  }
  const offerQuit = running && !html && ((hover && armed) || keyFocus || quitState === 'closing')

  let launch
  if (g.uninstalled) launch = null
  else if (offerQuit)
    // 先正常关闭（游戏可以弹保存提示）；5 秒没关掉才在下面问要不要强制结束
    launch = (
      <button className="btn primary running quit" disabled={quitState !== 'idle'} {...pointer} onClick={() => quit(false)}>
        {t(quitState === 'closing' ? 'drawer.quitting' : 'drawer.quit')}
      </button>
    )
  else if (running)
    launch = (
      <button className="btn primary running" aria-live="polite" {...pointer}>
        {ICONS.play}<span className="num">{t('drawer.running', { t: elapsed })}</span>
      </button>
    )
  else
    launch = (
      <button className="btn primary" disabled={busy || !g.launchFile} {...pointer} onClick={() => (setArmed(false), act(() => window.api.games.launch(g.id)))}>
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
            value={draftTitle}
            autoFocus
            aria-label={t('drawer.rename')}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
          />
        ) : (
          <div className="d-namerow">
            <h2 className="sel">{g.title}</h2>
            {/* 收藏：名称旁边一颗星，黄油黄。已卸载的不能收藏 */}
            {!g.uninstalled && (
              <button
                className={g.favorite ? 'd-star on' : 'd-star'}
                aria-pressed={g.favorite}
                aria-label={t(g.favorite ? 'library.unfavorite' : 'library.favorite')}
                title={t(g.favorite ? 'library.unfavorite' : 'library.favorite')}
                onClick={() => act(() => window.api.games.update(g.id, { favorite: !g.favorite }))}
              >
                {ICONS.star}
              </button>
            )}
          </div>
        )}
        <div className="maker sel">{g.circle || t('library.circleUnknown')}</div>
        <div className="d-edit">
          {renaming ? (
            <button className="linkbtn save" disabled={!draftTitle.trim()} onClick={saveTitle}>{t('drawer.saveName')}</button>
          ) : (
            <button className="linkbtn" onClick={() => setDraftTitle(g.title)}>{t('drawer.rename')}</button>
          )}
          <button className="linkbtn" onClick={() => coverInput.current?.click()}>{t('drawer.changeCover')}</button>
          {/* 已有信息时“识别信息”在这一排；还没信息时在下面的提示框里 */}
          {!g.needsMetadata && !g.uninstalled && <button className="linkbtn" onClick={() => setModal('identify')}>{t('drawer.identify')}</button>}
          {running && !html && (
            <button className="linkbtn" disabled={countdown > 0} title={t('drawer.captureHint')} onClick={capture}>
              {countdown ? t('drawer.captureIn', { n: countdown }) : t('drawer.capture')}
            </button>
          )}
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

      {/* 信息从哪来：还没信息时是醒目的提示框（带“识别信息”）；有了就是一行小字，DLsite 页面靠右 */}
      {g.needsMetadata ? (
        !g.uninstalled && (
          <div className="note">
            <strong>{t(g.coverFile ? 'drawer.needsTitleCovered' : 'drawer.needsTitle')}</strong>{t('drawer.needsHint')}
            <div className="acts"><button className="btn" onClick={() => setModal('identify')}>{t('drawer.identify')}</button></div>
          </div>
        )
      ) : (
        <div className="d-info">
          <span className="src">
            {g.sourceKind === 'dlsite' ? <>{t('drawer.infoDlsite')}<span className="sep">·</span><span className="sel num">{g.sourceRef}</span></> : t('drawer.infoManual')}
          </span>
          {g.dlsiteUrl && (
            <button className="linkbtn" title={g.dlsiteUrl} onClick={() => act(() => window.api.games.openDlsite(g.id))}>
              {t('drawer.openDlsite')}{ICONS.external}
            </button>
          )}
        </div>
      )}
      {g.uninstalled && <div className="note"><strong>{t('drawer.goneTitle')}</strong>{t('drawer.goneHint')}</div>}

      {launch && <div className="d-launch">{launch}</div>}
      {/* 运行中按钮悬停时点了正常关闭；5 秒没关掉才问要不要强制结束 */}
      {running && !html && quitState === 'stuck' && (
        <div className="confirm">
          <p>{t('drawer.quitStuck')}</p>
          <div className="acts">
            <button className="btn ghost" onClick={() => setQuitState('idle')}>{t('common.cancel')}</button>
            <button className="btn danger solid" onClick={() => quit(true)}>{t('drawer.forceQuit')}</button>
          </div>
        </div>
      )}
      {launch && html && <p className="muted small d-hint">{t('drawer.htmlHint')}</p>}
      <div className="d-stats">
        <div><div className="k">{t('drawer.playtime')}</div><div className="v num" title={html ? t('drawer.htmlHint') : undefined}>{html ? t('drawer.noTiming') : playtime(t, g.playSeconds + runSeconds)}</div></div>
        <div><div className="k">{t('drawer.last')}</div><div className="v num">{lastPlayed(t, g.lastPlayedAt)}</div></div>
        <div><div className="k">{t('drawer.added')}</div><div className="v num">{t('time.date', { m: new Date(g.addedAt).getMonth() + 1, d: new Date(g.addedAt).getDate() })}</div></div>
      </div>

      <div className="d-sec">
        <h3>{t('drawer.status')}</h3>
        <div className={g.playStatus === 'completed' ? 'seg status-seg done' : 'seg status-seg'} role="radiogroup" aria-label={t('drawer.status')} style={{ '--i': STATUSES.indexOf(g.playStatus) } as React.CSSProperties}>
          {STATUSES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={g.playStatus === s}
              aria-pressed={g.playStatus === s}
              onClick={() => {
                if (g.playStatus !== s) setSparks(s === 'completed')
                act(() => window.api.games.update(g.id, { playStatus: s }))
              }}
            >
              {s === 'completed' && g.playStatus === s && ICONS.crown}
              {t(`status.${s}`)}
              {s === 'completed' && sparks && SPARKS.map((style, i) => <i key={i} className="spark" style={style} onAnimationEnd={() => setSparks(false)} />)}
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
          <button className="add" aria-expanded={addingTag} onClick={() => setAddingTag(!addingTag)}>{ICONS.plus}{t('drawer.addTag')}</button>
        </div>
        {/* 加标签：先列出我的标签里还没加的词，也可以起一个新的（新的同时加进我的标签） */}
        {addingTag && (
          <div className="picker">
            {myTags
              .filter((x) => !g.tags.some((y) => y.toLowerCase() === x.toLowerCase()))
              .map((x) => (
                <button key={x} className="lchip" onClick={() => act(() => window.api.games.tag(g.id, x, true))}>{x}</button>
              ))}
            <input
              autoFocus
              className="input"
              maxLength={64}
              placeholder={t('drawer.tagPlaceholder')}
              aria-label={t('drawer.tagPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.stopPropagation(), setAddingTag(false)
                const name = e.currentTarget.value.trim()
                if (e.key === 'Enter' && name) {
                  e.currentTarget.value = '' // 留着输入框，可以连续加
                  if (!myTags.some((x) => x.toLowerCase() === name.toLowerCase())) onMyTags([...myTags, name])
                  act(() => window.api.games.tag(g.id, name, true))
                }
              }}
            />
          </div>
        )}
      </div>

      {!g.uninstalled && (
        <div className="d-sec">
          <h3>{t('drawer.launchSec')}</h3>
          <div className="rowline">
            {editingVersion ? (
              <input
                className="input grow"
                defaultValue={g.version ?? ''}
                autoFocus
                placeholder={t('drawer.versionPlaceholder')}
                aria-label={t('drawer.versionEdit')}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.stopPropagation(), setEditingVersion(false)
                  if (e.key === 'Enter') {
                    const version = e.currentTarget.value
                    setEditingVersion(false)
                    act(() => window.api.games.update(g.id, { version }))
                  }
                }}
                onBlur={() => setEditingVersion(false)}
              />
            ) : (
              <>
                <div className="lbl">{t('drawer.version')}<small className="num sel">{g.version ?? t('drawer.versionNone')}</small></div>
                <button className="linkbtn" onClick={() => setEditingVersion(true)}>{t('drawer.change')}</button>
              </>
            )}
          </div>
          <div className="rowline">
            <div className="lbl">{t('drawer.launchFile')}<small className="sel">{g.launchFile ?? t('drawer.noLaunchFile')}</small></div>
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
