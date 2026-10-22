/**
 * Cards and sources are files in the server's git repo; every save is a commit pinned to the file
 * version it started from (a stale save comes back as a divergence). The server's index serves
 * lists, search, backlinks and spaCy's entities.
 */
import nsdaTopics from '../../../api/nsda_topics.json'
import {
  DEFAULT_LABELS, cardFile, parseCardFile, snapChars, sourceFile,
  type BriefRef, type CardFile, type CardMeta, type LabelDef, type LinkRec, type NameItem, type NameRec, type SourceHead,
  type SpanRec, type TopicRef,
} from './doc'
import { api, ApiError, Diverged, readFile, type Theirs } from './api'
import { checkDate, checkUrl, cleanLine, cleanPassage, countWords, cpToU16, LIMITS, safeUrl, tooLongCard, tooLongSource, WORDS } from './text'

/** A card as the server's index has it (/api/cards). Offsets count code points. */
interface IndexCard {
  id: number; tag: string; cite: string; url: string; text: string; approved: boolean; archived: boolean
  topic: (TopicRef & { id: number }) | null; file: string | null; block: string | null; source_id: number | null
  sha: string | null; author: string; processed: boolean; updated_at: string
  /** The card's source's date as its cite has it: 2024-03-15, 2024-03 or 2024. */
  published?: string | null
  /** The brief a scanned card came from, and its pages in it ("" and [] otherwise). */
  brief?: string; pages?: number[]
  spans: { id: number; label: string; spans_key: string; start_char: number; end_char: number; source: string; score: number | null; accepted: boolean
    /** On a name Scythe found: who it is, or null. */
    name?: unknown }[]
  /** Names Scythe guessed that nobody has settled; null on a card cut before names were checked. */
  names_to_check?: number | null
}

export interface CardDoc {
  number: number; title: string; state: 'open' | 'closed'; updated_at: string; author: string
  /** When the card's source was published, as written (2024-03-15, 2024-03 or 2024), or null. */
  published: string | null
  /** Spans from the file, plus spaCy entities once the server has checked this exact version. */
  meta: CardMeta
  topic: string | null; file: string | null; block: string | null; approved: boolean
  /** The brief a scanned card was read from, and the brief's pages it was on; null for every other card. */
  brief: BriefRef | null
  /** The card's file as last read from git, and its blob sha (what the next save builds on). */
  record: CardFile | null; sha: string | null
  processed: boolean
  /** Marks the team's model suggests, waiting for a yes: in the index only, never in git until accepted. */
  suggestions: SpanRec[]
  /** The names the team settled (the file's `names`), or null on a card cut before names were checked. */
  names: NameRec[] | null
  /** How many of Scythe's guesses at people, places and organizations still wait on the team; null as for `names`. */
  namesToCheck: number | null
}

export interface SourceDoc { number: number; title: string; head: SourceHead; text: string }
export interface Topic extends TopicRef { origin: 'nsda' | 'custom' }

const refOf = (t: TopicRef | null): TopicRef | null =>
  t ? { slug: t.slug, event: t.event, season: t.season, period: t.period, resolution: t.resolution } : null

function indexSpans(c: IndexCard, keep: (s: IndexCard['spans'][number]) => boolean): SpanRec[] {
  return c.spans.filter(keep).map((s) => ({
    label: s.label, key: s.spans_key, style: s.spans_key === 'ents' ? 'entity' : styleOf(s.label), src: s.source,
    start_char: cpToU16(c.text, s.start_char), end_char: cpToU16(c.text, s.end_char), id: s.id, score: s.score ?? undefined,
    ...(s.spans_key === 'ents' ? { name: cleanName(s.name) } : {}),
  }))
}

/** Who a name is, as the index sent it, checked at the edge like the card. */
function cleanName(raw: unknown): NameItem | null {
  const n = (raw && typeof raw === 'object' ? raw : null) as Partial<NameItem> | null
  if (!n || typeof n.id !== 'string' || typeof n.name !== 'string') return null
  return { id: n.id, name: n.name, description: str(n.description), kind: str(n.kind, 'other'), url: safeUrl(n.url) ?? null, settled: n.settled === true }
}

/** The file's settled names, as written, or null for a card cut before names were checked. */
function fileNames(record: CardFile): NameRec[] | null {
  if (!Array.isArray(record.names)) return null
  return record.names.filter((nm) => nm && Number.isInteger(nm.start_char) && Number.isInteger(nm.end_char) && nm.start_char < nm.end_char)
}
const toCheck = (c: IndexCard) => (Number.isInteger(c.names_to_check) ? c.names_to_check! : null)

