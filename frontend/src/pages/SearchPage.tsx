import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Autocomplete from '../components/Autocomplete'
import CardView from '../components/CardView'
import { useDebounced } from '../lib/hooks'
import { listCards, NSDA_TOPICS, searchCards, searchPerson, type Found, type SearchSort } from '../lib/store'
import { dateWords, monthOf } from '../lib/text'
import { topicLabel } from '../lib/topic'

/** Which cards: every card on the shelf, the approved ones, or the removed ones. One at a time. */
type View = 'all' | 'approved' | 'removed'
const VIEW_PARAM: Record<Exclude<View, 'all'>, string> = { approved: 'approved', removed: 'archived' }
const SORTS: [SearchSort, string][] = [['best', 'best match'], ['recent', 'recently changed'], ['published', 'date published']]
const TIER_HEADINGS: Record<string, string> = { 'every word': 'Every word, not as a phrase', 'any word': 'Some of the words' }
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
/** Cards sorted by date fall under one heading a month (a year, for a source dated just by its year). */
const dateGroup = (d: string | null) => (d ? monthOf(d) ?? d.slice(0, 4) : 'none')

const cards = (n: number) => (n === 1 ? '1 card' : `${n} cards`)

/** "3 cards", or with loose matches, "3 cards · 12 more with some of the words": the words asked for, counted apart
 *  from the looser tier below them. */
function count(results: Found[], view: View): string {
  const loose = results.filter((f) => f.match === 'any word').length
  const which = view === 'removed' ? ' removed' : view === 'approved' ? ' approved' : ''
  if (!loose) return cards(results.length) + which
  const strong = results.length - loose
  return `${cards(strong)}${which} · ${loose} more with some of the words`
}

/** Google-style search over the team's cards: "a phrase", -leave out, a OR b. Everything about the search is in the
 *  address, so it can be shared. */
