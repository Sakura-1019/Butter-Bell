// 左侧导航：长按约 0.35 秒后可以上下拖动改顺序，短按还是跳转。顺序存进设置。
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { NavPage } from '../../core/library'
import { ICONS } from './icons'

const HOLD_MS = 350

interface Props {
  order: NavPage[]
  hidden: NavPage[] // 现在不显示的（没有已卸载的游戏时的“已卸载”），拖完后留在原来的位置
  current: string
  badges: Partial<Record<NavPage, number>>
  onGo: (p: NavPage) => void
  onReorder: (order: NavPage[]) => void
}

export default function NavList({ order, hidden, current, badges, onGo, onReorder }: Props) {
  const { t } = useTranslation()
  const list = useRef<HTMLDivElement>(null)
  const drag = useRef<{ el: HTMLElement; grab: number; timer?: number; startY: number; active: boolean; moved: boolean } | null>(null)

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    const d = { el, grab: 0, startY: e.clientY, active: false, moved: false, timer: 0 }
    d.timer = window.setTimeout(() => {
      d.active = true
      d.grab = d.startY - el.getBoundingClientRect().top
      el.setPointerCapture(e.pointerId)
      el.classList.add('dragging')
    }, HOLD_MS)
    drag.current = d
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) > 6) clearTimeout(d.timer), (drag.current = null)
      return
    }
    const box = list.current!
    const others = [...box.children].filter((c) => c !== d.el) as HTMLElement[]
    const before = others.find((c) => {
      const r = c.getBoundingClientRect()
      return e.clientY < r.top + r.height / 2
    })
    if (d.el.nextElementSibling !== (before ?? null)) {
      // 其他项滑到新位置（FLIP）
      const old = new Map(others.map((c) => [c, c.getBoundingClientRect().top]))
      box.insertBefore(d.el, before ?? null)
      d.moved = true
      for (const c of others) {
        const dy = old.get(c)! - c.getBoundingClientRect().top
        if (dy) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      }
    }
    d.el.style.transform = 'none'
    const top = d.el.getBoundingClientRect().top
    d.el.style.transform = `translateY(${e.clientY - d.grab - top}px) scale(1.03)`
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    clearTimeout(d.timer)
    if (!d.active) return
    e.preventDefault()
    d.el.classList.remove('dragging')
    d.el.style.transform = ''
    // 这次拖动结束后的点击不算跳转
    d.el.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true })
    if (!d.moved) return
    const shown = [...list.current!.children].map((c) => (c as HTMLElement).dataset.nav as NavPage)
    // React 会按新顺序重新排；先把 DOM 放回原样，免得和 React 的记录对不上
    const next = [...shown]
    for (const h of hidden) next.splice(Math.min(order.indexOf(h), next.length), 0, h)
    restore()
    onReorder(next)
  }
  // 拖动时直接挪过 DOM，交还给 React 前按原来的顺序摆回去
  const restore = () => {
    const box = list.current!
    const byKey = new Map([...box.children].map((c) => [(c as HTMLElement).dataset.nav, c]))
    for (const k of order) if (byKey.has(k)) box.appendChild(byKey.get(k)!)
  }

  return (
    <div className="navlist" ref={list}>
      {order
        .filter((k) => !hidden.includes(k))
        .map((k) => (
          <button
            key={k}
            data-nav={k}
            className="nav"
            aria-current={current === k}
            title={t('nav.dragHint')}
            onClick={() => onGo(k)}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {ICONS[k]}
            <span className="label">{t(`nav.${k}`)}</span>
            {badges[k] ? <span className="badge num">{badges[k]}</span> : null}
          </button>
        ))}
    </div>
  )
}