const STYLES = new Set(['underline', 'highlight', 'emphasis'])
const styleOf = (label: string) => (STYLES.has(label) ? label : 'custom')

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/

/** What the index sent, made whole before any component reads it: the server's shape is checked here, at the edge,
 *  so a missing or odd field reads as empty rather than breaking a page. */
function cleanIndexCard(raw: unknown): IndexCard {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<IndexCard>
  const text = str(c.text)
  return {
    id: Number(c.id) || 0, tag: str(c.tag), cite: str(c.cite), url: safeUrl(c.url) ?? '', text,
    approved: c.approved === true, archived: c.archived === true,
    topic: c.topic && typeof c.topic === 'object' && typeof c.topic.slug === 'string' ? c.topic : null,
    file: typeof c.file === 'string' ? c.file : null, block: typeof c.block === 'string' ? c.block : null,
    source_id: Number.isInteger(c.source_id) ? c.source_id! : null, sha: typeof c.sha === 'string' ? c.sha : null,
    author: str(c.author), processed: c.processed === true, updated_at: str(c.updated_at),
    published: typeof c.published === 'string' && DATE.test(c.published) ? c.published : null,
    brief: str(c.brief), pages: Array.isArray(c.pages) ? c.pages.filter((p) => Number.isInteger(p) && p > 0) : [],
    names_to_check: Number.isInteger(c.names_to_check) ? c.names_to_check : null,
    spans: Array.isArray(c.spans) ? c.spans.filter((s) => s && Number.isInteger(s.start_char) && Number.isInteger(s.end_char)
      && s.start_char >= 0 && s.start_char < s.end_char && typeof s.label === 'string') : [],
  }
}

/** From the index only (lists, search). */
export function fromIndex(raw: IndexCard): CardDoc {
  const c = cleanIndexCard(raw)
  return {
    number: c.id, title: c.tag, state: c.archived ? 'closed' : 'open', updated_at: c.updated_at, author: c.author,
    published: c.published ?? null,
    meta: { kind: 'card', text: c.text, cite: c.cite, url: c.url, source: c.source_id, topic: refOf(c.topic), links: [],
      spans: indexSpans(c, (s) => s.accepted) },
    topic: c.topic?.slug ?? null, file: c.file, block: c.block, approved: c.approved,
    brief: c.brief ? { name: c.brief, pages: c.pages ?? [] } : null,
    record: null, sha: null, processed: c.processed,
    suggestions: [],
    names: null, namesToCheck: toCheck(c),
  }
}

// ---------------------------------------------------------------- reading

/** `brief`: only the cards scanned from that brief, in page order. */
export async function listCards({ topic = null as string | null, file = null as string | null, approved = null as boolean | null,
  brief = null as string | null, archived = false, limit = 100 } = {}): Promise<CardDoc[]> {
  const q = new URLSearchParams({ limit: String(limit), archived: String(archived) })
  if (topic) q.set('topic', topic)
  if (file) q.set('file', file)
  if (brief) q.set('brief', brief)
  if (approved !== null) q.set('approved', String(approved))
  return (await api<IndexCard[]>('GET', `/cards?${q}`)).map(fromIndex)
}

/** Every card by a person or naming them (landing claim 23): cards cut from a source they wrote, and cards whose words
 *  name them. "Last, First" works too. */
export async function searchPerson(name: string): Promise<CardDoc[]> {
  return (await api<IndexCard[]>('GET', `/search/person?${new URLSearchParams({ name: cleanLine(name, 120) })}`)).map(fromIndex)
}

export type SearchSort = 'best' | 'recent' | 'published'
/** How a result matched: the words as a phrase, every word, or any word (where a meaning match will go). */
export type Match = 'phrase' | 'every word' | 'any word'
export interface Found { card: CardDoc; match: Match | null }

export interface SearchOptions {
  topic?: string | null; approved?: boolean; archived?: boolean; sort?: SearchSort; month?: string | null; limit?: number
  signal?: AbortSignal
}

/** Search the way Google takes it: "a phrase", -leave out, a OR b, and the last word as a prefix while it's typed.
 *  The server ranks the phrase first, then every word, then any word. With no words, every card, newest first.
 *  A typed query keeps its trailing space: it says the last word is finished. */
