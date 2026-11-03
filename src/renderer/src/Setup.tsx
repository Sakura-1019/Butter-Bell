// 解压完的游戏补资料：先选启动文件（有多个 exe 时），再从 DLsite 候选里点选，或者手动填写。程序从不替用户选候选。
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Candidate, ProductDetail } from '../../preload'
import Modal from './Modal'
import { ICONS } from './icons'

export default function Setup({ gameId, onDone }: { gameId: number; onDone: () => void }) {
  const [step, setStep] = useState<'loading' | 'launch' | 'identify'>('loading')
  const [launch, setLaunch] = useState<string[]>([])
  useEffect(() => {
    setStep('loading')
    window.api.games.launchOptions(gameId).then((o) => {
      setLaunch(o.candidates)
      setStep(!o.current && o.candidates.length > 1 ? 'launch' : 'identify')
    })
  }, [gameId])
  if (step === 'loading') return null
  if (step === 'launch') return <LaunchStep gameId={gameId} candidates={launch} onNext={() => setStep('identify')} onClose={onDone} />
  return <Identify gameId={gameId} onDone={onDone} />
}

export function LaunchStep({ gameId, candidates, current, onNext, onClose }: { gameId: number; candidates: string[]; current?: string | null; onNext: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [choice, setChoice] = useState(current && candidates.includes(current) ? current : candidates[0]) // 已按启动文件判断排好序，最可能的在最前
  return (
    <Modal title={t('setup.launchTitle')} onClose={onClose}>
      <p>{t('setup.launchHint', { count: candidates.length })}</p>
      <div role="radiogroup" className="opts">
        {candidates.map((c) => (
          <button key={c} className="opt" role="radio" aria-checked={choice === c} onClick={() => setChoice(c)}>
            <span className="radio" />
            <span>
              <b>{c.slice(c.lastIndexOf('/') + 1)}</b>
              <small>{c}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="foot">
        <span className="grow" />
        <button className="btn primary" onClick={async () => (await window.api.games.setLaunch(gameId, choice), onNext())}>
          {t('setup.next')}
        </button>
      </div>
    </Modal>
  )
}

export function Identify({ gameId, onDone }: { gameId: number; onDone: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'dlsite' | 'manual'>('dlsite')
  const [hints, setHints] = useState<Awaited<ReturnType<typeof window.api.games.hints>>>()
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<Candidate[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<ProductDetail | null>()
  const latest = useRef(0) // 只认最后一次搜索的结果，先发出去的慢请求回来了也不覆盖

  const search = async (k: string) => {
    setKeyword(k)
    const n = ++latest.current
    if (!k.trim()) return setResults([])
    setBusy(true)
    setError('')
    try {
      const r = await window.api.dlsite.search(k)
      if (n === latest.current) setResults(r)
    } catch (e) {
      if (n === latest.current) setError(errorText(e))
    }
    if (n === latest.current) setBusy(false)
  }

  useEffect(() => {
    let live = true
    window.api.games.hints(gameId).then(async (h) => {
      if (!live) return

      setHints(h)
      // 文件名或解压内容里有 RJ 号时，先把那个作品列出来，仍然要用户自己点
      if (h.workCode) {
        const d = await window.api.dlsite.product(h.workCode).catch(() => null)
        if (d) return setResults([{ code: d.code, title: d.title, circle: d.circle, coverUrl: d.coverUrl, workType: '' }]), setKeyword(h.keyword)
      }
      search(h.keyword)
    })
    return () => void (live = false)
  }, [gameId])

  const pick = async (c: Candidate) => {
    setBusy(true)
    setError('')
    try {
      setPicked(await window.api.dlsite.product(c.code))
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(false)
  }

  return (
    <Modal wide title={t('setup.title', { name: hints?.folderName ?? '' })} onClose={onDone}>
      <div className="seg" role="tablist">
        {(['dlsite', 'manual'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(`setup.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'manual' ? (
        hints && <Manual gameId={gameId} initial={hints.folderName} onDone={onDone} />
      ) : picked ? (
        <Picked gameId={gameId} detail={picked} onBack={() => setPicked(undefined)} onDone={onDone} />
      ) : (
        <>
          <form className="searchrow" onSubmit={(e) => (e.preventDefault(), search(keyword))}>
            <input className="input grow" value={keyword} aria-label={t('setup.keyword')} placeholder={t('setup.keyword')} onChange={(e) => setKeyword(e.target.value)} />
            <button className="btn primary" disabled={busy || !keyword.trim()}>{t('setup.search')}</button>
          </form>
          {hints && hints.keywords.length > 1 && (
            <div className="chips hints">
              <span className="muted">{t('setup.alsoTry')}</span>
              {hints.keywords.filter((k) => k !== keyword).map((k) => (
                <button key={k} className="chip" onClick={() => search(k)}>{k}</button>
              ))}
            </div>
          )}
          {picked === null && <p className="warn">{t('setup.notFound')}</p>}
          {error && <p className="warn">{t('setup.error', { detail: error })}</p>}
          <div className="cands" aria-busy={busy}>
            {busy && !results?.length && <p className="muted">{t('setup.searching')}</p>}
            {results && !results.length && !busy && <p className="muted">{t('setup.noResults')}</p>}
            {results?.map((c) => (
              <button key={c.code} className="cand" disabled={busy} onClick={() => pick(c)}>
                <img src={c.coverUrl} alt="" loading="lazy" />
                <span className="txt">
                  <b>{c.title}</b>
                  <small>{[c.circle, c.workType, c.code].filter(Boolean).join(' · ')}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="foot">
        <span className="grow muted small">{t('setup.skipHint')}</span>
        <button className="btn ghost" onClick={onDone}>{t('setup.skip')}</button>
      </div>
    </Modal>
  )
}

// 点选候选后的详情：DLsite 类型词列成可勾选的小标签，默认都不勾
function Picked({ gameId, detail, onBack, onDone }: { gameId: number; detail: ProductDetail; onBack: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [tags, setTags] = useState(new Set<string>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (g: string) => setTags((s) => (s.delete(g) ? new Set(s) : new Set(s.add(g))))
  const use = async () => {
    setBusy(true)
    try {
      await window.api.games.applyDlsite(gameId, detail.code, [...tags])
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <div className="picked">
      <img className="pcover" src={detail.coverUrl} alt="" />
      <div className="pbody">
        <b className="ptitle">{detail.title}</b>
        <small className="muted">{[detail.circle, detail.releaseDate, detail.code].filter(Boolean).join(' · ')}</small>
        {detail.description && <p className="pdesc">{detail.description}</p>}
        {detail.genres.length > 0 && (
          <>
            <small className="muted">{t('setup.genresHint')}</small>
            <div className="chips">
              {detail.genres.map((g) => (
                <button key={g} className="chip" aria-pressed={tags.has(g)} onClick={() => toggle(g)}>{g}</button>
              ))}
            </div>
          </>
        )}
        {error && <p className="warn">{t('setup.error', { detail: error })}</p>}
        <div className="row-btns">
          <button className="btn ghost" onClick={onBack}>{t('setup.back')}</button>
          <button className="btn primary" disabled={busy} onClick={use}>{busy ? t('setup.saving') : t('setup.use')}</button>
        </div>
      </div>
    </div>
  )
}

// 手动填写：名称 + 拖进来（或点选）一张封面图
function Manual({ gameId, initial, onDone }: { gameId: number; initial: string; onDone: () => void }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(initial)
  const [file, setFile] = useState<File>()
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const preview = file && URL.createObjectURL(file)
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  const take = (f?: File) => f && f.type.startsWith('image/') && setFile(f)
  const save = async () => {
    try {
      await window.api.games.applyManual(gameId, title, new Uint8Array(await file!.arrayBuffer()))
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="manual">
      <label className="field">
        <span>{t('setup.manualTitle')}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button
        className={over ? 'drop over' : 'drop'}
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), take(e.dataTransfer.files[0]))}
      >
        {preview ? <img src={preview} alt="" /> : <span>{ICONS.image}{t('setup.dropCover')}</span>}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => take(e.target.files?.[0])} />
      {error && <p className="warn">{t('setup.error', { detail: error })}</p>}
      <div className="row-btns">
        <button className="btn primary" disabled={!title.trim() || !file} onClick={save}>{t('setup.save')}</button>
      </div>
    </div>
  )
}

// IPC 报错带着 "Error invoking remote method 'x': " 前缀，界面上只留后面的原因
export const errorText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
