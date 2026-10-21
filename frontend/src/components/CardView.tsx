import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cardMarkdown, type SpanRec } from '../lib/doc'
import { copyCard } from '../lib/render'
import { dateWords, monthOf, safeUrl, siteOf } from '../lib/text'
import type { CardDoc } from '../lib/store'
import { topicLabel } from '../lib/topic'
import TokenText from './TokenText'

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
  mark?: [number, number] | null
  meta?: ReactNode
  link?: boolean
}

/** The one way a card is shown: tag, cite, text, and a single brief line of facts and actions. */
export default function CardView({ card, mode = 'full', editable, showEntities, activeKey, onSelect, onSpanClick, onChange, mark, meta, link = true }: Props) {
  const [view, setView] = useState<CardMode>(mode)
  const [copied, setCopied] = useState(false)
  const markdown = view === 'md' ? cardMarkdown(card.title, card.meta) : ''
  const original = safeUrl(card.meta.url)
  const month = monthOf(card.published)

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
              showEntities={showEntities} activeKey={activeKey} onSelect={onSelect} onSpanClick={onSpanClick} mark={mark} />}
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
