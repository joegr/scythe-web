import { useEffect, useRef, useState } from 'react'
import { cameraSupported, closeCamera, createBrief, discardCard, discardPage, editCard, isMobile, kindOf, listBriefs, listCards,
  mergeCard, openCamera, readAgain, reportScan, saveBrief, saveCard, sendPage, shareCard, splitCard, stillPhoto, waitForPage, wake,
  type Brief, type Page, type ScanCard, type ScanKind } from '../lib/scan'
import { DEFAULT_LABELS, snapChars, type SpanRec } from '../lib/doc'
import { spanKey } from '../lib/store'
import { useTopic } from '../lib/topic'
import Finder from './Finder'
import PhotoPick from './PhotoPick'
import TokenText from './TokenText'

type Step = 'camera' | 'queue' | 'check' | 'corners'
const MARKS = DEFAULT_LABELS.filter((l) => ['underline', 'highlight', 'emphasis'].includes(l.style))
const KEEP_PICTURES = 60 // pictures kept on the phone (to send again, read again or drag corners), newest first; the server keeps none

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const preview = (c: ScanCard) => c.tag || c.body.split(/\s+/).slice(0, 8).join(' ') || 'Untitled'
const pagesOf = (c: ScanCard) => (c.pages.length > 1 ? `pages ${c.pages.join('–')}` : `page ${c.pages[0] ?? 1}`)
/** A tag or cite box as tall as what's in it: a long cite reads whole, not cut off at one line. */
const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }

/** Scan pages of cards into a queue, then check each card. A page is sent as soon as it's taken (a screenshot as it
 *  is, a photo of paper to be squared up) and the team's server reads it in its own queue, cutting it into its cards:
 *  nothing waits on the server here. Name a brief first and every page goes under it, in order, so a whole brief is
 *  photographed page after page; its cards wait grouped by brief, from any device. Only words wait, never a picture.
 *  On a computer the sheet opens on the queue: checking needs no camera. */
