import { useEffect, useRef, useState } from 'react'
import { cameraSupported, closeCamera, detectQuad, frameQuad, loadCv, openCamera, photoCanvas, readCard, readPicture, rectify,
  release, reportScan, still, wake, type Pt, type Quad, type ScanDraft } from '../lib/scan'
import PhotoPick from './PhotoPick'
import TokenText from './TokenText'
import { createCard, createSource } from '../lib/store'
import { useTopic } from '../lib/topic'

type CV = Awaited<ReturnType<typeof loadCv>>['cv']
const DETECT_MS = 125 // about 8 looks for the card a second; the box is drawn every frame
const SMOOTH = 0.4    // how far each look moves the drawn box toward what it found
const LOST_AFTER = 6  // looks in a row without the card before its box goes
const CV_WAIT = 20_000 // how long a picture waits for the scanner before it's read as it is

/** The scanner, or null if it isn't ready within `ms` (the picture is then read without squaring it up). `cv` is a
 *  thenable whose `then` hands back itself, so it stays wrapped: a promise resolved with it, or an async function
 *  returning it, chases it forever and locks the page. */
async function scannerWithin(ms: number): Promise<{ cv: CV } | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  try { return await Promise.race([loadCv(), timeout]) } catch { return null }
}

/** Scan a printed card: the camera (asked for only now) with the card's outline as it's found, the picture squared up
 *  to the card, the server's reading (words, and the marks on the paper as underlines), then save it as a card. */
