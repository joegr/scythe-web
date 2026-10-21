import { useEffect, useRef, useState } from 'react'
import { cameraSupported, closeCamera, discardDraft, editDraft, isMobile, kindOf, listDrafts, openCamera, readScan,
  reportScan, stillPhoto, wake, type Draft, type ScanKind } from '../lib/scan'
import { DEFAULT_LABELS, snapChars, type SpanRec } from '../lib/doc'
import { createCard, createSource, spanKey } from '../lib/store'
import { useTopic } from '../lib/topic'
import Finder from './Finder'
import PhotoPick from './PhotoPick'
import TokenText from './TokenText'

type Step = 'camera' | 'queue' | 'check' | 'corners'
const MARKS = DEFAULT_LABELS.filter((l) => ['underline', 'highlight', 'emphasis'].includes(l.style))
const KEEP_PICTURES = 6 // pictures kept on the phone (to read again or drag corners), newest first; the server keeps none

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const preview = (d: Draft) => d.tag || d.body.split(/\s+/).slice(0, 8).join(' ') || 'Untitled'
/** A tag or cite box as tall as what's in it: a long cite reads whole, not cut off at one line. */
const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }

/** Scan cards into a queue, then check each one: a screenshot is read as it is, a photo of paper is squared up to the
 *  card's corners on the team's server, and either waits as your draft (words and marks, never the picture) until you
 *  check its words, mark it and save it as a card. On a computer the sheet opens on the queue: checking needs no camera. */
