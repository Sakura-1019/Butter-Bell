import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { InboxEntry, InboxState, Job, PostExtractAction } from '../../preload'
import { filterInbox, sortInbox, type InboxSort, type InboxSortKey } from '../../core/inbox-view'
import { ICONS } from './icons'
import Modal from './Modal'

type Archive = Extract<InboxEntry, { kind: 'archive' }>
type Folder = Extract<InboxEntry, { kind: 'folder' }>
type Group = Exclude<InboxEntry, Archive | Folder>
type Unit = Archive | Group | Folder

// 能勾选的单位：普通压缩包、已确认的同套、现成文件夹；同套建议还没决定，里面的包各自勾选
export const unitsOf = (entries: InboxEntry[]) =>
  entries.flatMap((e) => (e.kind === 'suggestion' ? e.members : [e]))
const keyOf = (u: Unit) => (u.kind === 'archive' ? `a${u.id}` : u.kind === 'folder' ? `f${u.id}` : u.id)
const idsOf = (u: Unit) => (u.kind === 'archive' ? [u.id] : u.kind === 'folder' ? [] : u.members.map((m) => m.id))
const namesOf = (list: Unit[]) => list.flatMap((u) => (u.kind === 'folder' ? [u.id] : []))
const sizeOf = (u: Unit) => (u.kind === 'folder' ? 0 : u.size)
const SORT_KEYS: InboxSortKey[] = ['modified', 'name', 'size', 'added']

export function useSize() {
  const { t } = useTranslation()
  return (bytes: number) => {
    const gb = bytes / 1024 ** 3
    return gb >= 1 ? t('size.gb', { n: gb.toFixed(2) }) : t('size.mb', { n: Math.max(1, Math.round(bytes / 1024 ** 2)) })
  }
}

// 下载时间（文件修改时间）：近的用文字（今天、昨天、3 天前），再早写月日，往年的带年份
function downloaded(t: TFunction, iso: string) {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(new Date()) - day(d)) / 86400000)
  if (days <= 0) return t('inbox.when.today')
  if (days === 1) return t('inbox.when.yesterday')
  if (days < 7) return t('inbox.when.daysAgo', { n: days })
  const md = { m: d.getMonth() + 1, d: d.getDate() }
  return d.getFullYear() === new Date().getFullYear() ? t('time.date', md) : t('time.dateYear', { y: d.getFullYear(), ...md })
}

// 点到行里的按钮、输入框、链接时不算点卡片（复选框除外，它就是用来勾选的）
const onControl = (e: MouseEvent) => !!(e.target as Element).closest('button:not(.check), input, select, a, label, .pwrow')

interface Props {
  state: InboxState
  onChange: (s: InboxState) => void
  jobs: Job[]
  onAdded: (ids: number[]) => void // 现成文件夹加进库后的游戏 id，接着补资料
  query: string // 工具栏的搜索词
  onClearQuery: () => void
  sort: InboxSort
  onSort: (s: InboxSort) => void
}

