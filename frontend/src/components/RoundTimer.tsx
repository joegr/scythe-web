import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  clock, close, customFormats, end, forgetFormat, FORMATS, goTo, keepFormat, lengthOf, openCase, prepLeft, ran, save,
  setNotes, speechLeft, start, teamCases, toggleSpeech, togglePrep, useRound,
  type CaseRef, type Format, type Round, type SavedRound,
} from '../lib/round'

/** The current time, every quarter second while something runs. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [running])
  return running ? now : Date.now()
}

/** The timer's page: the formats when no round is on, the round when one is, and saving it when it's over. */
export default function TimerPage() {
  const r = useRound()
  if (!r) return <Formats />
  if (r.ended) return <Ended r={r} />
  return <Running r={r} />
}

// ---------------------------------------------------------------- choosing a format

function Formats() {
  const [custom, setCustom] = useState(customFormats)
  const [writing, setWriting] = useState(false)
  if (writing) return <CustomTimes onDone={() => { setWriting(false); setCustom(customFormats()) }} />
  return (
    <section className="stack timer-start">
      <h2>Timer</h2>
      <p>Choose the round’s format. The clock runs on this device; when the round ends, you can save it to the team’s record.</p>
      <div className="row">
        {FORMATS.map((f) => <button key={f.name} className="action" onClick={() => start(f)}>{f.name}</button>)}
        {custom.map((f) => (
          <span key={`c-${f.name}`} className="row" style={{ gap: '.25rem' }}>
            <button className="link" onClick={() => start(f)}>{f.name}</button>
            <button className="link" aria-label={`Forget ${f.name}`} title="Forget these times"
              onClick={() => { forgetFormat(f.name); setCustom(customFormats()) }}>×</button>
          </span>
        ))}
        <button className="link" onClick={() => setWriting(true)}>custom times</button>
      </div>
    </section>
  )
}

interface Draft { name: string; length: string }

