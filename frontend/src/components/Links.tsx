import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LINK_WORDS } from '../lib/doc'
import { backlinks, ops, searchCards, type CardDoc, type Found, type Op } from '../lib/store'
import Autocomplete from './Autocomplete'

const RELATIONS = ['answers', 'supports', 'contradicts', 'elaborates', 'same_claim', 'quotes', 'cites', 'derived_from', 'related']

/** A link seen from the card it points to, as a sentence: "Winter models overstate soot answers this card". */
const FROM_THE_OTHER_SIDE: Record<string, string> = {
  answers: 'answers this card', supports: 'supports this card', contradicts: 'contradicts this card',
  elaborates: 'elaborates on this card', same_claim: 'makes the same claim', quotes: 'quotes this card',
  cites: 'cites this card', derived_from: 'was cut from this card', related: 'is related to this card',
}

/** A card's typed links (committed in its file, "Answers #12" in its issue) and the cards linking to it. */
export default function Links({ card, commit, canEdit }: { card: CardDoc; commit: (op: Op) => void; canEdit: boolean }) {
  const [incoming, setIncoming] = useState<{ rel: string; card: CardDoc }[]>([])
  const [relation, setRelation] = useState('answers')
  const [q, setQ] = useState('')

  useEffect(() => {
    let live = true
    backlinks(card.number).then((b) => { if (live) setIncoming(b) }).catch(() => { if (live) setIncoming([]) })
    return () => { live = false }
  }, [card.number])

  return (
    <section className="gap">
      <h3>Links</h3>
      {card.meta.links.length === 0 && incoming.length === 0 && <p>Nothing linked yet.</p>}
      <ul className="list">
        {card.meta.links.map((l) => (
          <li key={`${l.rel}-${l.to}`} className="row">
            <span>{LINK_WORDS[l.rel] ?? l.rel}</span><Link to={`/cards/${l.to}`}>#{l.to}</Link>
            {canEdit && <button className="link spacer" onClick={() => commit(ops.unlink(l))}>unlink</button>}
          </li>
        ))}
        {incoming.map((i) => (
          <li key={`in-${i.card.number}-${i.rel}`} className="row">
            <span><Link to={`/cards/${i.card.number}`}>{i.card.title}</Link> {FROM_THE_OTHER_SIDE[i.rel] ?? `${(LINK_WORDS[i.rel] ?? i.rel).toLowerCase()} this card`}</span>
          </li>
        ))}
      </ul>
      {incoming.some((i) => i.rel === 'answers') && <Link className="link" to={`/print/${card.number}/frontlines`}>print frontlines (this card and its answers)</Link>}
      {canEdit && (
        <>
          <div className="row">
            <select className="field" style={{ width: 'auto' }} value={relation} onChange={(e) => setRelation(e.target.value)}>
              {RELATIONS.map((r) => <option key={r} value={r}>{LINK_WORDS[r]}</option>)}
            </select>
            <div style={{ flex: 1, minWidth: '12rem' }}>
              <Autocomplete<Found> label="Search cards to link" placeholder="Search cards to link…" value={q} onChange={setQ}
                source={async (text, signal) => (await searchCards(text, { limit: 7, signal })).filter((f) => f.card.number !== card.number)}
                itemKey={(f) => f.card.number}
                renderItem={(f) => <span className="ac-label">{LINK_WORDS[relation]} #{f.card.number} {f.card.title}</span>}
                onSelect={(f) => { commit(ops.link(relation, f.card.number)); setQ('') }}
                emptyText="No cards with those words." />
            </div>
          </div>
        </>
      )}
    </section>
  )
}
