import { useState } from 'react'
import type { NameItem, SpanRec } from '../lib/doc'
import { kindOf, searchNames, whoIs, type NameState, type Verdict } from '../lib/names'
import Autocomplete from './Autocomplete'

interface Props {
  span: SpanRec
  words: string
  state: NameState
  /** Where the tip sits, under the name, in its card body's own coordinates. */
  at: { top: number; left: number }
  /** Signed in, on an open card: the four verdicts are offered. */
  canSettle: boolean
  busy: boolean
  onSettle: (verdict: Verdict, id: string | null) => void
  onClose: () => void
  onEnter: () => void
  onLeave: () => void
}

/**
 * What pointing at a name shows: its kind, who Scythe thinks it is (with a link to their Wikidata page), whether the
 * team has checked it, and the four verdicts. "It's someone else" asks who, by typing a name and choosing from the
 * team's own names and Wikidata's.
 */
export default function NameTip({ span, words, state, at, canSettle, busy, onSettle, onClose, onEnter, onLeave }: Props) {
  const [picking, setPicking] = useState(false)
  const [typed, setTyped] = useState('')
  const who = whoIs(span)
  const url = span.name?.url ?? null

  return (
    <div className="name-tip" role="group" aria-label={`Who ${words} is`} style={{ top: at.top, left: at.left }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <p>
        <span className="tip-kind">{kindOf(span)}</span>{' '}
        <span>{who ?? 'Scythe can’t say who this is.'}</span>
        {url && <>{' '}<a href={url} target="_blank" rel="noreferrer noopener">Wikidata</a></>}
        {state.here && <>{' '}<span className="tip-state">checked</span></>}
        {!state.here && state.checked && <>{' '}<span className="tip-state">{state.toCheck ? 'the team says so; confirm it for this card' : 'checked by the team'}</span></>}
        {!state.checked && state.toCheck && <>{' '}<span className="tip-state">to check</span></>}
      </p>
      {canSettle && !picking && (
        <div className="row">
          {span.name && <button className="link" disabled={busy} onClick={() => onSettle('right', span.name!.id)}>right</button>}
          <button className="link" disabled={busy} onClick={() => setPicking(true)}>it's someone else</button>
          <button className="link" disabled={busy} onClick={() => onSettle('wrong', null)}>nobody we can name</button>
          <button className="link" disabled={busy} onClick={() => onSettle('not_a_name', null)}>not a name</button>
          <button className="link" onClick={onClose} aria-label="Close">close</button>
        </div>
      )}
      {canSettle && picking && (
        <div className="gap">
          <Autocomplete<NameItem>
            label="who it is" placeholder="Type their name" autoFocus maxLength={200} minLength={2}
            value={typed} onChange={setTyped} source={(q, signal) => searchNames(q, signal)}
            itemKey={(i) => i.id} complete={(i) => i.name}
            renderItem={(i) => <><span className="ac-label">{i.name}</span>{i.description && <span className="ac-detail">{i.description}</span>}</>}
            onSelect={(i) => { setPicking(false); onSettle('wrong', i.id) }}
            emptyText="Scythe doesn’t know that name. Try another spelling." />
          <div className="row">
            <button className="link" onClick={() => setPicking(false)}>back</button>
          </div>
        </div>
      )}
    </div>
  )
}
