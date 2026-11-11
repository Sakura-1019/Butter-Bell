// 解压完的游戏补资料：先选启动文件（有多个 exe 时），再从 DLsite 候选里点选，或者手动填写。程序从不替用户选候选。
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Candidate, GameCard, ProductDetail } from '../../preload'
import { joinSegments, splitTitle, type Segment } from '../../core/title-segments'
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
  const down = useRef([0, 0]) // 候选上按下鼠标的位置：拖动过（在选字）就不算点击
  // 这个游戏现在的名称和信息来源：标题用名称（文件夹名常常认不出是哪个游戏）；已有信息时底部是“取消”，当前用的作品标“当前”
  const [game, setGame] = useState<GameCard>()
  useEffect(() => void window.api.games.list().then((gs) => setGame(gs.find((x) => x.id === gameId))), [gameId])
  const hasInfo = game ? !game.needsMetadata : false

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
    <Modal wide title={t('setup.title', { name: game?.title ?? hints?.folderName ?? '' })} onClose={onDone}>
      <div className="seg" role="tablist">
        {(['dlsite', 'manual'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(`setup.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'manual' ? (
        hints && game !== undefined && (
          // 名称的候补：已有信息时先放现在的名称，再是识别出来的候补，最后是文件夹名；去重
          <Manual gameId={gameId} names={[...new Set([...(hasInfo ? [game.title] : []), ...hints.keywords, hints.folderName])]} onDone={onDone} />
        )
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
              // 不用 <button>：按钮里的字选不中。拖动选中名字后松开不算点击，方便复制
              <div
                key={c.code}
                className="cand"
                role="button"
                tabIndex={0}
                aria-disabled={busy}
                onMouseDown={(e) => (down.current = [e.clientX, e.clientY])}
                onClick={(e) => !busy && Math.hypot(e.clientX - down.current[0], e.clientY - down.current[1]) < 5 && pick(c)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && (e.preventDefault(), pick(c))}
              >
                <img src={c.coverUrl} alt="" loading="lazy" />
                <span className="txt sel">
                  <b>{c.title}{hasInfo && game?.sourceKind === 'dlsite' && game.sourceRef === c.code && <span className="current">{t('setup.current')}</span>}</b>
                  <small>{[c.circle, c.workType, c.code].filter(Boolean).join(' · ')}</small>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 还没信息：可以先跳过，以“待补信息”进库；已有信息：只是取消，现在的信息不变 */}
      <div className="foot">
        <span className="grow muted small">{hasInfo ? '' : t('setup.skipHint')}</span>
        <button className="btn ghost" onClick={onDone}>{hasInfo ? t('common.cancel') : t('setup.skip')}</button>
      </div>
    </Modal>
  )
}

// 点选候选后的详情：DLsite 类型词列成可勾选的小标签，属于“我的标签”的默认勾上（R-18G 在解析时已经去掉）
function Picked({ gameId, detail, onBack, onDone }: { gameId: number; detail: ProductDetail; onBack: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [tags, setTags] = useState(new Set<string>())
  const [busy, setBusy] = useState(false)
  // 现在的封面是用户手选的：默认保留，勾了才换成 DLsite 的
  const [manualCover, setManualCover] = useState(false)
  const [replaceCover, setReplaceCover] = useState(false)
  // 名称：DLsite 作品名拆成词段，宣传用的【】[] 默认熄灭；输入框里是最后写进库的名称
  const [segs, setSegs] = useState(() => splitTitle(detail.title))
  const [title, setTitle] = useState(() => joinSegments(splitTitle(detail.title)))
  useEffect(() => {
    window.api.settings.get().then((s) => {
      const mine = new Set(s.myTags.map((x) => x.toLowerCase()))
      setTags(new Set(detail.genres.filter((x) => mine.has(x.toLowerCase()))))
    })
    window.api.games.list().then((gs) => {
      const g = gs.find((x) => x.id === gameId)
      setManualCover(g?.coverSource === 'manual')
      // 用户自己改过名的：输入框先放现在的名字，点了词段才换成拼出来的
      const folder = g?.folderName.split(/[\\/]/).pop()
      if (g && g.title !== folder && g.title !== detail.title) setTitle(g.title)
    })
  }, [gameId, detail.title, detail.genres])
  const toggleSeg = (i: number) => {
    const next = segs.map((s, j): Segment => (j === i ? { ...s, on: !s.on } : s))
    setSegs(next)
    setTitle(joinSegments(next))
  }
  const [error, setError] = useState('')
  const toggle = (g: string) => setTags((s) => (s.delete(g) ? new Set(s) : new Set(s.add(g))))
  const use = async () => {
    setBusy(true)
    try {
      await window.api.games.applyDlsite(gameId, detail.code, [...tags], replaceCover, title)
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
        <b className="ptitle sel">{detail.title}</b>
        <small className="muted sel">{[detail.circle, detail.releaseDate, detail.code].filter(Boolean).join(' · ')}</small>
        {detail.description && <p className="pdesc sel">{detail.description}</p>}
        <small className="muted pname">{t('setup.nameHint')}</small>
        {segs.length > 1 && (
          <div className="chips segs">
            {segs.map((s, i) => (
              <button key={i} className="chip" aria-pressed={s.on} onClick={() => toggleSeg(i)}>{s.text}</button>
            ))}
          </div>
        )}
        <input className="input" value={title} aria-label={t('setup.nameLabel')} onChange={(e) => setTitle(e.target.value)} />
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
        {manualCover && (
          <label className="remember">
            <button className="check" role="checkbox" aria-checked={replaceCover} onClick={() => setReplaceCover(!replaceCover)}>{ICONS.check}</button>
            {t('setup.replaceCover')}
          </label>
        )}
        {error && <p className="warn">{t('setup.error', { detail: error })}</p>}
        <div className="row-btns">
          <button className="btn ghost" onClick={onBack}>{t('setup.back')}</button>
          <button className="btn primary" disabled={busy || !title.trim()} onClick={use}>{busy ? t('setup.saving') : t('setup.use')}</button>
        </div>
      </div>
    </div>
  )
}

// 手动填写：名称 + 拖进来（或点选）一张封面图
// names：名称的候补，第一个预填进名称框，其余列在下面点一下就换上
function Manual({ gameId, names, onDone }: { gameId: number; names: string[]; onDone: () => void }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(names[0] ?? '')
  const [file, setFile] = useState<File>()
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const preview = file && URL.createObjectURL(file)
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  const take = (f?: File) => f && f.type.startsWith('image/') && setFile(f)
  const save = async () => {
    try {
      await window.api.games.applyManual(gameId, title, file ? new Uint8Array(await file.arrayBuffer()) : null)
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
      {names.length > 1 && (
        <div className="chips hints">
          <span className="muted">{t('setup.alsoUse')}</span>
          {names.filter((n) => n !== title).map((n) => (
            <button key={n} className="chip" onClick={() => setTitle(n)}>{n}</button>
          ))}
        </div>
      )}
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
        <button className="btn primary" disabled={!title.trim()} onClick={save}>{t('setup.save')}</button>
      </div>
    </div>
  )
}

// IPC 报错带着 "Error invoking remote method 'x': " 前缀，界面上只留后面的原因
export const errorText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