export async function searchCards(text: string, { topic = null, approved = false, archived = false, sort = 'best', month = null,
  limit = 50, signal }: SearchOptions = {}): Promise<Found[]> {
  const typed = text.replace(BIDI_AND_CONTROLS, '').slice(0, LIMITS.query)
  const q = new URLSearchParams({ q: typed.trim() ? typed.replace(/\s+/g, ' ').replace(/^ /, '') : '', limit: String(limit),
    archived: String(archived), sort })
  if (topic) q.set('topic', topic)
  if (approved) q.set('approved', 'true')
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) q.set('month', month)
  const r = await api<{ results: { card: IndexCard; match?: string | null }[] }>('GET', `/search?${q}`, undefined, { signal })
  return (Array.isArray(r?.results) ? r.results : []).map((x) => ({
    card: fromIndex(x.card), match: (['phrase', 'every word', 'any word'] as const).find((m) => m === x.match) ?? null,
  }))
}
// eslint-disable-next-line no-control-regex
const BIDI_AND_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g

/** The card as recorded in git (truth), joined with the index (archived, who changed it, spaCy). */
export async function getCard(n: number): Promise<CardDoc> {
  const [file, index] = await Promise.all([readFile(`cards/${n}.md`), api<IndexCard>('GET', `/cards/${n}`)])
  if (!file) {
    if (index.archived) return fromIndex(index)
    throw new Error(`Card ${n} isn't in the team's evidence.`)
  }
  const record = parseCardFile(file.text)
  const processed = index.processed && index.sha === file.sha
  // The names Scythe found hold for the same words: a verdict (or a tag) commits a new version without changing
  // them, so they stay on screen while Scythe re-reads the card.
  const ents = processed || index.text === record.text ? indexSpans(index, (s) => s.spans_key === 'ents') : []
  return {
    number: n, title: record.title, state: 'open', updated_at: index.updated_at, author: index.author,
    published: cleanIndexCard(index).published ?? null,
    meta: { kind: 'card', text: record.text, cite: record.cite, url: record.url, source: record.source, topic: record.topic,
      spans: [...record.spans, ...ents], links: record.links },
    topic: record.topic?.slug ?? null, file: record.file, block: record.block, approved: record.approved,
    brief: record.brief ?? null,
    record, sha: file.sha, processed,
    suggestions: indexSpans(index, (s) => s.source === 'model' && !s.accepted),
    names: fileNames(record), namesToCheck: toCheck(index),
  }
}

// ---------------------------------------------------------------- suggestions (the team's model)

/** Ask the team's model for marks on this card. Resolves with how many it suggests. */
export async function suggest(n: number): Promise<number> {
  return (await api<{ added: number }>('POST', `/cards/${n}/suggest`)).added
}

/** Yes: the server commits the suggestion to the card file as a manual mark. */
export const acceptSuggestion = (id: number) => api('PATCH', `/spans/${id}`, { accepted: true })

/** No: it goes, and the model won't suggest it on this card again. */
export const rejectSuggestion = (id: number) => api('DELETE', `/spans/${id}`)

// ---------------------------------------------------------------- saving (git)

/** A change to a card, described for the commit message and re-appliable on someone else's version. */
export interface Op { message: string; apply: (f: CardFile) => CardFile }

export interface Divergence { op: Op; mine: CardFile; theirs: CardFile; theirsSha: string; commit: Theirs['commit'] }

export class DivergedSave extends Error {
  d: Divergence
  constructor(d: Divergence) { super('diverged'); this.d = d }
}

const putCard = (n: number, content: string, sha: string, message: string) =>
  api('PUT', `/git/cards/${n}`, { content, sha, message })

/** Commit `op` on top of the version this card was loaded at. Resolves with the new card, or throws
 *  `DivergedSave` when someone saved first: their version, and mine, are in the error for the user to settle. */
export async function save(card: CardDoc, op: Op): Promise<CardDoc> {
  if (!card.record || !card.sha) throw new Error('Load the card before editing it.')
  const next = op.apply(structuredClone(card.record))
  try {
    await putCard(card.number, cardFile(next), card.sha, `${op.message} (#${card.number})`)
  } catch (e) {
    if (e instanceof Diverged) {
      throw new DivergedSave({ op, mine: next, theirs: parseCardFile(e.theirs.content), theirsSha: e.theirs.sha, commit: e.theirs.commit })
    }
    throw e
  }
  return getCard(card.number)
}

