// 设置页：目录、解压后处理、常用密码、被忽略的条目、Locale Emulator、外观和语言、更新。路径都用系统对话框选。
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommonPassword, InboxState, Settings as S, UpdateState } from '../../preload'
import { LANGUAGES } from './i18n'
import { ICONS } from './icons'
import { useSize } from './Inbox'

export default function Settings({ s, onChange, onInbox, update, onUpdate }: {
  s: S
  onChange: (s: S) => void
  onInbox: (i: InboxState) => void
  update?: UpdateState
  onUpdate: (u: UpdateState) => void
}) {
  const { t, i18n } = useTranslation()
  const set = (key: Parameters<typeof window.api.settings.set>[0], v: unknown) => window.api.settings.set(key, v).then(onChange)
  const choose = (key: Parameters<typeof window.api.settings.choose>[0]) => window.api.settings.choose(key).then(onChange)
  const path = (label: string, hint: string, value: string | null, key: 'archive_dir' | 'library_dir' | 'locale_emulator_path') => (
    <div className="rowline">
      <div className="lbl">{label}<small title={value ?? undefined}>{value ?? hint}</small></div>
      {key === 'locale_emulator_path' && value && <button className="linkbtn" onClick={() => set(key, null)}>{t('settings.clear')}</button>}
      <button className="btn" onClick={() => choose(key)}>{value ? t('settings.change') : t('settings.choose')}</button>
    </div>
  )
  const seg = <V extends string>(label: string, values: readonly V[], current: V, text: (v: V) => string, pick: (v: V) => void, hint?: string) => (
    <div className="rowline">
      <div className="lbl">{label}{hint && <small>{hint}</small>}</div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {values.map((v) => <button key={v} role="radio" aria-checked={current === v} aria-pressed={current === v} onClick={() => pick(v)}>{text(v)}</button>)}
      </div>
    </div>
  )
  return (
    <div className="settings">
      <section>
        <h2>{t('settings.dirs')}</h2>
        {path(t('settings.archiveDir'), t('settings.archiveDirHint'), s.archiveDir, 'archive_dir')}
        {path(t('settings.libraryDir'), t('settings.libraryDirHint'), s.libraryDir, 'library_dir')}
        {seg(t('settings.post'), ['ask', 'keep', 'recycle', 'move'] as const, s.postExtractAction ?? 'ask',
          (v) => (v === 'ask' ? t('settings.postAsk') : t(`post.${v}`)), (v) => set('post_extract_action', v === 'ask' ? null : v))}
      </section>
      <Passwords />
      <Ignored onInbox={onInbox} />
      <section>
        <h2>{t('settings.le')}</h2>
        <p className="muted small">{t('settings.leHint')}</p>
        {path(t('settings.lePath'), t('settings.notSet'), s.localeEmulatorPath, 'locale_emulator_path')}
      </section>
      <section>
        <h2>{t('settings.look')}</h2>
        {seg(t('settings.theme'), ['system', 'light', 'dark'] as const, s.theme, (v) => t(`settings.themes.${v}`), (v) => set('theme', v))}
        {seg(t('settings.language'), Object.keys(LANGUAGES), s.language, (v) => LANGUAGES[v].name, (v) => (i18n.changeLanguage(v), set('language', v)), t('settings.languageHint'))}
        <div className="rowline">
          <div className="lbl">{t('settings.privacyOnStart')}<small>{t('settings.privacyOnStartHint')}</small></div>
          <button className="switch" role="switch" aria-checked={s.privacyOnStart} aria-label={t('settings.privacyOnStart')} onClick={() => set('privacy_on_start', !s.privacyOnStart)} />
        </div>
      </section>
      {update && <Updates u={update} onUpdate={onUpdate} enabled={s.checkUpdates} onEnabled={(v) => set('check_updates', v)} />}
    </div>
  )
}

// 当前版本、现在检查、启动时检查的开关。没配置仓库的版本两样都用不了
function Updates({ u, onUpdate, enabled, onEnabled }: { u: UpdateState; onUpdate: (u: UpdateState) => void; enabled: boolean; onEnabled: (v: boolean) => void }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'idle' | 'checking' | 'done' | 'failed'>('idle')
  const check = async () => {
    setStatus('checking')
    try {
      onUpdate(await window.api.update.check())
      setStatus('done')
    } catch {
      setStatus('failed')
    }
  }
  const line = !u.configured ? t('update.notConfigured')
    : status === 'checking' ? t('update.checking')
    : status === 'failed' ? t('update.failed')
    : u.latest ? t('update.available', { v: u.latest.version })
    : status === 'done' ? t('update.upToDate') : ''
  return (
    <section>
      <h2>{t('update.title')}</h2>
      <div className="rowline">
        <div className="lbl">{t('update.current', { v: u.current })}{line && <small>{line}</small>}</div>
        {u.latest && <button className="btn" onClick={() => window.api.update.open()}>{t('update.download')}</button>}
        <button className="btn" disabled={!u.configured || status === 'checking'} onClick={check}>{t('update.check')}</button>
      </div>
      <div className="rowline">
        <div className="lbl">{t('update.onStart')}<small>{t('update.onStartHint')}</small></div>
        <button className="switch" role="switch" disabled={!u.configured} aria-checked={u.configured && enabled} aria-label={t('update.onStart')} onClick={() => onEnabled(!enabled)} />
      </div>
    </section>
  )
}

