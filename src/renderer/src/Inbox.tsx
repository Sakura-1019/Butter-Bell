import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InboxEntry, InboxState, Job, PostExtractAction } from '../../preload'
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

export function useSize() {
  const { t } = useTranslation()
  return (bytes: number) => {
    const gb = bytes / 1024 ** 3
    return gb >= 1 ? t('size.gb', { n: gb.toFixed(2) }) : t('size.mb', { n: Math.max(1, Math.round(bytes / 1024 ** 2)) })
  }
}

// onAdded：现成文件夹加进库后的游戏 id，接着补资料
export default function Inbox({ state, onChange, jobs, onAdded }: { state: InboxState; onChange: (s: InboxState) => void; jobs: Job[]; onAdded: (ids: number[]) => void }) {
  const { t } = useTranslation()
  const size = useSize()
  const [selected, setSelected] = useState(new Set<string>())
  const [toast, setToast] = useState<{ ids: number[]; names: string[]; n: number }>()
  const timer = useRef<number>(undefined)
  const [asking, setAsking] = useState(false) // 第一次解压：问压缩包怎么处理
  const jobOf = (u: Unit) => jobs.find((j) => j.key === keyOf(u))

  const units = unitsOf(state.entries)
  const live = units.filter((u) => selected.has(keyOf(u)) && !jobOf(u))
  const all = live.length === 0 ? 'false' : live.length === units.length ? 'true' : 'mixed'

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (!n.delete(k)) n.add(k)
      return n
    })

  const doIgnore = async (list: Unit[]) => {
    const ids = list.flatMap(idsOf)
    const names = namesOf(list)
    if (ids.length) onChange(await window.api.inbox.ignore(ids, true))
    if (names.length) onChange(await window.api.inbox.ignoreFolders(names, true))
    setSelected((s) => new Set([...s].filter((k) => !list.some((u) => keyOf(u) === k))))
    setToast({ ids, names, n: list.length })
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(undefined), 6000)
  }
  const archives = live.filter((u) => u.kind !== 'folder')
  const startExtract = async (action?: PostExtractAction, remember?: boolean) => {
    const list = archives.map((u) => ({ key: keyOf(u), ids: idsOf(u) }))
    if (await window.api.extract.start(list, action, remember)) setSelected(new Set())
  }
  const onExtract = async () => {
    // 现成文件夹不用解压，直接加进库
    const names = namesOf(live)
    if (names.length) {
      const r = await window.api.inbox.addFolders(names)
      onChange(r.state)
      onAdded(r.ids)
      setSelected((s) => new Set([...s].filter((k) => !names.some((n) => k === `f${n}`))))
    }
    if (archives.length) (await window.api.extract.postAction()) ? startExtract() : setAsking(true)
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
      onCheck={() => toggle(keyOf(u))}
      onIgnore={() => doIgnore([u])}
    />
  )

  return (
    <>
      <div className="inbox-bar">
        <button
          className="check"
          role="checkbox"
          aria-checked={all}
          aria-label={t('inbox.selectAll')}
          disabled={!units.length}
          onClick={() => setSelected(all === 'true' ? new Set() : new Set(units.map(keyOf)))}
        >
          {ICONS.check}
        </button>
        <span className="sel num">
          {live.length
            ? t('inbox.selected', { count: live.length })
            : t('inbox.summary', { count: units.length, size: size(units.reduce((s, u) => s + sizeOf(u), 0)) })}
        </span>
        <button className="btn ghost" title={state.dir} onClick={async () => onChange(await window.api.inbox.scan())}>
          {ICONS.refresh}
          {t('inbox.rescan')}
        </button>
        {live.length > 0 && (
          <button className="btn ghost" onClick={() => doIgnore(live)}>
            {t('inbox.ignoreSelected', { count: live.length })}
          </button>
        )}
        <button className="btn primary" disabled={!live.length} onClick={onExtract}>
          {live.length && !archives.length ? t('inbox.addFolders') : t('inbox.extract')}
        </button>
      </div>

      {!state.entries.length && (
        <div className="empty-state">
          <p>{t('inbox.empty', { dir: state.dir })}</p>
        </div>
      )}

      {state.entries.map((e) =>
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
                  setSelected((s) => new Set([...s].filter((k) => !e.members.some((m) => keyOf(m) === k))))
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

      {asking && (
        <PostActionDialog
          dir={state.dir}
          onCancel={() => setAsking(false)}
          onGo={(a, remember) => {
            setAsking(false)
            startExtract(a, remember)
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

function Row({ unit, checked, job, onCheck, onIgnore }: { unit: Unit; checked: boolean; job?: Job; onCheck: () => void; onIgnore: () => void }) {
  const { t } = useTranslation()
  const size = useSize()
  const [open, setOpen] = useState(false)
  if (unit.kind === 'folder')
    return (
      <div className="arch">
        <button className="check" role="checkbox" aria-checked={checked} aria-label={t('inbox.select', { name: unit.name })} onClick={onCheck}>
          {ICONS.check}
        </button>
        <div className="ic">{ICONS.folder}</div>
        <div className="body">
          <div className="fn" title={unit.name}>{unit.name}</div>
          <div className="mt">{t('inbox.folder')}</div>
        </div>
        <button className="linkbtn side-act" onClick={onIgnore}>{t('inbox.ignore')}</button>
      </div>
    )
  const isGroup = unit.kind !== 'archive'
  const parts = isGroup ? unit.members.map((m) => m.volumes[0]) : unit.volumes
  const expandable = isGroup || unit.volumes.length > 1
  const format = isGroup ? [...new Set(unit.members.map((m) => m.format))].join(' / ') : unit.format
  const missing = isGroup ? [] : unit.missing

  return (
    <div className={job?.state === 'password' || job?.state === 'failed' ? 'arch err' : 'arch'}>
      <button className="check" role="checkbox" aria-checked={checked && !job} aria-label={t('inbox.select', { name: unit.name })} disabled={!!job} onClick={onCheck}>
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
          <span className="sep">·</span>
          <span className="num">{size(unit.size)}</span>
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
      {job ? (
        <JobSide job={job} />
      ) : (
        <button className="linkbtn side-act" onClick={onIgnore}>
          {t('inbox.ignore')}
        </button>
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