/** git rebase: replay my change on their version. May diverge again if someone saved once more. */
export async function rebase(n: number, d: Divergence): Promise<CardDoc> {
  return save(await getCard(n), d.op)
}

/** git push --force-with-lease: my version replaces theirs (still refused if someone saved again). */
export async function force(n: number, d: Divergence): Promise<CardDoc> {
  try {
    await putCard(n, cardFile(d.mine), d.theirsSha, `${d.op.message}, replacing ${d.commit.sha?.slice(0, 7) ?? 'their save'} (#${n})`)
  } catch (e) {
    if (e instanceof Diverged) throw new DivergedSave({ ...d, theirs: parseCardFile(e.theirs.content), theirsSha: e.theirs.sha, commit: e.theirs.commit })
    throw e
  }
  return getCard(n)
}

export const spanKey = (s: Pick<SpanRec, 'key' | 'label' | 'start_char' | 'end_char'>) => `${s.key}|${s.label}|${s.start_char}|${s.end_char}`
const quote = (t: string) => `"${t.length > 40 ? t.slice(0, 40) + '…' : t}"`

export const ops = {
  addSpan: (text: string, label: LabelDef, start: number, end: number): Op => {
    const snapped = snapChars(text, start, end)
    if (!snapped) throw new Error('That selection has no words in it.')
    const [a, b] = snapped
    return {
      message: `${label.name}: ${quote(text.slice(a, b))}`,
      apply: (f) => {
        if (!f.spans.some((s) => s.label === label.name && s.key === label.key && s.start_char === a && s.end_char === b)) {
          f.spans.push({ label: label.name, key: label.key, style: label.style, start_char: a, end_char: b, src: 'manual' })
          f.spans.sort((x, y) => x.start_char - y.start_char || y.end_char - x.end_char || x.label.localeCompare(y.label))
        }
        return f
      },
    }
  },
  removeSpan: (text: string, span: SpanRec): Op => ({
    message: `remove ${span.label}: ${quote(text.slice(span.start_char, span.end_char))}`,
    // Match by label and characters: those are what both versions share.
    apply: (f) => ({ ...f, spans: f.spans.filter((s) => !(s.label === span.label && s.key === span.key && s.start_char === span.start_char && s.end_char === span.end_char)) }),
  }),
  set: <K extends 'title' | 'cite'>(field: K, value: string): Op => ({ message: `${field}: ${quote(value)}`, apply: (f) => ({ ...f, [field]: value }) }),
  topic: (t: TopicRef): Op => ({ message: `topic: ${t.slug}`, apply: (f) => ({ ...f, topic: t }) }),
  place: (file: string | null, block: string | null): Op => ({ message: file ? `file: ${file} / ${block ?? ''}` : 'unfile', apply: (f) => ({ ...f, file, block }) }),
  approve: (on: boolean): Op => ({ message: on ? 'approve' : 'unapprove', apply: (f) => ({ ...f, approved: on }) }),
  link: (rel: string, to: number): Op => ({ message: `${rel.replace('_', ' ')} #${to}`, apply: (f) => ({ ...f, links: [...f.links.filter((l) => !(l.rel === rel && l.to === to)), { rel, to }] }) }),
  unlink: (l: LinkRec): Op => ({ message: `unlink ${l.rel.replace('_', ' ')} #${l.to}`, apply: (f) => ({ ...f, links: f.links.filter((x) => !(x.rel === l.rel && x.to === l.to)) }) }),
}

export interface NewCard { text: string; title: string; cite: string; url?: string; source?: number | null; topic: Topic; file?: string | null; block?: string | null
  /** Formatting it arrives with (the marks read off a scanned card, say); usually none. */
  spans?: SpanRec[] }

export async function createCard(c: NewCard): Promise<number> {
  c = { ...c, text: cleanPassage(c.text), title: cleanLine(c.title, LIMITS.tag), cite: cleanLine(c.cite, LIMITS.cite) }
  if (!c.text.trim()) throw new Error('A card needs words.')
  if (c.text.length > LIMITS.passage) throw new Error('That card is too long. Cut it shorter.')
  if (countWords(c.text) > WORDS.card) throw new Error(tooLongCard(countWords(c.text)))
  if (c.url) { const u = checkUrl(c.url); if ('error' in u) throw new Error(u.error); c.url = u.url }
  const topic: TopicRef = { slug: c.topic.slug, event: c.topic.event, season: c.topic.season, period: c.topic.period, resolution: c.topic.resolution }
  const record: CardFile = { id: null, title: c.title || c.text.slice(0, 80), topic, file: c.file ?? null, block: c.block ?? null, approved: false,
    cite: c.cite, url: c.url ?? '', source: c.source ?? null, links: [], spans: c.spans ?? [], text: c.text }
  return (await api<{ number: number }>('POST', '/git/cards', { title: record.title, content: cardFile(record) })).number
}

