import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cardMarkdown, type SpanRec } from '../lib/doc'
import { nameState, type Verdict } from '../lib/names'
import { copyCard } from '../lib/render'
import { dateWords, monthOf, safeUrl, siteOf } from '../lib/text'
import type { CardDoc } from '../lib/store'
import { topicLabel } from '../lib/topic'
import NameTip from './NameTip'
import TokenText, { type NameEvent } from './TokenText'

export type CardMode = 'full' | 'read' | 'md'

interface Props {
  card: CardDoc
  mode?: CardMode
  editable?: boolean
  showEntities?: boolean
  activeKey?: string | null
  onSelect?: (range: [number, number] | null) => void
  onSpanClick?: (spans: SpanRec[]) => void
  onChange?: (patch: { title?: string; cite?: string }) => void
  /** A verdict on a name: settles it on the server and reloads the card. With it, pointing at a name shows who it is. */
  onSettle?: (span: SpanRec, verdict: Verdict, id: string | null) => Promise<void>
  mark?: [number, number] | null
  meta?: ReactNode
  link?: boolean
}

/** The name tip's place: the name it's over (by its words' range, so a reloaded card keeps it) and where it sits. */
interface Tip { start: number; end: number; at: { top: number; left: number }; pinned: boolean }

const TIP_WIDTH = 384 // the tip's max width in CSS pixels (24rem at 16px), kept inside the card body

/** The one way a card is shown: tag, cite, text, and a single brief line of facts and actions. */
export default function CardView({ card, mode = 'full', editable, showEntities, activeKey, onSelect, onSpanClick, onChange, onSettle, mark, meta, link = true }: Props) {
  const [view, setView] = useState<CardMode>(mode)
  const [copied, setCopied] = useState(false)
  const markdown = view === 'md' ? cardMarkdown(card.title, card.meta) : ''
  const original = safeUrl(card.meta.url)
  const month = monthOf(card.published)

  // Who a name is: shown while the pointer is on the name (or the tip), and kept open once the name is clicked.
  const [tip, setTip] = useState<Tip | null>(null)
  const [settling, setSettling] = useState(false)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdOpen = () => { if (closing.current) { clearTimeout(closing.current); closing.current = null } }
  const letClose = () => { holdOpen(); closing.current = setTimeout(() => setTip((t) => (t?.pinned ? t : null)), 250) }
  const place = (el: HTMLElement) => {
    const body = el.closest('.card-body') as HTMLElement | null
    const r = el.getBoundingClientRect(), b = body?.getBoundingClientRect() ?? r
    const left = Math.max(0, Math.min(r.left - b.left, (body?.clientWidth ?? TIP_WIDTH) - TIP_WIDTH))
    return { top: r.bottom - b.top + 4, left }
  }
  // Clicking a name keeps its tip open (closing is its close button or Escape), so a click never takes the tip away.
  const onName = (s: SpanRec, el: HTMLElement, how: NameEvent) => {
    if (how === 'enter') { holdOpen(); if (!tip?.pinned) setTip({ start: s.start_char, end: s.end_char, at: place(el), pinned: false }) }
    else if (how === 'leave') { if (!tip?.pinned) letClose() }
    else { holdOpen(); setTip({ start: s.start_char, end: s.end_char, at: place(el), pinned: true }) }
  }
  useEffect(() => {
    if (!tip?.pinned) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTip(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tip?.pinned])
  // The tip follows the name through a reload; a name that's gone (settled as not a name) takes its tip with it.
  const named = tip && showEntities && view !== 'md'
    ? card.meta.spans.find((s) => s.key === 'ents' && s.start_char === tip.start && s.end_char === tip.end) ?? null : null
  const settle = async (span: SpanRec, verdict: Verdict, id: string | null) => {
    if (!onSettle) return
    setSettling(true)
    try { await onSettle(span, verdict, id); setTip(null) } finally { setSettling(false) }
  }

  const copy = async () => {
    if (view === 'md') await navigator.clipboard.writeText(markdown)
    else await copyCard(card)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <article className="card">
      <h2 className="card-tag">
        {editable && onChange
          ? <input className="field" placeholder="Tag" maxLength={1000} defaultValue={card.title} key={`t${card.updated_at}`}
              onBlur={(e) => e.target.value !== card.title && onChange({ title: e.target.value })} />
          : link ? <Link to={`/cards/${card.number}`}>{card.title}</Link> : card.title}
      </h2>
      {editable && onChange
        ? <input className="field card-cite" placeholder="Cite" maxLength={2000} defaultValue={card.meta.cite} key={`c${card.updated_at}`}
            onBlur={(e) => e.target.value !== card.meta.cite && onChange({ cite: e.target.value })} />
        : card.meta.cite ? <p className="card-cite"><Cite cite={card.meta.cite} /></p> : null}
      <div className="card-body">
        {view === 'md'
          ? <pre className="md">{markdown}</pre>
          : <TokenText text={card.meta.text} spans={card.suggestions.length ? [...card.meta.spans, ...card.suggestions] : card.meta.spans} condensed={view === 'read'} editable={editable}
              showEntities={showEntities} activeKey={activeKey} onSelect={onSelect} onSpanClick={onSpanClick} mark={mark}
              names={card.names} onName={onSettle ? onName : undefined} />}
        {named && tip && (
          <NameTip span={named} words={card.meta.text.slice(named.start_char, named.end_char)} state={nameState(named, card.names)}
            at={tip.at} canSettle={!!editable && named.id !== undefined} busy={settling}
            onSettle={(verdict, id) => settle(named, verdict, id)} onClose={() => setTip(null)} onEnter={holdOpen} onLeave={() => { if (!tip.pinned) letClose() }} />
        )}
      </div>
      <div className="card-meta">
        {link ? <Link to={`/cards/${card.number}`}>#{card.number}</Link> : <span>#{card.number}</span>}
        {card.published && (month
          ? <Link to={`/search?sort=published&month=${month}`} title={`Cards published ${dateWords(month)}`}>{dateWords(card.published)}</Link>
          : <span>{dateWords(card.published)}</span>)}
        {original && <a href={original} target="_blank" rel="noreferrer noopener" title={original}>original, {siteOf(original)}</a>}
        {card.meta.topic && <Link to={`/search?topic=${card.meta.topic.slug}`} title={card.meta.topic.resolution}>{topicLabel(card.meta.topic)}</Link>}
        {card.block && <span>{card.file} / {card.block}</span>}
        {card.approved && <span>approved</span>}
        {card.state === 'closed' && <span>removed</span>}
        {meta}
        <span className="row spacer" style={{ gap: '.75rem' }}>
          {(['full', 'read', 'md'] as CardMode[]).map((m) => (
            <button key={m} className={`link ${view === m ? 'on' : ''}`} aria-pressed={view === m} onClick={() => setView(m)}>{m}</button>
          ))}
          {/* In md view the copy is the Markdown, as shown; otherwise it's the card formatted for Word. */}
          <button className="link" onClick={copy} title={view === 'md' ? 'Copy the Markdown' : 'Copy for Word, formatted'}>
            {copied ? 'copied' : view === 'md' ? 'copy md' : 'copy'}</button>
        </span>
      </div>
    </article>
  )
}

function Cite({ cite }: { cite: string }) {
  const i = cite.indexOf(',')
  if (i < 0) return <strong>{cite}</strong>
  return <><strong>{cite.slice(0, i)}</strong>{cite.slice(i)}</>
}