/** Custom times: a list of blocks, each a name and a length, plus prep a side. Kept on this device by name. */
function CustomTimes({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [blocks, setBlocks] = useState<Draft[]>([{ name: '', length: '' }])
  const [prep, setPrep] = useState('')
  const [sides, setSides] = useState<[string, string]>(['First side', 'Second side'])
  const [error, setError] = useState<string | null>(null)
  const edit = (i: number, patch: Partial<Draft>) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const go = () => {
    const done = blocks.filter((x) => x.name.trim() || x.length.trim())
    const bad = done.find((x) => !x.name.trim() || !lengthOf(x.length))
    const prepSeconds = prep.trim() ? lengthOf(prep) : 0
    if (!name.trim()) return setError('Name these times, to find them again.')
    if (!done.length) return setError('Write at least one block: a name and a length, like 5:00.')
    if (bad) return setError(`“${bad.name || bad.length}” needs a name and a length, like 5:00.`)
    if (prepSeconds === null) return setError('Write prep as a length, like 2:00, or leave it empty.')
    const f: Format = {
      name: name.trim().slice(0, 60),
      blocks: done.map((x) => ({ name: x.name.trim().slice(0, 60), short: '', seconds: lengthOf(x.length)! })),
      prep: { sides: [sides[0].trim() || 'First side', sides[1].trim() || 'Second side'], seconds: prepSeconds },
    }
    keepFormat(f)
    start(f)
    onDone()
  }

  return (
    <section className="stack timer-start">
      <h2>Custom times</h2>
      <p>Write the round’s blocks in order: a name and a length for each. They’re kept on this device to use again.</p>
      {blocks.map((x, i) => (
        <div key={i} className="row">
          <input className="field" style={{ flex: 2 }} placeholder={`Block ${i + 1}`} aria-label={`Block ${i + 1} name`} maxLength={60}
            value={x.name} onChange={(e) => edit(i, { name: e.target.value })} />
          <input className="field" style={{ flex: 1 }} placeholder="5:00" aria-label={`Block ${i + 1} length`} maxLength={6} inputMode="numeric"
            value={x.length} onChange={(e) => edit(i, { length: e.target.value })} />
          {blocks.length > 1 && <button className="link" aria-label={`Remove block ${i + 1}`} onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <div className="row"><button className="link" onClick={() => setBlocks([...blocks, { name: '', length: '' }])}>add a block</button></div>
      <div className="row">
        <label style={{ marginTop: 0 }}>Prep a side
          <input className="field" placeholder="2:00" aria-label="Prep a side" maxLength={6} inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} />
        </label>
        <label style={{ marginTop: 0 }}>Sides
          <span className="row">
            <input className="field" aria-label="First side" maxLength={30} value={sides[0]} onChange={(e) => setSides([e.target.value, sides[1]])} />
            <input className="field" aria-label="Second side" maxLength={30} value={sides[1]} onChange={(e) => setSides([sides[0], e.target.value])} />
          </span>
        </label>
      </div>
      <input className="field" placeholder="Name these times" aria-label="Name these times" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="action" onClick={go}>start</button>
        <button className="link" onClick={onDone}>back</button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- a round in progress

function Running({ r }: { r: Round }) {
  const now = useNow(!!r.running)
  const speech = r.format.blocks[r.current]
  const left = speechLeft(r, now)
  const speaking = r.running?.what === 'speech'
  return (
    <section className="stack timer">
      <p className="timer-format">{r.format.name} · {r.current + 1} of {r.format.blocks.length}</p>
      <h2 className="timer-speech">{speech.short ? `${speech.short} · ` : ''}{speech.name}</h2>
      <div className={`timer-clock${left < 0 ? ' over' : ''}${speaking ? ' running' : ''}`} role="timer" aria-live="off"
        aria-label={`${speech.name}: ${clock(left)}${speaking ? ', running' : ', stopped'}`}>{clock(left)}</div>
      <div className="row timer-controls">
        <button className="link" disabled={r.current === 0} onClick={() => goTo(r.current - 1)}>previous</button>
        <button className="action" onClick={toggleSpeech}>{speaking ? 'stop' : ran(r, 'speech', now) > 0 ? 'resume' : 'start'}</button>
        <button className="link" disabled={r.current === r.format.blocks.length - 1} onClick={() => goTo(r.current + 1)}>next speech</button>
      </div>

      {r.format.prep.seconds > 0 && (
        <div className="row timer-prep">
          {([0, 1] as const).map((side) => {
            const prepping = r.running?.what === side
            const p = prepLeft(r, side, now)
            return (
              <button key={side} className={`link${prepping ? ' on' : ''}`} aria-pressed={prepping} onClick={() => togglePrep(side)}
                aria-label={`${r.format.prep.sides[side]} prep: ${clock(p)}${prepping ? ', running' : ''}`}>
                {r.format.prep.sides[side]} prep {clock(p)}{prepping ? ' · stop' : ''}
              </button>
            )
          })}
        </div>
      )}

      <ol className="timer-blocks">
        {r.format.blocks.map((x, i) => (
          <li key={i} aria-current={i === r.current ? 'step' : undefined}>
            <button className="link plain" onClick={() => goTo(i)}>
              {x.short ? `${x.short} · ` : ''}{x.name} · {clock(x.seconds * 1000)}{r.used[i] ? ` · ran ${clock(r.used[i])}` : ''}
            </button>
          </li>
        ))}
      </ol>

      <Cases />
      <Log r={r} />
      <label>Notes
        <textarea className="field" rows={4} maxLength={50_000} value={r.notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="What the judge said, what to fix." />
      </label>
      <div className="row"><button className="link" onClick={end}>end the round</button></div>
    </section>
  )
}

/** The team's cases, to open during the round: each one opened is noted as a case the round used. */
function Cases() {
  const [cases, setCases] = useState<CaseRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { teamCases().then(setCases).catch((e) => setError((e as Error).message)) }, [])
  if (error) return <p className="error">{error}</p>
  if (!cases?.length) return null
  return (
    <section>
      <h3>Cases</h3>
      <div className="row">{cases.map((c) => <button key={c.number} className="link" onClick={() => openCase(c.number)}>{c.title || `Case ${c.number}`}</button>)}</div>
    </section>
  )
}

/** What's been opened so far, newest first. */
function Log({ r }: { r: Round }) {
  const shown = r.log.filter((e) => e.did !== 'began').slice().reverse()
  if (!shown.length) return null
  const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <section>
      <h3>Opened during the round</h3>
      <ul className="list timer-log">
        {shown.map((e, i) => (
          <li key={i}>
            {time(e.at)} · {e.during} · {e.did}{' '}
            {e.card ? <Link to={`/cards/${e.card}`}>#{e.card}</Link> : e.case ? `case ${e.case}` : ''}
            {e.query ? ` (searched “${e.query}”)` : ''}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- the round is over

function Ended({ r }: { r: Round }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedRound | null>(null)
  const navigate = useNavigate()
  const another = (f: Format) => { close(); start(f) }

  if (saved) return (
    <section className="stack timer-start">
      <h2>Saved</h2>
      <p>Round {saved.id}, {saved.title}, is in the team’s record{saved.cases.length ? `, with ${saved.cases.length} ${saved.cases.length === 1 ? 'case' : 'cases'}` : ''}.</p>
      <div className="row">
        <button className="action" onClick={() => another(r.format)}>another {r.format.name} round</button>
        <button className="link" onClick={close}>another format</button>
        <button className="link" onClick={() => { close(); navigate('/') }}>close the timer</button>
      </div>
    </section>
  )

  const opened = r.log.filter((e) => e.did !== 'began').length
  return (
    <section className="stack timer-start">
      <h2>The round is over</h2>
      <p>{r.format.name}, {opened} {opened === 1 ? 'thing' : 'things'} opened while it ran. Save it to the team’s record with your notes, or let it go.</p>
      <input className="field" placeholder="Round 2 vs Lincoln" aria-label="Round title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label>Notes
        <textarea className="field" rows={5} maxLength={50_000} value={r.notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="action" disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          try { setSaved(await save(title)) } catch (e) { setError(`${(e as Error).message} The round stays here until it’s saved.`) } finally { setBusy(false) }
        }}>{busy ? 'saving…' : 'save the round'}</button>
        <button className="link" onClick={close}>let it go without saving</button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- floating over the app

/** While a round is on and the timer's page isn't open: the clock, small, in a corner, over whatever page is. */
export function FloatingClock() {
  const r = useRound()
  const { pathname } = useLocation()
  const now = useNow(!!r?.running)
  if (!r || pathname === '/timer') return null
  if (r.ended) return (
    <div className="timer-float no-print" role="status">
      <Link to="/timer">round over: save it</Link>
    </div>
  )
  const speech = r.format.blocks[r.current]
  const prepping = r.running && r.running.what !== 'speech' ? r.running.what : null
  const left = prepping === null ? speechLeft(r, now) : prepLeft(r, prepping, now)
  const label = prepping === null ? speech.short || speech.name : `${r.format.prep.sides[prepping]} prep`
  return (
    <div className={`timer-float no-print${left < 0 ? ' over' : ''}`} role="timer" aria-label={`${label}: ${clock(left)}${r.running ? ', running' : ', stopped'}`}>
      <Link to="/timer" title="Open the timer">{label} {clock(left)}</Link>
      {prepping === null && <button className="link" onClick={toggleSpeech}>{r.running ? 'stop' : 'start'}</button>}
      {prepping !== null && <button className="link" onClick={() => togglePrep(prepping)}>stop</button>}
    </div>
  )
}