export default function Scan({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (card: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const seen = useRef<Quad | null>(null)
  const { require } = useTopic()
  const [cv, setCv] = useState<CV | null>(null)
  const [step, setStep] = useState<'camera' | 'corners' | 'reading' | 'draft'>('camera')
  const [live, setLive] = useState(false)
  const [box, setBox] = useState<Quad | null>(null)
  const [photo, setPhoto] = useState<{ canvas: HTMLCanvasElement; quad: Quad } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [draft, setDraft] = useState<ScanDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  // What the scanner is doing right now, in words: a step that takes a moment never looks like nothing happening.
  const [status, setStatus] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const stop = () => { closeCamera(stream.current); stream.current = null; seen.current = null; setLive(false); setBox(null) }
  /** Say what went wrong, and tell the team's server where (for its logs). */
  const fail = (step: string, e: unknown) => { setStatus(null); setError((e as Error).message || String(e)); reportScan(step, e) }
  const start = async () => {
    setError(null); setNote(null); setStep('camera'); setDraft(null); setPreview(null)
    setPhoto((p) => { release(p?.canvas); return null })
    if (!cameraSupported()) return
    setStatus('Starting the camera…')
    try {
      stream.current = await openCamera()
      if (video.current) { video.current.srcObject = stream.current; await video.current.play() }
      setLive(true); setStatus(cv ? null : 'Starting the scanner…')
    } catch {
      setStatus(null)
      setError('Scythe can’t use the camera here (permission refused?). Take the picture with your camera instead.')
    }
  }

  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) {
      d.showModal(); void start()
    }
    if (!open && d.open) { d.close(); stop(); setPhoto((p) => { release(p?.canvas); return null }) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- only opening and closing the sheet starts or stops it
  useEffect(() => () => closeCamera(stream.current), []) // the camera never stays on after the sheet goes
  // The team's server wakes as the scanner opens, and stays awake while it's open (lib/scan.ts: wake).
  useEffect(() => {
    if (!open) return
    wake()
    const keep = setInterval(wake, 120_000)
    return () => clearInterval(keep)
  }, [open])
  const waiting = () => setStatus('Waking up your team’s Scythe… this takes a few seconds.')

  // The scanner (OpenCV) loads once the camera is up, so its weight never holds the camera back.
  useEffect(() => {
    if (!open || !live || cv) return
    loadCv().then(({ cv }) => { setCv(() => cv); setStatus(null) }).catch((e) => {
      // The picture can still be taken: it's read as it is, without squaring up.
      setStatus(null); setNote('Scythe’s scanner didn’t load, so the picture will be read as it is. Hold the phone straight over the card.')
      reportScan('load', e)
    })
  }, [open, live, cv])

  // The card's outline over the camera, as it's found.
  useEffect(() => {
    if (!cv || !live) return
    let raf = 0, last = 0, misses = 0, broken = 0
    const look = (t: number) => {
      const v = video.current
      if (v && v.videoWidth && t - last > DETECT_MS && !document.hidden) {
        last = t
        let found: Quad | null = null
        try { found = detectQuad(cv, v); broken = 0 } catch (e) {
          // The live outline is a help, not a step: after a few failures it stops, and the picture is still taken.
          if (++broken >= 3) { reportScan('look', e); setBox(null); return }
        }
        const prev = seen.current
        if (found) {
          misses = 0
          seen.current = prev ? prev.map((p, i) => ({ x: p.x + (found[i].x - p.x) * SMOOTH, y: p.y + (found[i].y - p.y) * SMOOTH })) as Quad : found
        } else if (++misses >= LOST_AFTER) seen.current = null
        setBox(seen.current)
      }
      raf = requestAnimationFrame(look)
    }
    raf = requestAnimationFrame(look)
    return () => cancelAnimationFrame(raf)
  }, [cv, live])

  /** Square the picture up to the card's corners, and only then read it. Without the scanner (it didn't load, or this
   *  phone ran out of room squaring it up), the picture is read as it is. */
  const read = async (canvas: HTMLCanvasElement, quad: Quad | null) => {
    stop(); setStep('reading'); setError(null); setPhoto(quad ? { canvas, quad } : null)
    const c = cv ?? (quad ? (await scannerWithin(CV_WAIT))?.cv : null)
    let card: ReturnType<typeof rectify> | null = null
    if (c && quad) {
      setStatus('Squaring the card up…')
      try { card = rectify(c, canvas, quad) } catch (e) { reportScan('square', e) }
    }
    try {
      setStatus('Reading the words…')
      if (card) {
        setPreview(card.canvas.toDataURL('image/jpeg', 0.8))
        setDraft(await readCard(card, waiting))
      } else {
        setPreview(canvas.toDataURL('image/jpeg', 0.8))
        setNote('Read as it is, without squaring it up. If words are missing, take it again straight over the card.')
        setDraft(await readPicture(canvas, waiting))
      }
      setStatus(null); setStep('draft')
    } catch (e) {
      fail('read', e); setStep(quad ? 'corners' : 'camera')
    } finally {
      release(card?.canvas)
    }
  }

  /** The corners for a new picture: found in the full picture, else the outline seen live, else the whole frame. */
  const took = async (canvas: HTMLCanvasElement) => {
    const outline = seen.current
    setStatus('Finding the card…')
    const c = cv ?? (await scannerWithin(CV_WAIT))?.cv
    let quad: Quad | null = null
    if (c) {
      try { quad = detectQuad(c, canvas, 960) ?? outline ?? frameQuad(canvas.width, canvas.height) } catch (e) { reportScan('find', e) }
    }
    await read(canvas, quad)
  }
  /** Every way a picture arrives runs here, so nothing it does can fail without saying so. */
  const picture = async (step: string, get: () => HTMLCanvasElement | Promise<HTMLCanvasElement>) => {
    setError(null); setNote(null)
    try { await took(await get()) } catch (e) { fail(step, e) }
  }

  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const topic = await require()
      const title = draft.tag.trim() || 'Scanned card'
      const source = await createSource({ text: draft.text, title, cite: draft.cite })
      // The marks count characters of the body; a card made from the whole text (no body read) has none.
      onSaved(await createCard({ text: draft.body || draft.text, title, cite: draft.cite, source, topic, spans: draft.body ? draft.spans : [] }))
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }

  const v = video.current
  return (
    <dialog ref={ref} className="sheet" onCancel={onClose}>
      <div className="sheet-inner stack">
        <div className="row">
          <h1>Scan a card</h1>
          <button className="link spacer" onClick={onClose}>close</button>
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="note" role="status">{status}</p>}
        {note && !error && <p className="note">{note}</p>}
        {step === 'camera' && (
          <div className="stack">
            <div className="scan-frame" style={{ display: live ? 'block' : 'none' }}>
              <video ref={video} playsInline muted autoPlay />
              {!!v?.videoWidth && box && (
                <svg viewBox={`0 0 ${v.videoWidth} ${v.videoHeight}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
                  <polygon points={box.map((p) => `${p.x},${p.y}`).join(' ')} />
                </svg>
              )}
            </div>
            {live && <button className="action" disabled={!!status && status !== 'Starting the scanner…'}
              onClick={() => void picture('take', () => still(video.current!))}>take the picture</button>}
            <PhotoPick take={!live} onPhoto={(f) => { setStatus('Opening the photo…'); void picture('photo', () => photoCanvas(f)) }} />
            <p>Lay the card flat in good light. Scythe finds its corners and squares it up before reading it. The photo goes to your team’s server to be read, and isn’t kept.</p>
          </div>
        )}
        {step === 'corners' && photo && (
          <div className="stack">
            <p>Drag the corners onto the card’s.</p>
            <Corners image={photo.canvas} quad={photo.quad} onChange={(quad) => setPhoto({ ...photo, quad })} />
            <div className="row">
              <button className="action" onClick={() => void read(photo.canvas, photo.quad)}>read it again</button>
              <button className="link spacer" onClick={() => void start()}>take it again</button>
            </div>
          </div>
        )}
        {step === 'reading' && !status && <p>Reading the card… this takes a few seconds.</p>}
        {step === 'draft' && draft && (
          <div className="stack">
            {preview && <img className="scan-preview" src={preview} alt="The card, squared up" />}
            <input className="field" style={{ fontWeight: 600 }} placeholder="Tag" maxLength={1000} value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} />
            <input className="field" placeholder="Cite" maxLength={2000} value={draft.cite} onChange={(e) => setDraft({ ...draft, cite: e.target.value })} />
            {/* The marks on the paper, retold as Scythe's underlines over the same words (a highlighter's is the heavy one). */}
            <div className="scan-body"><TokenText text={draft.body} spans={draft.spans ?? []} /></div>
            <p>These are the words as read from the photo{draft.spans?.length ? ', its marks underlined' : ''}. If one is misread, take the picture again: the card keeps the words exactly.</p>
            <div className="row">
              <button className="action" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save card'}</button>
              {photo && <button className="link" onClick={() => setStep('corners')}>adjust the corners</button>}
              <button className="link spacer" onClick={() => void start()}>take it again</button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}

/** The picture with the card's four corners, each draggable. */
function Corners({ image, quad, onChange }: { image: HTMLCanvasElement; quad: Quad; onChange: (q: Quad) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [src] = useState(() => image.toDataURL('image/jpeg', 0.8))
  const [drag, setDrag] = useState<number | null>(null)
  const r = Math.max(image.width, image.height) / 40

  const at = (e: React.PointerEvent): Pt | null => {
    const m = svg.current?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: Math.min(Math.max(p.x, 0), image.width), y: Math.min(Math.max(p.y, 0), image.height) }
  }

  return (
    <div className="scan-frame">
      <img src={src} alt="The picture" />
      <svg ref={svg} viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="xMidYMid meet"
        onPointerMove={(e) => { if (drag === null) return; const p = at(e); if (p) onChange(quad.map((q, i) => (i === drag ? p : q)) as Quad) }}
        onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} />
        {quad.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={r} onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setDrag(i) }} />
        ))}
      </svg>
    </div>
  )
}
