import { useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react'
import type { SpanRec } from '../lib/doc'
import { snapChars } from '../lib/doc'
import { paragraphs, segments, selectionRange, showSelection } from '../lib/render'
import { spanKey } from '../lib/store'

interface Props {
  text: string
  spans: SpanRec[]
  condensed?: boolean
  editable?: boolean
  showEntities?: boolean
  activeKey?: string | null
  onSelect?: (range: [number, number] | null) => void
  onSpanClick?: (spans: SpanRec[], e: MouseEvent) => void
  mark?: [number, number] | null
}

const STYLE_CLASS: Record<string, string> = { underline: 't-u', highlight: 't-hl', emphasis: 't-em' }
/** spaCy's entity labels, said plainly. */
const ENTITY_WORDS: Record<string, string> = {
  PERSON: 'Person', ORG: 'Organization', GPE: 'Place', LOC: 'Place', FAC: 'Place', NORP: 'Group', DATE: 'Date', TIME: 'Time',
  MONEY: 'Money', PERCENT: 'Percent', QUANTITY: 'Quantity', CARDINAL: 'Number', ORDINAL: 'Number', EVENT: 'Event', LAW: 'Law',
  WORK_OF_ART: 'Work', PRODUCT: 'Product', LANGUAGE: 'Language',
}

/** The selection, grown to the whole tokens it touches and shown that way on screen. */
function snapShown(el: HTMLElement, text: string): [number, number] | null {
  const r = selectionRange(el)
  const s = r && snapChars(text, r[0], r[1])
  if (s) showSelection(el, s)
  return s
}

/** Card text with formatting drawn as underlines only (thin / heavy / double). */
export default function TokenText({ text, spans, condensed, editable, showEntities, activeKey, onSelect, onSpanClick, mark }: Props) {
  const visible = useMemo(() => spans.filter((s) => s.key !== 'ents' || showEntities), [spans, showEntities])
  const all = useMemo(() => (mark ? [...visible, { key: '_mark', label: '', style: '', src: '', start_char: mark[0], end_char: mark[1] }] : visible), [visible, mark])

  // Drawing the marked range replaces the text the browser's selection was in, so show it again after each draw.
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (editable && mark && box.current && window.getSelection()?.isCollapsed !== false) showSelection(box.current, mark)
  }, [editable, mark])

  return (
    <div ref={box} className={`token-text${editable ? ' editable' : ''}`}
      onMouseUp={editable && onSelect ? (e) => onSelect(snapShown(e.currentTarget, text)) : undefined}
      onTouchEnd={editable && onSelect ? (e) => { const el = e.currentTarget; setTimeout(() => onSelect(snapShown(el, text))) } : undefined}>
      {paragraphs(text).map(([lo, hi]) => {
        const children: React.ReactNode[] = []
        let elided = false
        let shown = 0
        for (const seg of segments(text, all, lo, hi)) {
          const real = seg.spans.filter((s) => s.key !== '_mark')
          const formatted = real.some((s) => s.key !== 'ents')
          if (condensed && !formatted) {
            if (!elided) children.push(<span key={seg.start}> … </span>)
            elided = true
            continue
          }
          elided = false
          shown++
          const cls = new Set<string>()
          const titles: string[] = []
          let suggested: string | undefined
          for (const s of real) {
            if (s.key === 'ents') { cls.add('t-ner'); titles.push(ENTITY_WORDS[s.label] ?? s.label) } else if (s.id !== undefined) {
              cls.add('t-suggested'); suggested ??= s.label; titles.push(`suggested ${s.label}`)
            } else {
              cls.add(STYLE_CLASS[s.style] ?? 't-custom')
              if (!STYLE_CLASS[s.style]) titles.push(s.label)
            }
          }
          if (activeKey && real.some((s) => spanKey(s) === activeKey)) cls.add('t-active')
          if (seg.spans.some((s) => s.key === '_mark')) cls.add('t-mark')
          children.push(
            <span key={seg.start} data-start={seg.start} data-span={real.length && onSpanClick ? '' : undefined} data-label={suggested}
              className={[...cls].join(' ') || undefined} title={titles.join(' · ') || undefined}
              onClick={real.length && onSpanClick ? (e) => onSpanClick(real, e) : undefined}>
              {seg.text}
            </span>,
          )
        }
        return condensed && shown === 0 ? null : <p key={lo}>{children}</p>
      })}
    </div>
  )
}
