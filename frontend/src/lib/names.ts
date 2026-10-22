/** Names in a card: what spaCy's labels are called, what pointing at one says, and whether the team settled it. */
import type { NameRec, SpanRec } from './doc'

/** spaCy's entity labels, said plainly. */
export const ENTITY_WORDS: Record<string, string> = {
  PERSON: 'Person', ORG: 'Organization', GPE: 'Place', LOC: 'Place', FAC: 'Place', NORP: 'Group', DATE: 'Date', TIME: 'Time',
  MONEY: 'Money', PERCENT: 'Percent', QUANTITY: 'Quantity', CARDINAL: 'Number', ORDINAL: 'Number', EVENT: 'Event', LAW: 'Law',
  WORK_OF_ART: 'Work', PRODUCT: 'Product', LANGUAGE: 'Language',
}

/** The kinds of name a new card can't be approved with until they're settled (the server's names.KINDS). */
export const CHECKED_KINDS = new Set(['PERSON', 'ORG', 'GPE', 'LOC', 'FAC', 'NORP', 'LAW', 'EVENT'])

/** What pointing at a name says: who it is ("Barack Obama: 44th president of the United States"), or its kind. */
export const nameTitle = (s: SpanRec) =>
  s.name ? (s.name.description ? `${s.name.name}: ${s.name.description}` : s.name.name) : ENTITY_WORDS[s.label] ?? s.label

/** A name's place in settling: checked (the team settled it), to check (a guess a new card waits on), or neither (a card
 *  cut before names were checked, or a date or number). */
export function nameState(s: SpanRec, names: NameRec[] | null | undefined): 'checked' | 'to-check' | null {
  if (!names) return null
  if (names.some((nm) => nm.start_char === s.start_char && nm.end_char === s.end_char)) return 'checked'
  return s.src === 'ner' && CHECKED_KINDS.has(s.label) ? 'to-check' : null
}