export default function Scan({ open, onClose, onSaved, start = 'camera' }:
  { open: boolean; onClose: () => void; onSaved: (card: number) => void; start?: 'camera' | 'queue' }) {
  const ref = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const pictures = useRef(new Map<number, { blob: Blob; url?: string }>())
  const { require } = useTopic()
  const [step, setStep] = useState<Step>(start)
  const [live, setLive] = useState(false)
  const [drafts, setDraftList] = useState<Draft[]>([])
  const [reading, setReading] = useState(0)
  // The queue and the reads in flight, as of now: a read that lands decides from these whether to open its draft.
  const queue = useRef<Draft[]>([])
  const inFlight = useRef(0)
  const setDrafts = (next: Draft[]) => { queue.current = next; setDraftList(next) }
  const [current, setCurrent] = useState<Draft | null>(null)
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const [active, setActive] = useState<SpanRec | null>(null)
  const [corners, setCorners] = useState<number[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // What the scanner is doing right now, in words: a step that takes a moment never looks like nothing happening.
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const scanner = isMobile()

  const stop = () => { closeCamera(stream.current); stream.current = null; setLive(false) }
  /** Say what went wrong, and tell the team's server where (for its logs). */
  const fail = (where: string, e: unknown) => { setStatus(null); setError((e as Error).message || String(e)); reportScan(where, e) }
  const camera = async () => {
    setError(null); setStep('camera')
    if (!scanner || !cameraSupported() || stream.current) return
    setStatus('Starting the camera…')
    try {
      stream.current = await openCamera()
      if (video.current) { video.current.srcObject = stream.current; await video.current.play() }
      setLive(true); setStatus(null)
    } catch {
      setStatus(null)
      setError('Scythe can’t use the camera here (permission refused?). Allow the camera for this site in your browser’s settings, or choose a photo.')
    }
  }
  const forget = () => {
    for (const p of pictures.current.values()) if (p.url) URL.revokeObjectURL(p.url)
    pictures.current.clear()
  }
  const keep = (id: number, blob: Blob) => {
    const old = pictures.current.get(id)
    if (old?.url) URL.revokeObjectURL(old.url)
    pictures.current.delete(id)
    pictures.current.set(id, { blob })
    for (const [k, p] of [...pictures.current].slice(0, Math.max(0, pictures.current.size - KEEP_PICTURES))) {
      if (p.url) URL.revokeObjectURL(p.url)
      pictures.current.delete(k)
    }
  }
  const pictureUrl = (id: number) => {
    const p = pictures.current.get(id)
    if (!p) return null
    p.url ??= URL.createObjectURL(p.blob)
    return p.url
  }

  const check = (d: Draft) => {
    stop(); setCurrent(d); setSelection(null); setActive(null); setError(null); setStep('check')
  }

  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) {
      d.showModal()
      setDrafts([]); setCurrent(null); inFlight.current = 0; setReading(0)
      listDrafts().then((ds) => setDrafts([...queue.current, ...ds.filter((x) => !queue.current.some((q) => q.id === x.id))])).catch((e) => fail('queue', e))
      if (start === 'camera' && scanner) void camera()
      else setStep('queue')
    }
    if (!open && d.open) { d.close(); stop(); forget() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- only opening and closing the sheet starts or stops it
  useEffect(() => () => { closeCamera(stream.current); forget() }, []) // the camera never stays on after the sheet goes
  // The team's server wakes as the scanner opens, and stays awake while it's open (lib/scan.ts: wake).
  useEffect(() => {
    if (!open) return
    wake()
    const keepAwake = setInterval(wake, 120_000)
    return () => clearInterval(keepAwake)
  }, [open])
  const waiting = () => setStatus('Waking up your team’s Scythe… this takes a few seconds.')

  /** Send a picture to be read. The camera stays ready for the next card; a first card read with nothing else waiting
   *  opens straight away for checking. */
  const send = async (where: string, get: () => Promise<{ blob: Blob; kind: ScanKind }>) => {
    setError(null)
    setReading(++inFlight.current)
    try {
      const { blob, kind } = await get()
      setStatus(kind === 'screenshot' ? 'Reading the screenshot…' : 'Squaring the card up and reading it…')
      const d = await readScan(blob, kind, { onWait: waiting })
      keep(d.id, blob)
      setStatus(null)
      setDrafts([d, ...queue.current.filter((x) => x.id !== d.id)])
      setReading(--inFlight.current)
      if (inFlight.current === 0 && queue.current.length === 1) check(d)
    } catch (e) {
      setReading(--inFlight.current)
      fail(where, e)
    }
  }
  const take = () => void send('take', async () => ({ blob: await stillPhoto(video.current!), kind: 'photo' }))
  const chose = (f: File) => void send('photo', async () => ({ blob: f, kind: await kindOf(f) }))

  /** Read the current draft again, from the picture still on this phone: as the other kind, or from dragged corners. */
  const again = async (kind: ScanKind, from?: number[]) => {
    const d = current, p = d && pictures.current.get(d.id)
    if (!d || !p) return
    setError(null); setStatus(kind === 'screenshot' ? 'Reading it as a screenshot…' : 'Squaring the card up and reading it…')
    try {
      const r = await readScan(p.blob, kind, { replaces: d.id, corners: from, onWait: waiting })
      setStatus(null); setDrafts(queue.current.map((x) => (x.id === r.id ? r : x))); check(r)
    } catch (e) { fail('again', e) }
  }

  const mark = (style: string) => {
    if (!current || !selection) return
    const snapped = snapChars(current.body, selection[0], selection[1])
    window.getSelection()?.removeAllRanges(); setSelection(null)
    if (!snapped) return
    const [a, b] = snapped
    if (current.spans.some((s) => s.style === style && s.start_char === a && s.end_char === b)) return
    const span: SpanRec = { label: style, key: 'sc', style, start_char: a, end_char: b, src: 'manual' }
    setCurrent({ ...current, spans: [...current.spans, span].sort((x, y) => x.start_char - y.start_char || y.end_char - x.end_char) })
  }
  const unmark = (s: SpanRec) => {
    if (!current) return
    setActive(null)
    setCurrent({ ...current, spans: current.spans.filter((x) => spanKey(x) !== spanKey(s)) })
  }
  const pick = (spans: SpanRec[]) => {
    if (window.getSelection()?.isCollapsed === false || !spans.length) return
    const i = active ? spans.findIndex((s) => spanKey(s) === spanKey(active)) : -1
    setActive(spans[(i + 1) % spans.length])
  }

  useEffect(() => {
    if (step !== 'check') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      const label = MARKS.find((l) => l.hotkey === e.key)
      if (label && selection) { e.preventDefault(); mark(label.style); return }
      if ((e.key === 'Backspace' || e.key === 'Delete') && active) { e.preventDefault(); unmark(active) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** Approve: the draft's tag, cite and marks go to the server, the words become a source and the card is cut from it
   *  word for word, with its marks; then the draft is cleared. */
  const save = async () => {
    const d = current
    if (!d || saving) return
    setSaving(true); setError(null)
    try {
      // The server keeps the approved tag, cite and marks, and says what the source's text now is.
      const ok = await editDraft(d.id, { tag: d.tag, cite: d.cite, spans: d.spans.map((s) => ({ style: s.style, start_char: s.start_char, end_char: s.end_char })) })
      const topic = await require()
      // A card whose tag can't be made out is saved as Untitled, to be tagged later.
      const title = ok.tag.trim() || 'Untitled'
      const source = await createSource({ text: ok.text, title, cite: ok.cite })
      // The marks count characters of the body; a card made from the whole text (no body read) has none.
      const card = await createCard({ text: ok.body || ok.text, title, cite: ok.cite, source, topic, spans: ok.body ? ok.spans : [] })
      await discardDraft(d.id).catch((e) => reportScan('clear', e)) // the card is saved; a draft left over can be discarded
      setDrafts(queue.current.filter((x) => x.id !== d.id))
      onSaved(card)
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  const discard = async () => {
    const d = current
    if (!d) return
    try {
      await discardDraft(d.id)
      const rest = queue.current.filter((x) => x.id !== d.id)
      setDrafts(rest); setCurrent(null)
      if (rest.length) setStep('queue')
      else void camera()
    } catch (e) { fail('discard', e) }
  }

  const waitingCount = drafts.length
  const strip = (reading > 0 || waitingCount > 0) && (
    <p className="row">
      <span>{reading > 0 ? `Reading ${reading === 1 ? 'a card' : `${reading} cards`}…` : ''}{reading > 0 && waitingCount > 0 ? ' · ' : ''}
        {waitingCount > 0 ? `${waitingCount} to check` : ''}</span>
      {waitingCount > 0 && <button className="link spacer" onClick={() => { if (waitingCount === 1) check(drafts[0]); else { stop(); setStep('queue') } }}>check {waitingCount === 1 ? 'it' : 'them'}</button>}
    </p>
  )
  const d = current
  const kept = d ? pictures.current.has(d.id) : false
  return (
    <dialog ref={ref} className="sheet" onCancel={onClose}>
      <div className="sheet-inner stack">
        <div className="row">
          <h1>{step === 'camera' ? 'Scan a card' : step === 'queue' ? 'Scans to check' : step === 'corners' ? 'The card’s corners' : 'Check the scan'}</h1>
          <button className="link spacer" onClick={onClose}>close</button>
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="note" role="status">{status}</p>}
        {step === 'camera' && (
          <div className="stack">
            <div className="scan-frame" style={{ display: live ? 'block' : 'none' }}>
              <video ref={video} playsInline muted autoPlay />
              <Finder video={video} live={live && step === 'camera'} onSteady={take} />
            </div>
            {live && <button className="action" onClick={take}>take the picture</button>}
            {/* The camera is Scythe's own, above: never the phone's camera app. */}
            <PhotoPick take={false} onPhoto={chose} />
            {strip}
            <p>Lay the card flat in good light, on something darker than the card, and fit it in the frame: once it holds still the picture is taken by itself. Or choose a screenshot. Your team’s server squares a photo up to the card’s corners and reads it; a screenshot it reads as it is. Neither is kept: only the words wait for you to check.</p>
          </div>
        )}
        {step === 'queue' && (
          <div className="stack">
            {reading > 0 && <p className="note">Reading {reading === 1 ? 'a card' : `${reading} cards`}…</p>}
            {drafts.length === 0 && reading === 0 && <p>Nothing to check.</p>}
            <ul className="scan-queue">
              {drafts.map((x) => (
                <li key={x.id}>
                  <button className="link" onClick={() => check(x)}>{preview(x)}</button>
                  <span className="note"> · {x.kind === 'screenshot' ? 'screenshot' : 'photo'} · {ago(x.created_at)}</span>
                </li>
              ))}
            </ul>
            {scanner && <p><button className="link" onClick={() => void camera()}>scan another</button></p>}
          </div>
        )}
        {step === 'check' && d && (
          <div className="stack scan-check">
            <p className="note">{d.kind === 'screenshot' ? 'Read as a screenshot.' : 'Squared up from a photo of paper.'}
              {kept && <> <button className="link" onClick={() => void again(d.kind === 'screenshot' ? 'photo' : 'screenshot')}>
                read it as a {d.kind === 'screenshot' ? 'photo' : 'screenshot'} instead</button></>}</p>
            {/* The card as it will be saved: its tag, cite and words, the whole screen on a phone. */}
            <article className="card scan-card">
              <textarea className="card-tag scan-line" rows={1} ref={grow} placeholder="Tag" maxLength={300} value={d.tag}
                onChange={(e) => { grow(e.currentTarget); setCurrent({ ...d, tag: e.target.value.replace(/\n/g, ' ') }) }} />
              <textarea className="card-cite scan-line" rows={1} ref={grow} placeholder="Cite" maxLength={2000} value={d.cite}
                onChange={(e) => { grow(e.currentTarget); setCurrent({ ...d, cite: e.target.value.replace(/\n/g, ' ') }) }} />
              {/* The marks on the paper, retold as Scythe's underlines over the same words (a highlighter's is the heavy one). */}
              <div className="card-body scan-body">
                <TokenText text={d.body} spans={d.spans} editable mark={selection} activeKey={active ? spanKey(active) : null}
                  onSelect={(r) => { const s = r ? snapChars(d.body, r[0], r[1]) : null; setSelection(s); if (s) setActive(null) }} onSpanClick={pick} />
              </div>
            </article>
            <p className="note">These are the words as read{d.spans.length ? ', with their marks' : ''}. Select words to underline, highlight or emphasize them; tap a mark to remove it. If a word is misread, take it again: the card keeps the words exactly.</p>
            <div className="scan-tools stack">
            <div className="row">
              {MARKS.map((l) => (
                <button key={l.name} className="link" disabled={!selection} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(l.style)}>
                  {l.hotkey && <kbd>{l.hotkey}</kbd>} {l.name}
                </button>
              ))}
              {active && <button className="link spacer" onClick={() => unmark(active)}>remove {active.style}</button>}
            </div>
            <div className="row">
              <button className="action" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save card'}</button>
              {d.kind === 'photo' && kept && <button className="link" onClick={() => { setCorners(d.corners ?? [0, 0, 1, 0, 1, 1, 0, 1]); setStep('corners') }}>adjust the corners</button>}
              <button className="link" onClick={() => void discard()}>discard</button>
              {drafts.length > 1 && <button className="link spacer" onClick={() => setStep('queue')}>all scans</button>}
              {scanner && drafts.length <= 1 && <button className="link spacer" onClick={() => void camera()}>scan another</button>}
            </div>
            </div>
          </div>
        )}
        {step === 'corners' && d && corners && pictureUrl(d.id) && (
          <div className="stack">
            <p>Drag the corners onto the card’s.</p>
            <Corners src={pictureUrl(d.id)!} corners={corners} onChange={setCorners} />
            <div className="row">
              <button className="action" onClick={() => void again('photo', corners)}>read it again</button>
              <button className="link spacer" onClick={() => setStep('check')}>back</button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}

/** The picture with the card's four corners (fractions of the upright picture), each draggable. */
function Corners({ src, corners, onChange }: { src: string; corners: number[]; onChange: (c: number[]) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const pts = size ? [0, 1, 2, 3].map((i) => ({ x: corners[2 * i] * size.w, y: corners[2 * i + 1] * size.h })) : []
  const r = size ? Math.max(size.w, size.h) / 40 : 0

  const at = (e: React.PointerEvent): { x: number; y: number } | null => {
    const m = svg.current?.getScreenCTM()
    if (!m || !size) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: Math.min(Math.max(p.x / size.w, 0), 1), y: Math.min(Math.max(p.y / size.h, 0), 1) }
  }

  return (
    <div className="scan-frame">
      <img src={src} alt="The picture" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {size && (
        <svg ref={svg} viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid meet"
          onPointerMove={(e) => { if (drag === null) return; const p = at(e); if (p) onChange(corners.map((v, i) => (i === 2 * drag ? p.x : i === 2 * drag + 1 ? p.y : v))) }}
          onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
          <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={r} onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setDrag(i) }} />
          ))}
        </svg>
      )}
    </div>
  )
}