export default function SearchPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const topic = params.get('topic')
  const view: View = params.get('archived') === '1' ? 'removed' : params.get('approved') === '1' ? 'approved' : 'all'
  const sort = (SORTS.find(([s]) => s === params.get('sort'))?.[0] ?? 'best') as SearchSort
  const month = MONTH.test(params.get('month') ?? '') ? params.get('month') : null
  const person = params.get('person')
  const brief = params.get('brief')
  const dq = useDebounced(q, 250)
  const [results, setResults] = useState<Found[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const topicInfo = topic ? NSDA_TOPICS.find((t) => t.slug === topic) : null

  // The address follows the field (replace, so typing doesn't fill the back button) ...
  const wrote = useRef(params.get('q') ?? '')
  useEffect(() => {
    wrote.current = dq.trim()
    setParams((p) => { if (dq.trim()) p.set('q', dq.trim()); else p.delete('q'); return p }, { replace: true })
  }, [dq, setParams])
  // ... and the field follows the address when something else changed it (back, forward, a link), never mid-typing.
  const addressQ = params.get('q') ?? ''
  useEffect(() => { if (addressQ !== wrote.current) { wrote.current = addressQ; setQ(addressQ) } }, [addressQ])

  useEffect(() => {
    const ctl = new AbortController()
    setError(null)
    setResults(null)
    const run = person
      ? searchPerson(person).then((cards) => cards.map((card) => ({ card, match: null })))
      : brief
        ? listCards({ brief, archived: view === 'removed', approved: view === 'approved' ? true : null, limit: 500 }).then((cards) => cards.map((card) => ({ card, match: null })))
        : searchCards(dq, { topic, approved: view === 'approved', archived: view === 'removed', sort, month, signal: ctl.signal })
    run.then((r) => { if (!ctl.signal.aborted) setResults(r) })
      .catch((e) => { if (!ctl.signal.aborted) setError(e.message) })
    return () => ctl.abort()
  }, [dq, topic, view, sort, month, person, brief])

  const set = (changes: Record<string, string | null>) => setParams((p) => {
    for (const [k, v] of Object.entries(changes)) { if (v === null) p.delete(k); else p.set(k, v) }
    return p
  })
  /** One view at a time: choosing one clears the other's parameter (never ?archived=1&approved=1). */
  const show = (v: View) => set({ approved: v === 'approved' ? '1' : null, archived: v === 'removed' ? '1' : null })

  return (
    <div className="stack">
      <div className="gap">
        <Autocomplete<Found>
          label="Search cards" placeholder='Search cards: words, "a phrase", -leave out, a OR b' autoFocus maxLength={500}
          value={q} onChange={setQ} onSubmit={(v) => set({ q: v.trim() || null })}
          source={(text, signal) => searchCards(text, { topic, approved: view === 'approved', archived: view === 'removed', limit: 8, signal })}
          itemKey={(f) => f.card.number}
          renderItem={(f) => (
            <>
              <span className="ac-label">{f.card.title || 'Untagged'}</span>
              <span className="ac-detail">#{f.card.number}{f.card.published ? ` · ${dateWords(f.card.published)}` : ''}
                {f.card.meta.cite ? ` · ${f.card.meta.cite.split(',')[0]}` : ''}</span>
            </>
          )}
          complete={(f) => f.card.title}
          onSelect={(f) => navigate(`/cards/${f.card.number}`)}
          emptyText="No cards with those words."
        />
        <div className="row">
          {(['all', 'approved', 'removed'] as View[]).map((v) => (
            <button key={v} className={`link ${view === v ? 'on' : ''}`} aria-pressed={view === v} onClick={() => show(v)}>
              {v === 'all' ? 'all cards' : v === 'approved' ? 'approved only' : 'removed'}
            </button>
          ))}
          <span className="spacer">sort by{' '}
            {SORTS.map(([s, words], i) => (
              <Fragment key={s}>{i > 0 && ' · '}
                <button className={`link ${sort === s ? 'on' : ''}`} aria-pressed={sort === s}
                  onClick={() => set({ sort: s === 'best' ? null : s })}>{words}</button>
              </Fragment>
            ))}
          </span>
        </div>
        {(topic || month || person || brief) && (
          <div className="row">
            {topic && <span>In {topicInfo ? `${topicLabel(topicInfo)}: ${topicInfo.resolution}` : topic}{' '}
              <button className="link" onClick={() => set({ topic: null })}>clear</button></span>}
            {month && <span>Published {dateWords(month)} <button className="link" onClick={() => set({ month: null })}>clear</button></span>}
            {person && <span>By or naming {person} <button className="link" onClick={() => set({ person: null })}>clear</button></span>}
            {brief && <span>Scanned from {brief}, in page order <button className="link" onClick={() => set({ brief: null })}>clear</button></span>}
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {/* Each view gets its own list, so nothing from the last one lingers while the next loads. */}
      <div className="content stack" key={`${view}|${sort}|${month}|${topic}|${person}|${brief}`}>
        {results === null && !error && <p>Searching…</p>}
        {results && <p>{count(results, view)}</p>}
        {results?.map((f, i) => {
          const prev = results[i - 1]
          const heading = sort === 'published'
            ? i === 0 || dateGroup(f.card.published) !== dateGroup(prev.card.published)
              ? <h2 className="month">{f.card.published
                  ? monthOf(f.card.published)
                    ? <Link to={`/search?month=${monthOf(f.card.published)}${view !== 'all' ? `&${VIEW_PARAM[view]}=1` : ''}`}>{dateWords(monthOf(f.card.published)!)}</Link>
                    : dateWords(f.card.published)
                  : 'No date'}</h2>
              : null
            : sort === 'best' && dq.trim() && f.match && f.match !== prev?.match && TIER_HEADINGS[f.match] && i > 0
              ? <h2 className="month">{TIER_HEADINGS[f.match]}</h2>
              : null
          return <Fragment key={f.card.number}>{heading}<CardView card={f.card} mode="read" /></Fragment>
        })}
      </div>
    </div>
  )
}
