import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { NameItem, NameRec, SpanRec } from '../lib/doc'
import { ENTITY_WORDS, nameState, nameTitle } from '../lib/names'
import { searchNames, type Verdict } from '../lib/store'
import Autocomplete from './Autocomplete'

interface Props {
  span: SpanRec
  words: string
  /** The name's words on screen: the card sits under them (on a touch screen, it's a sheet at the bottom instead). */
  anchor: HTMLElement
  names: NameRec[] | null
  /** Signed in, and the card can be changed: the four verdicts show. */
  canSettle: boolean
  busy: boolean
  onSettle: (verdict: Verdict, id?: string) => void
  onClose: () => void
  onPointer: (inside: boolean) => void
}

/** Who a name is, with its Wikidata page, and the team's four verdicts on it: right, someone else, nobody we can name,
 *  not a name. A verdict holds for every card that names them. */
export default function NameCard({ span, words, anchor, names, canSettle, busy, onSettle, onClose, onPointer }: Props) {
  const [someone, setSomeone] = useState(false)
  const [who, setWho] = useState('')
  const state = nameState(span, names)
  const r = anchor.getBoundingClientRect()
  const x = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 8 - 22 * 16))
  const y = r.bottom + window.scrollY + 6

  return createPortal(
    <div className="name-card" role="dialog" aria-label={`Who “${words}” is`}
      style={{ '--x': `${x}px`, '--y': `${y}px` } as React.CSSProperties}
      onMouseEnter={() => onPointer(true)} onMouseLeave={() => onPointer(false)}>
      <p>
        {span.name ? nameTitle(span) : `${ENTITY_WORDS[span.label] ?? span.label}: Scythe hasn't said who “${words}” is.`}
        {span.name?.url && <> <a href={span.name.url} target="_blank" rel="noreferrer noopener">on Wikidata</a></>}
      </p>
      {state && <p>{state === 'checked' ? 'Checked.' : 'To check: is this who it is?'}</p>}
      {canSettle && (
        <div className="row">
          <button className="link" disabled={busy || !span.name} onClick={() => onSettle('right')}>right</button>
          <button className={`link ${someone ? 'on' : ''}`} aria-pressed={someone} disabled={busy} onClick={() => setSomeone(!someone)}>it's someone else</button>
          <button className="link" disabled={busy} onClick={() => onSettle('wrong')}>nobody we can name</button>
          <button className="link" disabled={busy} onClick={() => onSettle('not_a_name')}>not a name</button>
        </div>
      )}
      {canSettle && someone && (
        <Autocomplete<NameItem> label="who it is" placeholder="Who it is: type a name" value={who} onChange={setWho} autoFocus
          source={searchNames} itemKey={(i) => i.id} minLength={2} emptyText="Nobody by that name."
          renderItem={(i) => (i.description ? `${i.name}: ${i.description}` : i.name)}
          onSelect={(i) => { setWho(i.name); onSettle('wrong', i.id) }} />
      )}
      <div className="row"><button className="link spacer" onClick={onClose}>close</button></div>
    </div>,
    document.body,
  )
}
