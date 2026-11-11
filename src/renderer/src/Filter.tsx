// 游戏库、收藏、已通关的筛选和排序（导航原型定稿：review\nav-prototype）。
// “筛选”按钮点开是面板：状态（游戏库和收藏才有）、我的标签里有游戏在用的词、点开的完整标签库。平时只显示已选的条件。
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameCard } from '../../preload'
import { CATEGORIES, inLibrary } from '../../core/genres'
import { LIBRARY_SORT_KEYS, countWithTag, hasStatusFilter, tagUseCount, usedTags, type Filter, type GamePage, type LibrarySort } from '../../core/library'
import { ContextMenu, SortIcon } from './Inbox'
import { ICONS } from './icons'

const STATUSES = ['playing', 'wishlist', 'completed'] as const

interface Props {
  page: GamePage
  games: GameCard[] // 这一页的游戏（已经按搜索词过滤）
  all: GameCard[] // 整个库，标签库里的游戏数用它
  filter: Filter
  onFilter: (f: Filter) => void
  sort: LibrarySort
  onSort: (s: LibrarySort) => void
  myTags: string[]
  onMyTags: (tags: string[]) => void
  onDeleteTag: (name: string) => Promise<void>
}

export default function FilterBar({ page, games, all, filter, onFilter, sort, onSort, myTags, onMyTags, onDeleteTag }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number }>()
  const wrap = useRef<HTMLDivElement>(null)
  const status = hasStatusFilter(page)
  const n = (filter.status ? 1 : 0) + filter.tags.length
  const toggleTag = (tag: string) => onFilter({ ...filter, tags: filter.tags.includes(tag) ? filter.tags.filter((x) => x !== tag) : [...filter.tags, tag] })

  // 点面板外面就收起
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key, true)
    return () => (window.removeEventListener('mousedown', close), window.removeEventListener('keydown', key, true))
  }, [open])

  const tagChip = (tag: string) => {
    const on = filter.tags.includes(tag)
    const count = countWithTag(games, filter, tag)
    return (
      <button key={tag} className="fchip" aria-pressed={on} disabled={!on && !count} onClick={() => toggleTag(tag)}>
        {tag}<span className="c num">{count}</span>
      </button>
    )
  }
  const used = usedTags(games, myTags)

  return (
    <div className="fbar" ref={wrap}>
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {ICONS.filter}{t('filter.button')}
        {n > 0 && <span className="fbadge num">{n}</span>}
        <span className="chev">{ICONS.chevDown}</span>
      </button>
      {/* 排序：和待解压同一种胶囊，菜单沿用右键菜单的样式，左对齐 */}
      <div className="sortseg" role="group" aria-label={t('inbox.sort.label')}>
        <button
          aria-haspopup="menu"
          aria-expanded={!!sortMenu}
          onMouseDown={(e) => sortMenu && e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setSortMenu(sortMenu ? undefined : { x: r.left - 3, y: r.bottom + 6 })
          }}
        >
          {t(`filter.sort.${sort.key}`)}
          {ICONS.chevDown}
        </button>
        <button
          className="dir"
          title={t(`filter.sort.${sort.key}${sort.desc ? 'Desc' : 'Asc'}`)}
          aria-label={t('inbox.sort.flipLabel', { now: t(`filter.sort.${sort.key}${sort.desc ? 'Desc' : 'Asc'}`) })}
          onClick={() => onSort({ ...sort, desc: !sort.desc })}
        >
          <SortIcon desc={sort.desc} />
        </button>
      </div>
      {filter.status && (
        <button className="fchip fx" aria-pressed="true" title={t('filter.remove')} onClick={() => onFilter({ ...filter, status: null })}>
          {t(`status.${filter.status}`)}{ICONS.x}
        </button>
      )}
      {filter.tags.map((tag) => (
        <button key={tag} className="fchip fx" aria-pressed="true" title={t('filter.remove')} onClick={() => toggleTag(tag)}>
          {tag}{ICONS.x}
        </button>
      ))}
      {n > 0 && <button className="fchip fplain" onClick={() => onFilter({ status: null, tags: [] })}>{t('filter.clear')}</button>}
      {sortMenu && (
        <ContextMenu x={sortMenu.x} y={sortMenu.y} onClose={() => setSortMenu(undefined)}>
          {LIBRARY_SORT_KEYS.map((k) => (
            <button key={k} role="menuitemradio" aria-checked={sort.key === k} onClick={() => (setSortMenu(undefined), sort.key !== k && onSort({ key: k, desc: k !== 'title' }))}>
              {t(`filter.sort.${k}`)}
              {sort.key === k && ICONS.check}
            </button>
          ))}
        </ContextMenu>
      )}
      {open && (
        <div className="fpanel">
          {status && (
            <section>
              <h3>{t('filter.status')}</h3>
              <div className="row">
                {STATUSES.map((s) => (
                  <button key={s} className="fchip" aria-pressed={filter.status === s} onClick={() => onFilter({ ...filter, status: filter.status === s ? null : s })}>
                    {t(`status.${s}`)}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3>{t('filter.tags')}</h3>
            <div className="row">{used.length ? used.map(tagChip) : <span className="muted small">{t('filter.noTags')}</span>}</div>
          </section>
          <section>
            <button className="fchip fplain lib-toggle" aria-expanded={libOpen} onClick={() => setLibOpen(!libOpen)}>
              {t('filter.library')}<span className="chev">{ICONS.chevDown}</span>
            </button>
            {libOpen && <TagLibrary all={all} myTags={myTags} onMyTags={onMyTags} onDeleteTag={onDeleteTag} />}
          </section>
        </div>
      )}
    </div>
  )
}

// 标签库：我的标签（可移出、可删自定义的）、加自定义标签、DLsite 分类索引（大类默认折叠，点词加入或移出我的标签）
function TagLibrary({ all, myTags, onMyTags, onDeleteTag }: Pick<Props, 'all' | 'myTags' | 'onMyTags' | 'onDeleteTag'>) {
  const { t } = useTranslation()
  const [cats, setCats] = useState(new Set<string>())
  const [del, setDel] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const mine = new Set(myTags.map((x) => x.toLowerCase()))
  const isMine = (tag: string) => mine.has(tag.toLowerCase())
  const toggle = (tag: string) => onMyTags(isMine(tag) ? myTags.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...myTags, tag])
  const add = () => {
    const name = draft.trim()
    if (name && !isMine(name)) onMyTags([...myTags, name])
    setDraft('')
  }
  return (
    <div className="taglib">
      <p className="lib-hint">{t('filter.libHint')}</p>
      <p className="lib-sec">{t('filter.mine')}</p>
      <div className="lchips">
        {myTags.map((tag) => {
          const custom = !inLibrary(tag)
          return (
            <span key={tag} className={custom ? 'lchip custom' : 'lchip'}>
              {tag}<span className="c num">{tagUseCount(all, tag)}</span>
              <button
                className="rm"
                aria-label={t(custom ? 'filter.deleteCustom' : 'filter.removeMine', { tag })}
                title={t(custom ? 'filter.deleteCustom' : 'filter.removeMine', { tag })}
                onClick={() => (custom ? setDel(tag) : toggle(tag))}
              >
                {ICONS.x}
              </button>
            </span>
          )
        })}
      </div>
      {del && (
        <div className="lib-confirm">
          <span className="grow">{t('filter.deleteConfirm', { tag: del, n: tagUseCount(all, del) })}</span>
          <button className="btn danger solid" onClick={() => onDeleteTag(del).then(() => setDel(null))}>{t('filter.delete')}</button>
          <button className="btn ghost" onClick={() => setDel(null)}>{t('common.cancel')}</button>
        </div>
      )}
      <form className="lib-add" onSubmit={(e) => (e.preventDefault(), add())}>
        <input className="input" value={draft} maxLength={64} placeholder={t('filter.customPlaceholder')} aria-label={t('filter.customPlaceholder')} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn" type="submit" disabled={!draft.trim()}>{ICONS.plus}{t('filter.add')}</button>
      </form>
      {CATEGORIES.map((c) => {
        const open = cats.has(c.name)
        const picked = c.tags.filter(isMine).length
        return (
          <div key={c.name} className="cat">
            <button className="cat-h" aria-expanded={open} onClick={() => setCats((s) => (s.delete(c.name) ? new Set(s) : new Set(s.add(c.name))))}>
              {c.name}
              <span className="n num">{picked ? t('filter.catPicked', { picked, n: c.tags.length }) : t('filter.catCount', { n: c.tags.length })}</span>
              <span className="chev">{ICONS.chevDown}</span>
            </button>
            {open && (
              <div className="lchips">
                {c.tags.map((tag) => {
                  const count = tagUseCount(all, tag)
                  return (
                    <button key={tag} className={count ? 'lchip' : 'lchip zero'} aria-pressed={isMine(tag)} title={t(isMine(tag) ? 'filter.removeMine' : 'filter.addMine', { tag })} onClick={() => toggle(tag)}>
                      {tag}<span className="c num">{count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
