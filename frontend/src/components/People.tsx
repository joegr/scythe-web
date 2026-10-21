import { Link } from 'react-router-dom'
import type { CardMeta } from '../lib/doc'
import type { CardDoc } from '../lib/store'

/** Each person Scythe found in the card's words, once, in the order they appear. */
function peopleIn(meta: CardMeta): string[] {
  const seen = new Set<string>()
  return meta.spans
    .filter((s) => s.key === 'ents' && s.label === 'PERSON')
    .sort((a, b) => a.start_char - b.start_char)
    .map((s) => meta.text.slice(s.start_char, s.end_char).trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
}

/** The people Scythe found in the card, each a link to every card by or naming them. */
export function People({ card }: { card: CardDoc }) {
  const people = peopleIn(card.meta)
  if (!people.length) return null
  return (
    <p>People: {people.map((p, i) => (
      <span key={p}>{i > 0 && ' · '}<Link to={`/search?person=${encodeURIComponent(p)}`}>{p}</Link></span>
    ))}</p>
  )
}