/** Remove = delete the file in a commit; the history keeps every version. */
export async function archiveCard(card: CardDoc) {
  if (!card.sha) throw new Error('Load the card first.')
  await api('POST', `/git/cards/${card.number}/archive`, { sha: card.sha })
}

/** Cards whose files link to #n. */
export async function backlinks(n: number): Promise<{ rel: string; card: CardDoc }[]> {
  return (await api<{ rel: string; card: IndexCard }[]>('GET', `/cards/${n}/backlinks`)).map((b) => ({ rel: b.rel, card: fromIndex(b.card) }))
}

// ---------------------------------------------------------------- sources

export interface NewSource { text: string; title: string; url?: string | null; publisher?: string; published?: string | null; authors?: string[]; cite?: string }

export async function createSource(s: NewSource): Promise<number> {
  s = { ...s, text: cleanPassage(s.text), title: cleanLine(s.title, LIMITS.tag), publisher: cleanLine(s.publisher ?? ''),
    authors: (s.authors ?? []).map((a) => cleanLine(a)).filter(Boolean).slice(0, 50), cite: cleanLine(s.cite ?? '', LIMITS.cite) }
  if (!s.text.trim()) throw new Error('Paste the article’s text first.')
  if (s.text.length > LIMITS.article) throw new Error('That article is too long to keep. Paste the part you need.')
  if (countWords(s.text) > WORDS.source) throw new Error(tooLongSource(countWords(s.text)))
  if (s.url) { const u = checkUrl(s.url); if ('error' in u) throw new Error(u.error); s.url = u.url }
  const d = checkDate(s.published ?? '')
  if ('error' in d) throw new Error(d.error)
  s.published = d.date
  const head: SourceHead = { id: null, title: s.title, url: s.url || null, publisher: s.publisher ?? '', published: s.published ?? null,
    authors: s.authors ?? [], cite: s.cite ?? '', fetched: null }
  return (await api<{ number: number }>('POST', '/git/sources', { title: s.title || s.url || 'Untitled source', content: sourceFile(head, s.text) })).number
}

/** The server reads the article (or finds the source it already has for this link). */
export async function fetchSource(url: string): Promise<number> {
  const u = checkUrl(url)
  if ('error' in u) throw new Error(u.error)
  return (await api<{ number: number }>('POST', '/git/sources', { title: '', url: u.url })).number
}

interface IndexSource {
  id: number; title: string; url: string | null; publisher: string; published: string | null; authors: string[]
  full_text: string; meta: { cite?: string; fetched?: string | null }
}

export async function getSource(n: number): Promise<SourceDoc> {
  const s = await api<IndexSource>('GET', `/sources/${n}`)
  const head: SourceHead = { id: s.id, title: s.title, url: s.url, publisher: s.publisher, published: s.published, authors: s.authors,
    cite: s.meta.cite ?? '', fetched: s.meta.fetched ?? null }
  return { number: n, title: s.title, head, text: s.full_text }
}

/** How many cards (not removed) were cut from source #n: one source gives at most CARDS_PER_SOURCE. */
export async function cardsCutFrom(n: number): Promise<number> {
  return (await api<unknown[]>('GET', `/cards?${new URLSearchParams({ source_id: String(n), limit: '50' })}`)).length
}

export async function listSources(): Promise<{ number: number; title: string }[]> {
  return (await api<{ id: number; title: string; url: string | null }[]>('GET', '/sources?in_git=true&limit=30'))
    .map((s) => ({ number: s.id, title: s.title || s.url || 'Untitled source' }))
}

const LOOSE: Record<string, string> = { "'": "['‘’]", '‘': "['‘’]", '’': "['‘’]", '"': '["“”]', '“': '["“”]', '”': '["“”]', '-': '[-‐-―]', '–': '[-‐-―]', '—': '[-‐-―]' }

