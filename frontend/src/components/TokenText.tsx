import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { NameRec, SpanRec } from '../lib/doc'
import { snapChars } from '../lib/doc'
import { kindOf, nameState, whoIs } from '../lib/names'
import { paragraphs, segments, selectionRange, showSelection } from '../lib/render'
import { spanKey } from '../lib/store'

/** Pointing at a name, leaving it, or choosing it: the page shows who it is and takes a verdict. */
export type NameEvent = 'enter' | 'leave' | 'click'

interface Props {
  text: string
  spans: SpanRec[]
  condensed?: boolean
  editable?: boolean
  showEntities?: boolean
  activeKey?: string | null
  onSelect?: (range: [number, number] | null) => void
  onSpanClick?: (spans: SpanRec[], e: MouseEvent) => void
  /** The names the team settled on this card (null on a card cut before names were checked): draws each name as
   *  checked or still to check. */
  names?: NameRec[] | null
  onName?: (span: SpanRec, el: HTMLElement, how: NameEvent) => void
  mark?: [number, number] | null
}

const STYLE_CLASS: Record<string, string> = { underline: 't-u', highlight: 't-hl', emphasis: 't-em' }

/** The selection, grown to the whole tokens it touches and shown that way on screen. */
function snapShown(el: HTMLElement, text: string): [number, number] | null {
  const r = selectionRange(el)
  const s = r && snapChars(text, r[0], r[1])
  if (s) showSelection(el, s)
  return s
}

/** Card text with formatting drawn as underlines only (thin / heavy / double). */
export default function TokenText({ text, spans, condensed: readAloud, editable, showEntities, activeKey, onSelect, onSpanClick, names, onName, mark }: Props) {
  // Read-aloud keeps only the marked words; a card with nothing marked yet shows all of its words instead of none.
  const condensed = readAloud && spans.some((s) => s.key !== 'ents' && s.id === undefined)
  const visible = useMemo(() => spans.filter((s) => s.key !== 'ents' || showEntities), [spans, showEntities])
  const all = useMemo(() => (mark ? [...visible, { key: '_mark', label: '', style: '', src: '', start_char: mark[0], end_char: mark[1] }] : visible), [visible, mark])

  // Drawing the marked range replaces the text the browser's selection was in, so show it again after each draw.
  const box = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
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
          const own: string[] = [] // a team's own marks here, named by the page's tip when pointed at
          let suggested: string | undefined
          let name: SpanRec | undefined
          for (const s of real) {
            if (s.key === 'ents') {
              // Pointing at a name says who it is (or its kind) in the page's own tip, so no browser tooltip doubles it.
              cls.add('t-ner')
              const state = nameState(s, names)
              if (state.checked) cls.add('checked')
              if (state.toCheck) cls.add('to-check')
              if (!onName) titles.push(whoIs(s) ?? kindOf(s))
              name ??= s
            } else if (s.id !== undefined) {
              cls.add('t-suggested'); suggested ??= s.label; titles.push(`suggested ${s.label}`)
            } else {
              cls.add(STYLE_CLASS[s.style] ?? 't-custom')
              if (!STYLE_CLASS[s.style]) own.push(s.label)
            }
          }
          if (activeKey && real.some((s) => spanKey(s) === activeKey)) cls.add('t-active')
          if (seg.spans.some((s) => s.key === '_mark')) cls.add('t-mark')
          const marks = real.some((s) => s.key !== 'ents') && onSpanClick ? real : null
          const named = name && onName ? name : null
          children.push(
            <span key={seg.start} data-start={seg.start} data-span={marks || named ? '' : undefined} data-label={suggested}
              className={[...cls].join(' ') || undefined} title={titles.join(' · ') || undefined}
              onClick={marks || named ? (e) => { if (named) onName!(named, e.currentTarget, 'click'); if (marks) onSpanClick!(marks, e) } : undefined}
              onMouseEnter={named || own.length ? (e) => {
                if (named) onName!(named, e.currentTarget, 'enter')
                if (own.length) { const r = e.currentTarget.getBoundingClientRect(); setTip({ text: own.join(' · '), x: r.left, y: r.top }) }
              } : undefined}
              onMouseLeave={named || own.length ? (e) => { if (named) onName!(named, e.currentTarget, 'leave'); setTip(null) } : undefined}>
              {seg.text}
            </span>,
          )
        }
        return condensed && shown === 0 ? null : <p key={lo}>{children}</p>
      })}
      {/* Outside the words' own spans, so it never counts as card text. */}
      {tip && <span role="tooltip" className="mark-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>}
    </div>
  )
}