// 常用密码表：默认遮住，可以显示；增删、上下挪。解压时按这个顺序试
function Passwords() {
  const { t } = useTranslation()
  const [list, setList] = useState<CommonPassword[]>()
  const [show, setShow] = useState(false)
  const [draft, setDraft] = useState('')
  useEffect(() => void window.api.passwords.list().then(setList), [])
  const add = async () => {
    if (!draft.trim()) return
    setList(await window.api.passwords.add(draft))
    setDraft('')
  }
  const move = async (i: number, d: -1 | 1) => {
    const ids = list!.map((p) => p.id)
    ;[ids[i], ids[i + d]] = [ids[i + d], ids[i]]
    setList(await window.api.passwords.reorder(ids))
  }
  return (
    <section>
      <div className="sec-head">
        <h2>{t('settings.passwords')}</h2>
        {!!list?.length && (
          <button className="linkbtn" aria-pressed={show} onClick={() => setShow(!show)}>
            {show ? ICONS.eyeOff : ICONS.eye}{show ? t('settings.hidePw') : t('settings.showPw')}
          </button>
        )}
      </div>
      <p className="muted small">{t('settings.passwordsHint')}</p>
      {list?.map((p, i) => (
        <div className="rowline pw" key={p.id}>
          <span className="pw-n num">{i + 1}</span>
          <div className="lbl">
            {p.password === null ? <span className="warn">{t('settings.pwBroken')}</span> : <span className="pw-text">{show ? p.password : '•'.repeat(8)}</span>}
          </div>
          <button className="iconbtn plain" disabled={i === 0} aria-label={t('settings.moveUp')} title={t('settings.moveUp')} onClick={() => move(i, -1)}>{ICONS.chevUp}</button>
          <button className="iconbtn plain" disabled={i === list.length - 1} aria-label={t('settings.moveDown')} title={t('settings.moveDown')} onClick={() => move(i, 1)}>{ICONS.chevDown}</button>
          <button className="linkbtn" onClick={async () => setList(await window.api.passwords.remove(p.id))}>{t('settings.remove')}</button>
        </div>
      ))}
      <form className="rowline pw-add" onSubmit={(e) => (e.preventDefault(), add())}>
        <input
          className="input grow"
          type={show ? 'text' : 'password'}
          value={draft}
          placeholder={t('settings.pwPlaceholder')}
          aria-label={t('settings.pwPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn" disabled={!draft.trim()}>{ICONS.plus}{t('settings.add')}</button>
      </form>
    </section>
  )
}

// 被忽略的压缩包和现成文件夹：恢复后回到收件箱
function Ignored({ onInbox }: { onInbox: (i: InboxState) => void }) {
  const { t } = useTranslation()
  const size = useSize()
  const [list, setList] = useState<Awaited<ReturnType<typeof window.api.inbox.ignored>>>()
  const load = () => window.api.inbox.ignored().then(setList)
  useEffect(() => void load(), [])
  const restore = async (r: Promise<InboxState>) => (onInbox(await r), load())
  const empty = list && !list.archives.length && !list.folders.length
  return (
    <section>
      <h2>{t('settings.ignored')}</h2>
      <p className="muted small">{empty ? t('settings.ignoredEmpty') : t('settings.ignoredHint')}</p>
      {list?.folders.map((name) => (
        <div className="rowline" key={`f${name}`}>
          <div className="lbl">{name}<small>{t('settings.ignoredFolder')}</small></div>
          <button className="linkbtn" onClick={() => restore(window.api.inbox.ignoreFolders([name], false))}>{t('settings.restore')}</button>
        </div>
      ))}
      {list?.archives.map((a) => (
        <div className="rowline" key={a.id}>
          <div className="lbl">{a.name}<small className="num">{size(a.size)}</small></div>
          <button className="linkbtn" onClick={() => restore(window.api.inbox.ignore([a.id], false))}>{t('settings.restore')}</button>
        </div>
      ))}
    </section>
  )
}