/** Find a copied passage in source text: exact, then whitespace- and quote-insensitive. */
export function locate(full: string, passage: string): [number, number] | null {
  const p = passage.trim()
  if (!p) return null
  const i = full.indexOf(p)
  if (i >= 0) return [i, i + p.length]
  const pattern = p.split(/\s+/).filter(Boolean).map((w) => [...w].map((ch) => LOOSE[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')).join('\\s+')
  const m = new RegExp(pattern).exec(full)
  return m ? [m.index, m.index + m[0].length] : null
}

/** An author that's an organization ("Rutgers University-New Brunswick", "AP Staff"), cited by its whole name
 *  (backend reader.is_org). */
const ORG = /\b(university|college|institute|institution|agency|department|ministry|office|council|center|centre|foundation|association|society|organi[sz]ation|corporation|company|inc|llc|ltd|press|news|times|post|journal|staff|editors?|editorial|board|bureau|reuters|associated|wire|service|group|committee|commission|laboratory|lab|school|network|project|program|programme|fund|bank|union)\b/i
export const isOrg = (author: string) => ORG.test(author.replace(/-/g, ' '))

export function defaultCite(s: { title: string; authors: string[]; publisher: string; published: string | null; url: string | null }): string {
  const year = s.published?.slice(2, 4)
  // 2024-03-15 reads 3-15-2024; a month alone, 3-2024; a year alone, 2024
  const date = s.published ? (() => { const [y, m, d] = s.published!.split('-').map(Number); return [m, d, y].filter((n) => n !== undefined && !Number.isNaN(n)).join('-') })() : ''
  const first = s.authors[0]?.trim() ?? ''
  const name = isOrg(first) ? first : first.split(/\s+/).pop()
  const head = s.authors.length ? `${name}${year ? ` ${year}` : ''}` : year ? `${(s.publisher || 'Unknown').split(',')[0]} ${year}` : ''
  return [head, s.authors.join(', '), s.title ? `"${s.title}"` : '', s.publisher, date, s.url ?? ''].filter(Boolean).join(', ')
}

// ---------------------------------------------------------------- shared settings: scythe.json

export interface Settings { labels: LabelDef[]; topics: TopicRef[]; [key: string]: unknown }

export async function readSettings(): Promise<{ settings: Settings; sha: string | null }> {
  const r = await api<{ settings: Partial<Settings>; sha: string | null }>('GET', '/git/settings')
  const s = r.settings
  // Scythe's own three are always there (as the server reads scythe.json): a team's list without them gets them first.
  const labels = Array.isArray(s.labels) ? s.labels.filter((l) => l && typeof l.name === 'string' && typeof l.key === 'string') : []
  const merged = [...DEFAULT_LABELS.filter((d) => !labels.some((l) => l.name === d.name && l.key === d.key)), ...labels]
  return { settings: { ...s, labels: merged, topics: Array.isArray(s.topics) ? s.topics : [] }, sha: r.sha }
}

/** Read-modify-commit scythe.json; on a race, re-read and re-apply. */
export async function updateSettings(message: string, fn: (s: Settings) => Settings) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { settings, sha } = await readSettings()
    try {
      return await api('PUT', '/git/settings', { content: JSON.stringify(fn(settings), null, 2) + '\n', sha, message })
    } catch (e) {
      if (!(e instanceof Diverged || (e instanceof ApiError && e.status === 409))) throw e
    }
  }
  throw new Error('The team’s settings kept changing; try again.')
}

export const NSDA_TOPICS: Topic[] = (nsdaTopics as TopicRef[]).map((t) => ({ ...t, origin: 'nsda' as const }))

export async function customTopics(): Promise<Topic[]> {
  return (await readSettings()).settings.topics.map((t) => ({ ...t, origin: 'custom' as const }))
}

export async function createTopic(resolution: string, season = ''): Promise<Topic> {
  const r = cleanLine(resolution, 1000)
  if (r.length < 3) throw new Error('Write the resolution.')
  const t = await api<TopicRef>('POST', '/topics', { resolution: r, season: cleanLine(season, 40) })
  return { slug: t.slug, event: t.event, season: t.season, period: t.period, resolution: t.resolution, origin: 'custom' }
}

/** Topics with cards under them, and the library's files. */
export async function library(): Promise<{ topics: (TopicRef & { origin: string })[]; files: string[] }> {
  const [topics, files] = await Promise.all([
    api<(TopicRef & { origin: string; cards: number })[]>('GET', '/topics?limit=600'),
    api<{ files: { name: string }[] }>('GET', '/files'),
  ])
  return { topics: topics.filter((t) => t.cards > 0), files: files.files.map((f) => f.name) }
}
