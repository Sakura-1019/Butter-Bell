// 游戏库：封面墙和列表两种视图，按传进来的分组显示（最近游玩的时间分组、游戏库的“最近解压”），每组放不下自动换行。
import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { GameCard } from '../../preload'
import { formatPlaytime } from '../../core/library'
import { ICONS } from './icons'

export const playtime = (t: TFunction, seconds: number) => {
  const f = formatPlaytime(seconds)
  return t(`time.${f.key}`, f.key === 'never' ? {} : { n: f.n })
}

export function lastPlayed(t: TFunction, iso: string | null) {
  if (!iso) return t('time.none')
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(new Date()) - day(d)) / 864e5)
  const hm = d.toTimeString().slice(0, 5)
  if (days === 0) return t('time.today', { hm })
  if (days === 1) return t('time.yesterday', { hm })
  if (days < 7) return t('time.daysAgo', { n: days })
  return t('time.date', { m: d.getMonth() + 1, d: d.getDate() })
}

export const coverSrc = (file: string) => `cover://c/${file.slice(file.lastIndexOf('/') + 1)}`

export function Cover({ g, running, className = 'cover' }: { g: GameCard; running?: boolean; className?: string }) {
  const { t } = useTranslation()
  if (!g.coverFile) return <div className={`${className} empty`}><div>{ICONS.image}{t('library.needsCover')}</div></div>
  return (
    <div className={g.uninstalled ? `${className} gone` : className}>
      <img src={coverSrc(g.coverFile)} alt="" loading="lazy" />
      {running ? <span className="flag"><span className="dot" />{t('library.running')}</span> : g.uninstalled && <span className="flag">{t('library.uninstalled')}</span>}
    </div>
  )
}

export interface Section {
  key: string
  title: string | null // null = 不分组，没有标题
  games: GameCard[]
  action?: ReactNode // 标题右边的按钮，如“最近解压”的清空
}

interface Props {
  sections: Section[]
  running: Set<number>
  view: 'grid' | 'list'
  recent?: boolean // 最近游玩：卡片下面显示上次游玩和时长
  openId: number | null
  onOpen: (id: number) => void
  onFavorite: (g: GameCard) => void
}

export default function Library({ sections, running, view, recent, openId, onOpen, onFavorite }: Props) {
  const { t } = useTranslation()
  const keyOpen = (e: React.KeyboardEvent, id: number) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onOpen(id))

  // 收藏的星：封面右上角，悬停才显示，收藏了的常驻。已卸载的不能收藏
  const star = (g: GameCard) =>
    !g.uninstalled && (
      <button
        className={g.favorite ? 'star on' : 'star'}
        aria-pressed={g.favorite}
        aria-label={t(g.favorite ? 'library.unfavorite' : 'library.favorite')}
        title={t(g.favorite ? 'library.unfavorite' : 'library.favorite')}
        onClick={(e) => (e.stopPropagation(), onFavorite(g))}
      >
        {ICONS.star}
      </button>
    )

  const card = (g: GameCard) => {
    let meta
    if (running.has(g.id)) meta = <><span className="dot" /><span className="run">{t('library.running')}</span></>
    else if (g.needsMetadata) meta = t('library.needsMetadata')
    else if (recent) meta = `${lastPlayed(t, g.lastPlayedAt)} · ${playtime(t, g.playSeconds)}`
    else
      meta = (
        <>
          {g.playStatus === 'playing' && !g.uninstalled && <span className="dot" />}
          {[g.circle, g.playSeconds ? playtime(t, g.playSeconds) : t(`status.${g.playStatus}`)].filter(Boolean).join(' · ')}
        </>
      )
    return (
      <div key={g.id} role="button" tabIndex={0} className={g.uninstalled ? 'card gone' : 'card'} aria-current={openId === g.id} onClick={() => onOpen(g.id)} onKeyDown={(e) => keyOpen(e, g.id)}>
        <div className="cover-wrap">
          <Cover g={g} running={running.has(g.id)} />
          {star(g)}
        </div>
        <div>
          <div className="name" title={g.title}>{g.title}</div>
          <div className="meta num">{meta}</div>
        </div>
      </div>
    )
  }

  const table = (games: GameCard[]) => (
    <table className="list">
      <thead>
        <tr>
          {(['name', 'status', 'tags'] as const).map((k) => <th key={k}>{t(`library.col.${k}`)}</th>)}
          <th className="num">{t('library.col.playtime')}</th>
          <th className="num">{t('library.col.last')}</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => (
          <tr key={g.id} className={g.uninstalled ? 'row gone' : 'row'} aria-current={openId === g.id} tabIndex={0} onClick={() => onOpen(g.id)} onKeyDown={(e) => keyOpen(e, g.id)}>
            <td>
              <div className="namecell">
                <div className="thumb">{g.coverFile && <img src={coverSrc(g.coverFile)} alt="" loading="lazy" />}</div>
                <div className="grow">
                  <div className="nm">
                    {g.title}
                    {g.favorite && !g.uninstalled && <span className="ministar" title={t('library.favorited')}>{ICONS.star}</span>}
                  </div>
                  <div className="mk">{g.circle}</div>
                </div>
              </div>
            </td>
            <td>
              {running.has(g.id) ? (
                <span className="pill playing"><span className="dot" />{t('library.running')}</span>
              ) : (
                <span className={g.playStatus === 'playing' && !g.uninstalled ? 'pill playing' : 'pill'}>{t(`status.${g.uninstalled ? 'uninstalled' : g.playStatus}`)}</span>
              )}
            </td>
            <td><div className="chips">{g.tags.map((x) => <span key={x} className="chip">{x}</span>)}</div></td>
            <td className="num muted">{g.playSeconds ? playtime(t, g.playSeconds) : t('time.none')}</td>
            <td className="num muted">{lastPlayed(t, g.lastPlayedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const body = (games: GameCard[]) => (view === 'list' ? table(games) : <div className="wall">{games.map(card)}</div>)
  return sections.map((s) =>
    s.title === null ? (
      <div key={s.key}>{body(s.games)}</div>
    ) : (
      <section key={s.key} className="shelf">
        <h2>{s.title}<span className="n num">{s.games.length}</span>{s.action}</h2>
        {body(s.games)}
      </section>
    )
  )
}