export default function Inbox({ state, onChange, jobs, onAdded, query, onClearQuery, sort, onSort }: Props) {
  const { t } = useTranslation()
  const size = useSize()
  const [selected, setSelected] = useState(new Set<string>())
  const [toast, setToast] = useState<{ ids: number[]; names: string[]; n: number }>()
  const timer = useRef<number>(undefined)
  const [asking, setAsking] = useState<Unit[]>() // 第一次解压：问压缩包怎么处理
  const [menu, setMenu] = useState<{ x: number; y: number; unit: Unit; targets: Unit[] }>()
  const [trashing, setTrashing] = useState<Unit[]>() // 移入回收站前的确认
  const [confirm, setConfirm] = useState<Unit>() // 双击弹出的确认框
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number }>() // 排序方式的菜单
  const anchor = useRef<string>(undefined) // Shift+点击的起点
  const before = useRef(selected) // 双击的第一下会切换勾选，双击时恢复成这之前的样子
  const jobOf = (u: Unit) => jobs.find((j) => j.key === keyOf(u))

  const view = filterInbox(sortInbox(state.entries, sort.key, sort.desc), query)
  const all = unitsOf(state.entries)
  const units = unitsOf(view) // 看得见的，按显示顺序
  const free = units.filter((u) => !jobOf(u)) // 正在解压的不能勾选
  const live = free.filter((u) => selected.has(keyOf(u)))
  const allState = live.length === 0 ? 'false' : live.length === free.length ? 'true' : 'mixed'
  const unselect = (list: Unit[]) => setSelected((s) => new Set([...s].filter((k) => !list.some((u) => keyOf(u) === k))))

  // 点卡片任意位置切换勾选；Shift+点击把上次点的到这次点的之间都设成和这一行一样
  const click = (u: Unit, e: MouseEvent) => {
    if (jobOf(u) || onControl(e) || e.detail >= 2) return // 双击的第二下不切换
    before.current = selected
    const k = keyOf(u)
    const on = !selected.has(k)
    const from = anchor.current ? free.findIndex((x) => keyOf(x) === anchor.current) : -1
    const to = free.findIndex((x) => keyOf(x) === k)
    const range = e.shiftKey && from >= 0 ? free.slice(Math.min(from, to), Math.max(from, to) + 1).map(keyOf) : [k]
    setSelected((s) => {
      const n = new Set(s)
      for (const r of range) on ? n.add(r) : n.delete(r)
      return n
    })
    if (!e.shiftKey) anchor.current = k
  }
  const doubleClick = (u: Unit, e: MouseEvent) => {
    if (jobOf(u) || onControl(e)) return
    setSelected(before.current)
    setConfirm(u)
  }
  // 右键没勾选的卡片只对它自己；右键已勾选的，对所有勾选的（和资源管理器一样）
  const contextMenu = (u: Unit, e: MouseEvent) => {
    if (jobOf(u) || onControl(e)) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, unit: u, targets: selected.has(keyOf(u)) ? live : [u] })
  }

  const doIgnore = async (list: Unit[]) => {
    const ids = list.flatMap(idsOf)
    const names = namesOf(list)
    if (ids.length) onChange(await window.api.inbox.ignore(ids, true))
    if (names.length) onChange(await window.api.inbox.ignoreFolders(names, true))
    unselect(list)
    setToast({ ids, names, n: list.length })
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(undefined), 6000)
  }
  const startExtract = async (list: Unit[], action?: PostExtractAction, remember?: boolean) => {
    const archives = list.filter((u) => u.kind !== 'folder')
    if (await window.api.extract.start(archives.map((u) => ({ key: keyOf(u), ids: idsOf(u) })), action, remember)) unselect(archives)
  }
  // 解压勾选的（或右键菜单里的）：现成文件夹不用解压，直接加进库
  const run = async (list: Unit[]) => {
    const names = namesOf(list)
    if (names.length) {
      const r = await window.api.inbox.addFolders(names)
      onChange(r.state)
      onAdded(r.ids)
      unselect(list.filter((u) => u.kind === 'folder'))
    }
    if (list.some((u) => u.kind !== 'folder')) (await window.api.extract.postAction()) ? startExtract(list) : setAsking(list)
  }

  const undo = async () => {
    if (!toast) return
    setToast(undefined)
    if (toast.ids.length) onChange(await window.api.inbox.ignore(toast.ids, false))
    if (toast.names.length) onChange(await window.api.inbox.ignoreFolders(toast.names, false))
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!state.dir) {
    return (
      <div className="empty-state">
        <p>{t('inbox.noDir')}</p>
        <button className="btn primary" onClick={async () => onChange(await window.api.inbox.chooseDir())}>
          {ICONS.folder}
          {t('inbox.chooseDir')}
        </button>
      </div>
    )
  }

  const row = (u: Unit) => (
    <Row
      key={keyOf(u)}
      unit={u}
      checked={selected.has(keyOf(u))}
      job={jobOf(u)}
      onClick={(e) => click(u, e)}
      onDoubleClick={(e) => doubleClick(u, e)}
      onContextMenu={(e) => contextMenu(u, e)}
      onIgnore={() => doIgnore([u])}
    />
  )
  const extractLabel = (list: Unit[]) => (list.length && list.every((u) => u.kind === 'folder') ? t('inbox.addFolders') : t('inbox.extract'))

  return (
    <>
      <div className="inbox-bar">
        <button
          className="check"
          role="checkbox"
          aria-checked={allState}
          aria-label={t('inbox.selectAll')}
          disabled={!free.length}
          onClick={() => setSelected(allState === 'true' ? new Set() : new Set(free.map(keyOf)))}
        >
          {ICONS.check}
        </button>
        <span className="sel num">
          {live.length
            ? t('inbox.selected', { count: live.length })
            : t('inbox.summary', { count: all.length, size: size(all.reduce((s, u) => s + sizeOf(u), 0)) })}
        </span>
        {/* 排序：和游戏库工具栏的视图切换同一种胶囊。左边是方式（点开的菜单沿用右键菜单的样式），右边是正序 / 倒序图标 */}
        <div className="sortseg" role="group" aria-label={t('inbox.sort.label')}>
          <button
            aria-haspopup="menu"
            aria-expanded={!!sortMenu}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setSortMenu(sortMenu ? undefined : { x: r.left - 3, y: r.bottom + 6 })
            }}
          >
            {t(`inbox.sort.${sort.key}`)}
            {ICONS.chevDown}
          </button>
          <button
            className="dir"
            title={t(`inbox.sort.${sort.key}${sort.desc ? 'Desc' : 'Asc'}`)}
            aria-label={t('inbox.sort.flipLabel', { now: t(`inbox.sort.${sort.key}${sort.desc ? 'Desc' : 'Asc'}`) })}
            onClick={() => onSort({ key: sort.key, desc: !sort.desc })}
          >
            <SortIcon desc={sort.desc} />
          </button>
        </div>
        <button className="btn ghost" title={state.dir} onClick={async () => onChange(await window.api.inbox.scan())}>
          {ICONS.refresh}
          {t('inbox.rescan')}
        </button>
        {live.length > 0 && (
          <button className="btn ghost" onClick={() => doIgnore(live)}>
            {t('inbox.ignoreSelected', { count: live.length })}
          </button>
        )}
        <button className="btn primary" disabled={!live.length} onClick={() => run(live)}>
          {extractLabel(live)}
        </button>
      </div>

      {!state.entries.length && (
        <div className="empty-state">
          <p>{t('inbox.empty', { dir: state.dir })}</p>
        </div>
      )}
      {state.entries.length > 0 && !view.length && (
        <div className="empty-state">
          <p>{t('library.noMatch', { q: query.trim() })}</p>
          <button className="btn" onClick={onClearQuery}>{t('library.clearSearch')}</button>
        </div>
      )}

      {view.map((e) =>
        e.kind === 'suggestion' ? (
          <div className="setbox" key={e.id}>
            <div className="hd">
              <div className="ic">{ICONS.layers}</div>
              <div className="txt">
                <strong>{t('inbox.suggestion.title', { count: e.members.length })}</strong>
                <small>{t('inbox.suggestion.hint', { name: e.name })}</small>
              </div>
              <button className="btn ghost" onClick={async () => onChange(await window.api.inbox.reject(idsOf(e)))}>
                {t('inbox.suggestion.reject')}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  unselect(e.members)
                  onChange(await window.api.inbox.merge(idsOf(e)))
                }}
              >
                {t('inbox.suggestion.merge')}
              </button>
            </div>
            {e.members.map(row)}
          </div>
        ) : (
          row(e)
        )
      )}

      {sortMenu && (
        <ContextMenu x={sortMenu.x} y={sortMenu.y} onClose={() => setSortMenu(undefined)}>
          {SORT_KEYS.map((k) => (
            <button key={k} role="menuitemradio" aria-checked={sort.key === k} onClick={() => (setSortMenu(undefined), sort.key !== k && onSort({ key: k, desc: k !== 'name' }))}>
              {t(`inbox.sort.${k}`)}
              {sort.key === k && ICONS.check}
            </button>
          ))}
        </ContextMenu>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(undefined)}>
          <button role="menuitem" onClick={() => (setMenu(undefined), run(menu.targets))}>
            {t(`inbox.menu.${menu.targets.every((u) => u.kind === 'folder') ? 'add' : 'extract'}${menu.targets.length > 1 ? 'N' : ''}`, { count: menu.targets.length })}
          </button>
          {menu.targets.some((u) => u.kind !== 'folder') && (
            <button role="menuitem" onClick={() => (setMenu(undefined), setTrashing(menu.targets.filter((u) => u.kind !== 'folder')))}>
              {t('inbox.menu.trash', { count: menu.targets.filter((u) => u.kind !== 'folder').length })}
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setMenu(undefined)
              const u = menu.unit
              window.api.inbox.reveal(u.kind === 'folder' ? 'folder' : 'archive', u.kind === 'folder' ? u.id : idsOf(u)[0])
            }}
          >
            {t('inbox.menu.reveal')}
          </button>
        </ContextMenu>
      )}

      {trashing && (
        <Modal title={t('inbox.trash.title', { count: trashing.length })} onClose={() => setTrashing(undefined)}>
          <p>{t('inbox.trash.hint')}</p>
          <ul className="namelist">
            {trashing.flatMap((u) => (u.kind === 'archive' ? [u] : u.kind === 'folder' ? [] : u.members)).map((a) => (
              <li key={a.id}>
                {a.name}
                {a.volumes.length > 1 && <small className="muted"> · {t('inbox.volumes', { count: a.volumes.length })}</small>}
              </li>
            ))}
          </ul>
          <div className="foot">
            <span className="grow" />
            <button className="btn ghost" onClick={() => setTrashing(undefined)}>{t('common.cancel')}</button>
            <button
              className="btn danger solid"
              onClick={async () => {
                const list = trashing
                setTrashing(undefined)
                unselect(list)
                onChange(await window.api.inbox.trash(list.flatMap(idsOf)))
              }}
            >
              {t('inbox.trash.go')}
            </button>
          </div>
        </Modal>
      )}

      {confirm &&
        (confirm.kind === 'folder' ? (
          <Modal title={t('inbox.confirm.folderTitle')} onClose={() => setConfirm(undefined)}>
            <p>{t('inbox.confirm.folderHint', { name: confirm.name })}</p>
            <div className="foot">
              <span className="grow" />
              <button className="btn ghost" onClick={() => setConfirm(undefined)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={() => (setConfirm(undefined), run([confirm]))}>{t('inbox.addFolders')}</button>
            </div>
          </Modal>
        ) : (
          <ExtractDialog unit={confirm} onClose={() => setConfirm(undefined)} />
        ))}

      {asking && (
        <PostActionDialog
          dir={state.dir}
          onCancel={() => setAsking(undefined)}
          onGo={(a, remember) => {
            const list = asking
            setAsking(undefined)
            startExtract(list, a, remember)
          }}
        />
      )}

      {toast && (
        <div className="toasts">
          <div className="toast">
            {t('inbox.ignored', { count: toast.n })}
            <button className="toast-act" onClick={undo}>
              {t('inbox.undo')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// 右键菜单：点外面、按 Esc、滚动、窗口失焦都关掉；靠近窗口边缘时往里挪
function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const el = ref.current
    if (el) setPos({ x: Math.min(x, window.innerWidth - el.offsetWidth - 8), y: Math.min(y, window.innerHeight - el.offsetHeight - 8) })
    el?.querySelector('button')?.focus()
    const close = (e: Event) => !(e.type === 'mousedown' && el?.contains(e.target as Node)) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', key)
      document.removeEventListener('scroll', close, true)
    }
  }, [x, y, onClose])
  return (
    <div ref={ref} className="ctxmenu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  )
}

// 双击压缩包：这一次单独设密码、解压位置、解压后怎么处理，只对这一次有效
function ExtractDialog({ unit, onClose }: { unit: Archive | Group; onClose: () => void }) {
  const { t } = useTranslation()
  const [lib, setLib] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [savePw, setSavePw] = useState(true)
  const [target, setTarget] = useState<string>() // 没选 = 游戏目录
  const [action, setAction] = useState<PostExtractAction>('move')
  const [makeDefault, setMakeDefault] = useState(false)
  useEffect(() => {
    window.api.settings.get().then((s) => {
      setLib(s.libraryDir)
      if (s.postExtractAction) setAction(s.postExtractAction)
    })
  }, [])
  const go = async () => {
    const ok = await window.api.extract.start(
      [{ key: keyOf(unit), ids: idsOf(unit), password: password || undefined, save: savePw, target, action }],
      action,
      makeDefault
    )
    if (ok) onClose()
  }
  return (
    <Modal title={t('inbox.confirm.title', { name: unit.name })} onClose={onClose}>
      <div className="xform">
        <label className="field">
          <span>{t('inbox.confirm.password')}</span>
          <input className="input" type="password" value={password} placeholder={t('inbox.confirm.passwordHint')} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </label>
        {password && (
          <label className="remember">
            <button className="check" role="checkbox" aria-checked={savePw} onClick={() => setSavePw(!savePw)}>{ICONS.check}</button>
            {t('extract.savePw')}
          </label>
        )}
        <div className="field">
          <span>{t('inbox.confirm.target')}</span>
          <div className="pathrow">
            <span className="path" title={target ?? lib ?? ''}>{target ?? lib ?? t('inbox.confirm.targetUnset')}</span>
            {target && <button className="linkbtn" onClick={() => setTarget(undefined)}>{t('inbox.confirm.targetReset')}</button>}
            <button className="linkbtn" onClick={async () => setTarget((await window.api.extract.chooseTarget()) ?? target)}>{t('inbox.confirm.targetChange')}</button>
          </div>
        </div>
        <div className="field">
          <span>{t('post.title')}</span>
          <div className="seg" role="radiogroup" aria-label={t('post.title')}>
            {(['keep', 'recycle', 'move'] as const).map((k) => (
              <button key={k} role="radio" aria-checked={action === k} aria-pressed={action === k} onClick={() => setAction(k)}>{t(`post.${k}`)}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="foot">
        <label>
          <button className="check" role="checkbox" aria-checked={makeDefault} onClick={() => setMakeDefault(!makeDefault)}>{ICONS.check}</button>
          {t('inbox.confirm.makeDefault')}
        </label>
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" onClick={go}>{t('post.go')}</button>
      </div>
    </Modal>
  )
}

interface RowProps {
  unit: Unit
  checked: boolean
  job?: Job
  onClick: (e: MouseEvent) => void
  onDoubleClick: (e: MouseEvent) => void
  onContextMenu: (e: MouseEvent) => void
  onIgnore: () => void
}

function Row({ unit, checked, job, onClick, onDoubleClick, onContextMenu, onIgnore }: RowProps) {
  const { t } = useTranslation()
  const size = useSize()
  const [open, setOpen] = useState(false)
  const handlers = { onClick, onDoubleClick, onContextMenu, onMouseDown: (e: MouseEvent) => e.shiftKey && e.preventDefault() } // Shift+点击不要选中文字
  const cls = (base: string) => `${base}${checked && !job ? ' on' : ''}${job ? '' : ' pick'}`
  if (unit.kind === 'folder')
    return (
      <div className={cls('arch')} {...handlers}>
        <button className="check" role="checkbox" aria-checked={checked} aria-label={t('inbox.select', { name: unit.name })}>
          {ICONS.check}
        </button>
        <div className="ic">{ICONS.folder}</div>
        <div className="body">
          <div className="fn" title={unit.name}>{unit.name}</div>
          <div className="mt">{t('inbox.folder')}</div>
        </div>
        {/* 现成文件夹不是下载来的包：没有大小和下载时间，写成灰色短横 */}
        <span className="col size num dash">—</span>
        <span className="col date num dash">—</span>
        <div className="act">
          <button className="linkbtn side-act" onClick={onIgnore}>{t('inbox.ignore')}</button>
        </div>
      </div>
    )
  const isGroup = unit.kind !== 'archive'
  const parts = isGroup ? unit.members.map((m) => m.volumes[0]) : unit.volumes
  const expandable = isGroup || unit.volumes.length > 1
  const format = isGroup ? [...new Set(unit.members.map((m) => m.format))].join(' / ') : unit.format
  const missing = isGroup ? [] : unit.missing
  const modified = isGroup ? unit.members.map((m) => m.modifiedAt).sort().at(-1)! : unit.modifiedAt // 同套取最新的成员

  return (
    <div className={cls(job?.state === 'password' || job?.state === 'failed' ? 'arch err' : 'arch')} {...handlers}>
      <button className="check" role="checkbox" aria-checked={checked && !job} aria-label={t('inbox.select', { name: unit.name })} disabled={!!job}>
        {ICONS.check}
      </button>
      <div className="ic">{isGroup ? ICONS.layers : ICONS.archive}</div>
      <div className="body">
        <div className="fn" title={unit.name}>{unit.name}</div>
        <div className="mt">
          <span>{format.toUpperCase()}</span>
          {expandable && (
            <>
              <span className="sep">·</span>
              <button className="expand" aria-expanded={open} onClick={() => setOpen(!open)}>
                {isGroup ? t('inbox.bundleOf', { count: parts.length }) : t('inbox.volumes', { count: parts.length })}
                {ICONS.chevDown}
              </button>
            </>
          )}
          {!isGroup && unit.reattach && (
            <>
              <span className="sep">·</span>
              <span>{t('inbox.reattach', { title: unit.reattach })}</span>
            </>
          )}
          {missing.length > 0 && (
            <>
              <span className="sep">·</span>
              <span className="warn">{t('inbox.missing', { list: missing.join(t('inbox.listSep')) })}</span>
            </>
          )}
        </div>
        {open && (
          <ul className="parts">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {job?.state === 'password' && <PasswordRow job={job} />}
        {job?.state === 'failed' && (
          <div className="mt">
            <span className="warn">{job.reason === 'disk-full' && job.need ? t('extract.fail.disk-need', { need: size(job.need), free: size(job.free ?? 0) }) : t(`extract.fail.${job.reason}`, { detail: job.detail })}</span>
          </div>
        )}
      </div>
      {/* 大小、下载时间在右侧右对齐，按它们排序时一眼能扫下来；“忽略”紧跟在后面 */}
      <span className="col size num">{size(unit.size)}</span>
      {job ? (
        // 解压中 / 失败：进度或“重试 / 先不解压”占掉下载时间和操作两栏，大小照样对齐
        <div className="act wide">
          <JobSide job={job} />
        </div>
      ) : (
        <>
          <span className="col date num" title={new Date(modified).toLocaleString()}>{downloaded(t, modified)}</span>
          <div className="act">
            <button className="linkbtn side-act" onClick={onIgnore}>
              {t('inbox.ignore')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// 行右侧：排队中 / 解压进度 / 失败后的操作
function JobSide({ job }: { job: Job }) {
  const { t } = useTranslation()
  const cancel = () => window.api.extract.cancel(job.key)
  if (job.state === 'failed')
    return (
      <div className="side side-line">
        {/* 不支持、不是压缩包的，重试也没用 */}
        {job.reason !== 'unsupported' && job.reason !== 'not-archive' && (
          <button className="linkbtn" onClick={() => window.api.extract.retry(job.key)}>{t('extract.retry')}</button>
        )}
        <button className="linkbtn" onClick={cancel}>{t('extract.dismiss')}</button>
      </div>
    )
  if (job.state === 'password')
    return (
      <div className="side">
        <button className="linkbtn" onClick={cancel}>{t('extract.dismiss')}</button>
      </div>
    )
  return (
    <div className="side num">
      <div className="side-line">
        {job.state === 'queued' ? t('extract.queued') : t('extract.running', { pct: job.pct })}
        <button className="linkbtn" onClick={cancel}>{t('extract.cancel')}</button>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={job.pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${job.pct}%` }} />
      </div>
    </div>
  )
}

// 常用密码都不对：在这一行里直接输入密码
function PasswordRow({ job }: { job: Job }) {
  const { t } = useTranslation()
  const [pw, setPw] = useState('')
  const [save, setSave] = useState(true)
  const go = () => pw && window.api.extract.retry(job.key, pw, save)
  return (
    <>
      <div className="mt">
        <span className="warn">{t('extract.fail.wrong-password')}</span>
      </div>
      <div className="pwrow">
        <input
          className="input"
          type="password"
          value={pw}
          placeholder={t('extract.pwPlaceholder')}
          aria-label={t('extract.pwPlaceholder')}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <button className="btn primary" disabled={!pw} onClick={go}>{t('extract.go')}</button>
        <label className="remember">
          <button className="check" role="checkbox" aria-checked={save} onClick={() => setSave(!save)}>{ICONS.check}</button>
          {t('extract.savePw')}
        </label>
      </div>
    </>
  )
}

// 第一次解压时问：解压完以后压缩包怎么处理
function PostActionDialog({ dir, onCancel, onGo }: { dir: string; onCancel: () => void; onGo: (a: PostExtractAction, remember: boolean) => void }) {
  const { t } = useTranslation()
  const [choice, setChoice] = useState<PostExtractAction>('move')
  const [remember, setRemember] = useState(true)
  const sub = { keep: t('post.keepHint', { dir }), recycle: t('post.recycleHint'), move: `${dir}\\${t('post.extractedDir')}` }
  return (
    <Modal onClose={onCancel} title={t('post.title')}>
      <p>{t('post.hint')}</p>
      <div role="radiogroup">
        {(['keep', 'recycle', 'move'] as const).map((k) => (
          <button key={k} className="opt" role="radio" aria-checked={choice === k} onClick={() => setChoice(k)}>
            <span className="radio" />
            <span>
              <b>{t(`post.${k}`)}</b>
              <small>{sub[k]}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="foot">
        <label>
          <button className="check" role="checkbox" aria-checked={remember} onClick={() => setRemember(!remember)}>{ICONS.check}</button>
          {t('post.remember')}
        </label>
        <button className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn primary" onClick={() => onGo(choice, remember)}>{t('post.go')}</button>
      </div>
    </Modal>
  )
}

// 正序 / 倒序：上下两支半箭头（斜杠朝外、拉长，免得像数字 1），现在用的方向亮，另一支淡
function SortIcon({ desc }: { desc: boolean }) {
  return (
    <svg className="i sorti" viewBox="0 0 24 24" aria-hidden="true">
      <path className={desc ? 'off' : undefined} d="M8 20V4L3 9" />
      <path className={desc ? undefined : 'off'} d="M16 4v16l5-5" />
    </svg>
  )
}