export default function Scan({ open, onClose, onSaved, onSavedBrief, start = 'camera' }:
  { open: boolean; onClose: () => void; onSaved: (card: number) => void; onSavedBrief?: (name: string) => void; start?: 'camera' | 'queue' }) {
  const ref = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const pictures = useRef(new Map<number, { blob: Blob; kind: ScanKind; url?: string }>())
  const { require } = useTopic()
  const [step, setStep] = useState<Step>(start)
  const [live, setLive] = useState(false)
  // The brief being scanned: its name as typed, and the brief itself once the first page is sent under it.
  const [briefName, setBriefName] = useState('')
  const brief = useRef<Brief | null>(null)
  const briefComing = useRef<Promise<Brief> | null>(null) // one brief, however quickly its first pages are chosen
  const nextOrdinal = useRef(1)
  // The pages sent from here (and their reading, as the server reports it), the uploads still on their way, and the
  // queue as the server has it: the cards waiting, and every brief's progress.
  const [pages, setPages] = useState<Map<number, Page>>(new Map())
  const [sending, setSending] = useState(0)
  const inFlight = useRef(0)
  const [cards, setCardList] = useState<ScanCard[]>([])
  const queue = useRef<ScanCard[]>([])
  const setCards = (next: ScanCard[]) => { queue.current = next; setCardList(next) }
  const [briefs, setBriefs] = useState<Brief[]>([])
  const [current, setCurrent] = useState<ScanCard | null>(null)
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const [active, setActive] = useState<SpanRec | null>(null)
  const [corners, setCorners] = useState<number[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // What the scanner is doing right now, in words: a step that takes a moment never looks like nothing happening.
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Help improve scanning: unticked for every card, ticked only by the member, for this card (features/19).
  const [share, setShare] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  useEffect(() => { setShare(false); setFixing(null) }, [current?.id])
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
  const keep = (id: number, blob: Blob, kind: ScanKind) => {
    const old = pictures.current.get(id)
    if (old?.url) URL.revokeObjectURL(old.url)
    pictures.current.delete(id)
    pictures.current.set(id, { blob, kind })
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

  const check = (c: ScanCard) => {
    stop(); setCurrent(c); setSelection(null); setActive(null); setError(null); setStep('check')
  }
  /** The queue as the server has it now. */
  const refresh = async () => {
    const [cs, bs] = await Promise.all([listCards(), listBriefs()])
    setCards(cs); setBriefs(bs)
    return cs
  }

  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) {
      d.showModal()
      setCards([]); setBriefs([]); setCurrent(null); setPages(new Map()); inFlight.current = 0; setSending(0)
      brief.current = null; briefComing.current = null; nextOrdinal.current = 1; setBriefName('')
      refresh().catch((e) => fail('queue', e))
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
  // Pages sent here keep the phone from leaving while they're on their way or being read.
  useEffect(() => {
    if (!open) return
    const unread = [...pages.values()].some((p) => p.status === 'queued' || p.status === 'reading')
    if (!unread && inFlight.current === 0) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [open, pages, sending])
  const waiting = () => setStatus('Waking up your team’s Scythe… this takes a few seconds.')

  const notePage = (p: Page) => setPages((m) => new Map(m).set(p.id, p))
  /** Follow a page until it's read: then the queue is asked again, and in regular mode (no brief) a first page read
   *  with nothing else waiting opens its first card straight away. */
  const watch = async (page: Page) => {
    try {
      const done = await waitForPage(page.id, notePage)
      const cs = await refresh()
      // A page read with nothing else waiting opens its first card; with other cards waiting, the strip says so.
      if (done.status === 'read' && !done.brief && inFlight.current === 0 && step !== 'check') {
        const mine = cs.filter((c) => done.cards.includes(c.id))
        if (mine.length && cs.length === mine.length) check(mine[0])
      }
    } catch (e) { fail('page', e) }
  }

  /** Send a picture to be read. The camera stays ready for the next page. */
  const send = async (where: string, get: () => Promise<{ blob: Blob; kind: ScanKind; corners?: number[] }>) => {
    setError(null)
    setSending(++inFlight.current)
    try {
      const { blob, kind, corners } = await get()
      const name = briefName.trim()
      if (name && !brief.current) {
        briefComing.current ??= createBrief(name).then((b) => { brief.current = b; nextOrdinal.current = 1; return b })
        await briefComing.current
      }
      const b = name ? brief.current : null
      const ordinal = b ? nextOrdinal.current++ : undefined
      setStatus(b ? `Sending page ${ordinal} of ${b.name}…` : kind === 'screenshot' ? 'Sending the screenshot…' : 'Sending the photo…')
      const page = await sendPage(blob, kind, { brief: b?.id, ordinal, corners, onWait: waiting })
      keep(page.id, blob, kind)
      notePage(page)
      setStatus(null)
      setSending(--inFlight.current)
      void watch(page)
    } catch (e) {
      setSending(--inFlight.current)
      fail(where, e)
    }
  }
  // The corners the finder held steady go with the photo, so the server squares it up to them.
  const take = (quad?: number[]) => void send('take', async () => ({ blob: await stillPhoto(video.current!), kind: 'photo', corners: quad }))
  const chose = (f: File) => void send('photo', async () => ({ blob: f, kind: await kindOf(f) }))

  /** Send a page again from the picture still on this phone: a page that wasn't read, or the current card's page as
   *  the other kind or from dragged corners. Its cards are replaced once it's read. */
  const again = async (pageId: number, kind: ScanKind, from?: number[]) => {
    const p = pictures.current.get(pageId)
    if (!p) return
    setError(null); setStatus(kind === 'screenshot' ? 'Reading it as a screenshot…' : 'Squaring the page up and reading it…')
    try {
      const page = await readAgain(pageId, p.blob, kind, { corners: from, onWait: waiting })
      pictures.current.set(pageId, { ...p, kind })
      notePage(page)
      setStatus(null)
      const done = await waitForPage(page.id, notePage)
      const cs = await refresh()
      const first = cs.find((c) => done.cards.includes(c.id))
      if (done.status === 'failed') setError(done.error)
      if (first) check(first)
      else if (step === 'check' || step === 'corners') setStep('queue')
    } catch (e) { fail('again', e) }
  }
  const drop = async (pageId: number) => {
    try {
      await discardPage(pageId)
      setPages((m) => { const n = new Map(m); n.delete(pageId); return n })
      pictures.current.delete(pageId)
      await refresh()
    } catch (e) { fail('drop', e) }
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

  const patch = (c: ScanCard) => editCard(c.id, { tag: c.tag, cite: c.cite, spans: c.spans.map((s) => ({ style: s.style, start_char: s.start_char, end_char: s.end_char })) })
  /** Approve: the card's tag, cite and marks go to the server, which makes what was read the card's source and cuts
   *  the card from it word for word, with its marks; a card from a brief carries the brief and its pages. */
  const save = async () => {
    const c = current
    if (!c || saving) return
    setSaving(true); setError(null)
    try {
      await patch(c)
      const topic = await require()
      const p = pictures.current.get(c.page)
      let shared: string | null = null
      if (share && p) {
        try { await shareCard(c.id, p.blob); shared = 'Thanks: the picture and your checked words will help improve scanning.' }
        catch (e) { shared = (e as Error).message }
      }
      const { card } = await saveCard(c.id, topic)
      if (shared) setStatus(shared)
      setCards(queue.current.filter((x) => x.id !== c.id))
      onSaved(card)
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  /** Every card of the brief, saved as it is. */
  const saveAll = async (b: Brief) => {
    if (saving) return
    setSaving(true); setError(null)
    try {
      const topic = await require()
      await saveBrief(b.id, topic)
      await refresh()
      if (onSavedBrief) onSavedBrief(b.name)
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  const discard = async () => {
    const c = current
    if (!c) return
    try {
      await discardCard(c.id)
      const rest = queue.current.filter((x) => x.id !== c.id)
      setCards(rest); setCurrent(null)
      if (rest.length) setStep('queue')
      else void camera()
    } catch (e) { fail('discard', e) }
  }
  /** Words OCR misread, fixed to what's printed: the card and its source are the fixed words, its marks stay. */
  const fixWords = async () => {
    const c = current
    if (!c || !selection || fixing === null || !fixing.trim()) return
    try {
      await patch(c)
      const d = await editCard(c.id, { fix: { start_char: selection[0], end_char: selection[1], text: fixing } })
      setCards(queue.current.map((x) => (x.id === d.id ? d : x)))
      setCurrent(d); setSelection(null); setFixing(null)
    } catch (e) { fail('fix', e) }
  }
  /** The words from the selection on become a card of their own, after this one. */
  const split = async () => {
    const c = current
    if (!c || !selection) return
    try {
      await patch(c)
      const [a, b] = await splitCard(c.id, selection[0])
      setCards(queue.current.flatMap((x) => (x.id === a.id ? [a, b] : [x])))
      setSelection(null); setCurrent(a)
    } catch (e) { fail('split', e) }
  }
  /** The next card's words join this one. */
  const join = async () => {
    const c = current
    if (!c) return
    try {
      await patch(c)
      const m = await mergeCard(c.id)
      await refresh()
      setCurrent(m)
    } catch (e) { fail('join', e) }
  }

  // Progress, in words: the pages sent from here, and the cards waiting on the server.
  const sent = [...pages.values()]
  const read = sent.filter((p) => p.status === 'read').length
  const failed = sent.filter((p) => p.status === 'failed')
  const unread = sent.filter((p) => p.status === 'queued' || p.status === 'reading').length
  const waitingCount = cards.length
  const briefMode = !!briefName.trim()
  const strip = (sending > 0 || sent.length > 0 || waitingCount > 0) && (
    <div className="stack">
      <p className="row">
        <span>
          {briefMode && sent.length > 0 ? `${read} of ${sent.length} pages read` : unread > 0 ? `Reading ${unread === 1 ? 'the page' : `${unread} pages`}…` : ''}
          {sending > 0 ? `${read > 0 || unread > 0 ? ' · ' : ''}sending ${sending === 1 ? 'a page' : `${sending} pages`}` : ''}
          {waitingCount > 0 ? `${read > 0 || unread > 0 || sending > 0 ? ' · ' : ''}${waitingCount} to check` : ''}
        </span>
        {waitingCount > 0 && <button className="link spacer" onClick={() => { if (waitingCount === 1) check(cards[0]); else { stop(); setStep('queue') } }}>check {waitingCount === 1 ? 'it' : 'them'}</button>}
      </p>
      {failed.map((p) => (
        <p key={p.id} className="error row">
          <span>Page {p.ordinal} wasn’t read: {p.error}</span>
          {pictures.current.has(p.id) && <button className="link" onClick={() => void again(p.id, pictures.current.get(p.id)!.kind)}>send it again</button>}
          <button className="link" onClick={() => void drop(p.id)}>drop it</button>
        </p>
      ))}
    </div>
  )
  // The queue, card-first: each brief's cards under its name, in page order; then pages scanned on their own.
  const groups: { brief: ScanCard['brief']; cards: ScanCard[] }[] = []
  for (const c of cards) {
    const last = groups[groups.length - 1]
    if (last && (last.brief?.id ?? null) === (c.brief?.id ?? null)) last.cards.push(c)
    else groups.push({ brief: c.brief, cards: [c] })
  }
  const progress = (id: number) => briefs.find((b) => b.id === id)
  const c = current
  const kept = c ? pictures.current.has(c.page) : false
  const keptForTraining = c ? Boolean(pages.get(c.page)?.kept) : false
  return (
    <dialog ref={ref} className="sheet" onCancel={onClose}>
      <div className="sheet-inner stack">
        <div className="row">
          <h1>{step === 'camera' ? (briefMode ? 'Scan a brief' : 'Scan a card') : step === 'queue' ? 'Cards to check' : step === 'corners' ? 'The page’s corners' : 'Check the card'}</h1>
          <button className="link spacer" onClick={onClose}>close</button>
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="note" role="status">{status}</p>}
        {step === 'camera' && (
          <div className="stack">
            <input className="field" placeholder="Brief (leave empty for a page on its own)" maxLength={300} value={briefName}
              disabled={!!brief.current} onChange={(e) => setBriefName(e.target.value)} />
            <div className="scan-frame" style={{ display: live ? 'block' : 'none' }}>
              <video ref={video} playsInline muted autoPlay />
              <Finder video={video} live={live && step === 'camera'} onSteady={take} />
            </div>
            {live && <button className="action" onClick={() => take()}>take the picture</button>}
            {/* The camera is Scythe's own, above: never the phone's camera app. */}
            <PhotoPick take={false} onPhoto={chose} />
            {strip}
            <p>{briefMode
              ? `Photograph the brief page after page: each page is sent as soon as it’s taken, and read while you take the next. Its cards wait under “${briefName.trim()}”, in page order, to be checked here or on any device.`
              : 'Lay the page flat in good light, on something darker than the paper, and fit it in the frame: once it holds still the picture is taken by itself. Or choose a screenshot. Your team’s server squares a photo up to the page’s corners, reads it and cuts it into its cards; a screenshot it reads as it is. Neither is kept: only the words wait for you to check, unless you choose to share a card’s picture to help improve scanning when you save it.'}</p>
          </div>
        )}
        {step === 'queue' && (
          <div className="stack">
            {(unread > 0 || sending > 0) && <p className="note">{sending > 0 ? `Sending ${sending === 1 ? 'a page' : `${sending} pages`}… ` : ''}{unread > 0 ? `Reading ${unread === 1 ? 'a page' : `${unread} pages`}…` : ''}</p>}
            {cards.length === 0 && unread === 0 && sending === 0 && <p>Nothing to check.</p>}
            {groups.map((g) => {
              const b = g.brief ? progress(g.brief.id) : null
              return (
                <div key={g.brief?.id ?? 'loose'} className="scan-group">
                  {g.brief && (
                    <h2 className="row">
                      <span>{g.brief.name}</span>
                      {b && <span className="note">{b.read} of {b.pages.length} pages read{b.failed ? `, ${b.failed} not read` : ''}</span>}
                      {b && b.queued === 0 && <button className="link spacer" disabled={saving} onClick={() => void saveAll(b)}>save all {g.cards.length}</button>}
                    </h2>
                  )}
                  <ul className="scan-queue">
                    {g.cards.map((x) => (
                      <li key={x.id}>
                        <button className="link" onClick={() => check(x)}>{preview(x)}</button>
                        <span className="note"> · {g.brief ? pagesOf(x) : x.kind === 'screenshot' ? 'screenshot' : 'photo'} · {ago(x.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
            {scanner && <p><button className="link" onClick={() => void camera()}>scan another</button></p>}
          </div>
        )}
        {step === 'check' && c && (
          <div className="stack scan-check">
            <p className="note">{c.kind === 'screenshot' ? 'Read as a screenshot.' : 'Squared up from a photo of paper.'}
              {c.brief && <> {pagesOf(c)[0].toUpperCase() + pagesOf(c).slice(1)} of {c.brief.name}.</>}
              {c.continues && <> Continued from the page before.</>}
              {kept && <> <button className="link" onClick={() => void again(c.page, c.kind === 'screenshot' ? 'photo' : 'screenshot')}>
                read the page as a {c.kind === 'screenshot' ? 'photo' : 'screenshot'} instead</button></>}</p>
            {/* The card as it will be saved: its tag, cite and words, the whole screen on a phone. */}
            <article className="card scan-card">
              <textarea className="card-tag scan-line" rows={1} ref={grow} placeholder="Tag" maxLength={300} value={c.tag}
                onChange={(e) => { grow(e.currentTarget); setCurrent({ ...c, tag: e.target.value.replace(/\n/g, ' ') }) }} />
              <textarea className="card-cite scan-line" rows={1} ref={grow} placeholder="Cite" maxLength={2000} value={c.cite}
                onChange={(e) => { grow(e.currentTarget); setCurrent({ ...c, cite: e.target.value.replace(/\n/g, ' ') }) }} />
              {/* The marks on the paper, retold as Scythe's underlines over the same words (a highlighter's is the heavy one). */}
              <div className="card-body scan-body">
                <TokenText text={c.body} spans={c.spans} editable mark={selection} activeKey={active ? spanKey(active) : null}
                  onSelect={(r) => { const s = r ? snapChars(c.body, r[0], r[1]) : null; setSelection(s); if (s) setActive(null) }} onSpanClick={pick} />
              </div>
            </article>
            <p className="note">These are the words as read{c.spans.length ? ', with their marks' : ''}, {c.words} of them. Select words to underline, highlight or emphasize them; tap a mark to remove it. If the page was read as one card where there were two, select the first words of the second and split it; if a card was cut in two, join them. If a word is misread, select it and fix it to what’s printed: the card is its words as you fix them.</p>
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
              <button className="link" disabled={!selection} onMouseDown={(e) => e.preventDefault()} onClick={() => void split()}>split here</button>
              <button className="link" onClick={() => void join()}>join with the next</button>
              <button className="link" disabled={!selection} onMouseDown={(e) => e.preventDefault()}
                onClick={() => selection && setFixing(c.body.slice(selection[0], selection[1]))}>fix the words</button>
              {c.kind === 'photo' && kept && <button className="link" onClick={() => { setCorners(c.corners ?? [0, 0, 1, 0, 1, 1, 0, 1]); setStep('corners') }}>adjust the corners</button>}
            </div>
            {fixing !== null && selection && (
              <div className="row">
                <input className="field" aria-label="What’s printed" maxLength={200} value={fixing} autoFocus
                  onChange={(e) => setFixing(e.target.value.replace(/\n/g, ' '))} onKeyDown={(e) => { if (e.key === 'Enter') void fixWords() }} />
                <button className="link" disabled={!fixing.trim()} onClick={() => void fixWords()}>fix</button>
                <button className="link" onClick={() => setFixing(null)}>cancel</button>
              </div>
            )}
            {keptForTraining
              ? <p className="note">This team keeps scanned pictures to improve scanning: this page’s is kept, with the words you check.</p>
              : kept
              ? <label className="row note"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
                  Help improve scanning: send this picture and the words I checked to Scythe.</label>
              : <p className="note">This page’s picture isn’t on this device, so it can’t be shared to help improve scanning.</p>}
            <div className="row">
              <button className="action" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save card'}</button>
              <button className="link" onClick={() => void discard()}>discard</button>
              {cards.length > 1 && <button className="link spacer" onClick={() => setStep('queue')}>all cards</button>}
              {scanner && cards.length <= 1 && <button className="link spacer" onClick={() => void camera()}>scan another</button>}
            </div>
            </div>
          </div>
        )}
        {step === 'corners' && c && corners && pictureUrl(c.page) && (
          <div className="stack">
            <p>Drag the corners onto the page’s.</p>
            <Corners src={pictureUrl(c.page)!} corners={corners} onChange={setCorners} />
            <div className="row">
              <button className="action" onClick={() => void again(c.page, 'photo', corners)}>read it again</button>
              <button className="link spacer" onClick={() => setStep('check')}>back</button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}

/** The picture with the page's four corners (fractions of the upright picture), each draggable. */
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
