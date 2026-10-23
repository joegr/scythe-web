/**
 * Who a card names (features/23): what pointing at a name says, whether the team has settled it, and the verdicts.
 * A verdict goes to the server as one of its three (right / wrong / not a name); the screen offers four, since
 * "wrong" means either someone else (with who) or nobody we can name (with no one).
 */
import { api } from './api'
import type { NameItem, NameRec, SpanRec } from './doc'

/** spaCy's entity labels, said plainly. */
export const ENTITY_WORDS: Record<string, string> = {
  PERSON: 'Person', ORG: 'Organization', GPE: 'Place', LOC: 'Place', FAC: 'Place', NORP: 'Group', DATE: 'Date', TIME: 'Time',
  MONEY: 'Money', PERCENT: 'Percent', QUANTITY: 'Quantity', CARDINAL: 'Number', ORDINAL: 'Number', EVENT: 'Event', LAW: 'Law',
  WORK_OF_ART: 'Work', PRODUCT: 'Product', LANGUAGE: 'Language',
}
export const kindOf = (s: SpanRec) => ENTITY_WORDS[s.label] ?? s.label

/** The kinds of name a new card can't be approved with until they're settled (the server's names.KINDS). */
const CHECKED_KINDS = new Set(['PERSON', 'ORG', 'GPE', 'LOC', 'FAC', 'NORP', 'LAW', 'EVENT'])

/** Who a name is, as pointing at it says: "Barack Obama: 44th president of the United States", or null when Scythe
 *  can't say. */
export const whoIs = (s: SpanRec): string | null =>
  s.name ? (s.name.description ? `${s.name.name}: ${s.name.description}` : s.name.name) : null

/** A name's place in checking. `checked`: the team has said who this is, on this card (its file lists it) or on
 *  another (the verdict applies to every card). `toCheck`: this card, cut since names were checked, still asks for it
 *  (its file doesn't list it yet), so a name the team knows from another card can be both: drawn as checked, and
 *  confirmed here with one click. Neither for a date or number, or on a card cut before names were checked. */
export interface NameState { checked: boolean; toCheck: boolean; here: boolean }

export function nameState(s: SpanRec, names: NameRec[] | null | undefined): NameState {
  if (s.key !== 'ents') return { checked: false, toCheck: false, here: false }
  const here = !!names?.some((nm) => nm.start_char === s.start_char && nm.end_char === s.end_char)
  const toCheck = !here && !!names && s.src === 'ner' && CHECKED_KINDS.has(s.label)
  return { checked: here || !!s.name?.settled, toCheck, here }
}

/** The names a card still asks the team to check, as written, once each, in order. */
export function namesToCheck(text: string, spans: SpanRec[], names: NameRec[] | null): string[] {
  const seen = new Set<string>()
  return spans
    .filter((s) => nameState(s, names).toCheck)
    .sort((a, b) => a.start_char - b.start_char)
    .map((s) => text.slice(s.start_char, s.end_char).trim())
    .filter((t) => t && !seen.has(t) && seen.add(t))
}

export type Verdict = 'right' | 'wrong' | 'not_a_name'

/** Settle a name on a card: one commit, to the card's `names` and the team's names.json. `right` confirms who Scythe
 *  said (or `id`); `wrong` with `id` is someone else, without, nobody we can name; `not_a_name` drops the guess. */
export const settleName = (spanId: number, verdict: Verdict, id: string | null) =>
  api<unknown>('POST', `/spans/${spanId}/name`, { verdict, id })

/** Who a typed name could be: the team's own names first, then Wikidata's. */
export async function searchNames(q: string, signal?: AbortSignal): Promise<NameItem[]> {
  const typed = q.trim().slice(0, 200)
  if (!typed) return []
  const r = await api<unknown>('GET', `/names?${new URLSearchParams({ q: typed, limit: '8' })}`, undefined, { signal })
  return (Array.isArray(r) ? r : []).filter((i): i is NameItem =>
    !!i && typeof i === 'object' && typeof (i as NameItem).id === 'string' && typeof (i as NameItem).name === 'string')
}
