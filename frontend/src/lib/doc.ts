/**
 * The record's file formats and canonical card Markdown, as specified in api/format.md (the server and
 * the iOS app implement the same). Cards are cards/<n>.md in the team server's git repo: JSON
 * front matter (the record) and the card as Scythe Markdown. Span offsets count UTF-16 code units.
 */

export interface SpanRec {
  label: string; key: string; style: string; start_char: number; end_char: number; src: string
  start?: number; end?: number; score?: number
  /** A model suggestion's span in the index (it isn't in the card file until someone accepts it). */
  id?: number
}
export interface LinkRec { rel: string; to: number }
export interface TopicRef { slug: string; event: string; season: string; period: string; resolution: string }
/** A card as the app shows it: the file's record, plus spaCy's entities once the server has checked it. */
export interface CardMeta {
  kind: 'card'; text: string; cite: string; url: string; source: number | null; topic: TopicRef | null
  spans: SpanRec[]; links: LinkRec[]
}
export interface LabelDef { name: string; key: string; style: string; hotkey: string | null }

export const DEFAULT_LABELS: LabelDef[] = [
  { name: 'underline', key: 'sc', style: 'underline', hotkey: '1' },
  { name: 'highlight', key: 'sc', style: 'highlight', hotkey: '2' },
  { name: 'emphasis', key: 'sc', style: 'emphasis', hotkey: '3' },
]
export const LINK_WORDS: Record<string, string> = {
  answers: 'Answers', supports: 'Supports', contradicts: 'Contradicts', elaborates: 'Elaborates',
  same_claim: 'Same claim as', quotes: 'Quotes', cites: 'Cites', derived_from: 'Derived from', related: 'Related to',
}
export const normalize = (body: string | null | undefined) => (body ?? '').replace(/\r\n/g, '\n')

// ---------------------------------------------------------------- Markdown (the server reads the same format)

const INLINE = /([\\`*_[\]<>=~|])/g
const URL_RE = /https?:\/\/[^\s<>\])]+/g
const BLOCK_START = /^(#+|[+-]|\d+\.)(?=\s)/gm
const ORDER = ['underline', 'highlight', 'emphasis'] as const
type Flavor = 'scythe' | 'github'
const MARKERS: Record<Flavor, [Record<string, string>, Record<string, string>]> = {
  scythe: [{ underline: '<u>', highlight: '==', emphasis: '**' }, { underline: '</u>', highlight: '==', emphasis: '**' }],
  github: [{ underline: '<ins>', highlight: '<mark>', emphasis: '**' }, { underline: '</ins>', highlight: '</mark>', emphasis: '**' }],
}

export function escapeMd(text: string): string {
  let out = ''
  let pos = 0
  for (const m of text.matchAll(URL_RE)) {
    out += text.slice(pos, m.index).replace(INLINE, '\\$1') + m[0]
    pos = m.index! + m[0].length
  }
  return out + text.slice(pos).replace(INLINE, '\\$1')
}

function flagsOf(text: string, spans: SpanRec[]): string[][] {
  const flags: Set<string>[] = Array.from({ length: text.length }, () => new Set())
  for (const s of spans) {
    if (s.key === 'ents' || !ORDER.includes(s.style as typeof ORDER[number])) continue
    for (let i = s.start_char; i < s.end_char && i < text.length; i++) flags[i].add(s.style)
  }
  return flags.map((f) => ORDER.filter((x) => f.has(x)))
}

function renderParagraph(segs: [string, string[]][], condensed: boolean, flavor: Flavor): string {
  const [OPEN, CLOSE] = MARKERS[flavor]
  const out: string[] = []
  const stack: string[] = []
  let pending = ''
  const closeTo = (k: number) => { while (stack.length > k) out.push(CLOSE[stack.pop()!]) }
  for (const [text, target] of segs) {
    if (condensed && target.length === 0) {
      closeTo(0)
      if (out.length && out[out.length - 1] !== ' … ') out.push(' … ')
      pending = ''
      continue
    }
    if (!text.trim()) { pending += text; continue }
    const core = text.trim()
    const lead = text.slice(0, text.length - text.trimStart().length)
    const trail = text.slice(text.trimEnd().length)
    pending += lead
    let k = 0
    while (k < Math.min(stack.length, target.length) && stack[k] === target[k]) k++
    closeTo(k)
    if (out.length && out[out.length - 1] === ' … ') pending = ''
    out.push(pending)
    for (const f of target.slice(k)) { out.push(OPEN[f]); stack.push(f) }
    out.push(escapeMd(core))
    pending = trail
  }
  closeTo(0)
  const joined = out.join('')
  return condensed ? joined.replace(/^[ …]+|[ …]+$/g, '') : joined.trim()
}

export function bodyMarkdown(text: string, spans: SpanRec[], { condensed = false, flavor = 'scythe' as Flavor } = {}): string {
  const flags = flagsOf(text, spans)
  const paras: string[] = []
  let pos = 0
  for (const line of text.split('\n')) {
    const segs: [string, string[]][] = []
    let i = pos
    const hi = pos + line.length
    while (i < hi) {
      let j = i
      while (j < hi && flags[j].join() === flags[i].join()) j++
      segs.push([text.slice(i, j), flags[i]])
      i = j
    }
    const rendered = renderParagraph(segs, condensed, flavor)
    if (rendered) paras.push(rendered)
    pos += line.length + 1
  }
  return paras.join('\n\n').replace(BLOCK_START, (m) => (m.endsWith('.') ? m.slice(0, -1) + '\\.' : '\\' + m))
}

export function citeMarkdown(cite: string): string {
  if (!cite) return ''
  const i = cite.indexOf(',')
  return i < 0 ? `**${escapeMd(cite.trim())}**` : `**${escapeMd(cite.slice(0, i).trim())}**${escapeMd(cite.slice(i))}`
}

/** Canonical card Markdown (print, copy-as-MD, chunking). */
export function cardMarkdown(title: string, meta: CardMeta, { condensed = false, level = 4 } = {}): string {
  return [`${'#'.repeat(level)} ${title ? escapeMd(title) : 'Untagged'}`, citeMarkdown(meta.cite),
    bodyMarkdown(meta.text, meta.spans, { condensed })].filter(Boolean).join('\n\n') + '\n'
}

// ---------------------------------------------------------------- browser-side snapping

/** Word/punctuation tokens, close to spaCy's English tokenizer; the server re-snaps every span to spaCy's own (api/format.md). */
export function roughTokens(text: string): [number, number][] {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s\p{L}\p{N}]/gu)].map((m) => [m.index!, m.index! + m[0].length])
}

export function snapChars(text: string, start: number, end: number): [number, number] | null {
  const toks = roughTokens(text).filter(([a, b]) => b > start && a < end)
  return toks.length ? [toks[0][0], toks[toks.length - 1][1]] : null
}

// ---------------------------------------------------------------- git files (as the server writes them)

/** cards/<n>.md front matter: the record of a card. Every save is a commit of this file. */
/** The brief a card was scanned from (its name) and the brief's pages it was read on: a tag, not a file. */
export interface BriefRef { name: string; pages: number[] }
export interface CardFile {
  id: number | null; title: string; topic: TopicRef | null; file: string | null; block: string | null; approved: boolean
  cite: string; url: string; source: number | null; links: LinkRec[]; spans: SpanRec[]; text: string
  /** Only on a scanned card; the server writes it, and keeps the file's when a save leaves it out. */
  brief?: BriefRef | null
}
export interface SourceHead {
  id: number | null; title: string; url: string | null; publisher: string; published: string | null; authors: string[]
  cite: string; fetched: string | null
}
const CARD_FIELDS: (keyof CardFile)[] = ['id', 'title', 'topic', 'file', 'block', 'approved', 'cite', 'url', 'source', 'links', 'spans', 'text']
const SOURCE_FIELDS: (keyof SourceHead)[] = ['id', 'title', 'url', 'publisher', 'published', 'authors', 'cite', 'fetched']

/** One key per line, one span/link per line, so `git log -p` shows exactly what changed. Matches Python. */
export function diffableJson(obj: Record<string, unknown>): string {
  // Python's json.dumps spacing (", " and ": "), built structurally so string contents are untouched.
  const pyJson = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`
    if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ')}}`
    return JSON.stringify(v ?? null)
  }
  const entries = Object.entries(obj)
  const lines = entries.map(([k, v], i) => {
    const comma = i < entries.length - 1 ? ',' : ''
    if (Array.isArray(v) && v.length) {
      return `  ${JSON.stringify(k)}: [\n${v.map((x, j) => `    ${pyJson(x)}${j < v.length - 1 ? ',' : ''}`).join('\n')}\n  ]${comma}`
    }
    return `  ${JSON.stringify(k)}: ${pyJson(v)}${comma}`
  })
  return `{\n${lines.join('\n')}\n}`
}

function splitFront(content: string): [Record<string, unknown>, string] {
  const c = normalize(content)
  if (!c.startsWith('---\n')) throw new Error('missing front matter')
  const end = c.indexOf('\n---\n', 4)
  const head = JSON.parse(c.slice(4, end)) as Record<string, unknown>
  // Files written before issues were dropped call the number "issue".
  const fixed = 'id' in head || !('issue' in head) ? head : Object.fromEntries([['id', head.issue], ...Object.entries(head).filter(([k]) => k !== 'issue')])
  return [fixed, c.slice(end + 5)]
}

export function cardFile(card: CardFile): string {
  // `brief` keeps its place after `source` (the server writes it after `at`, which this app leaves to the server).
  const head = Object.fromEntries(CARD_FIELDS.flatMap((k): [string, unknown][] =>
    k === 'source' && card.brief ? [[k, card[k] ?? null], ['brief', { name: card.brief.name, pages: card.brief.pages }]] : [[k, card[k] ?? null]]))
  head.links = card.links ?? []
  head.spans = card.spans ?? []
  const meta = { kind: 'card' as const, text: card.text, cite: card.cite, url: card.url, source: card.source, topic: card.topic, spans: head.spans as SpanRec[], links: [] }
  return `---\n${diffableJson(head)}\n---\n\n${cardMarkdown(card.title, meta)}`
}

export const parseCardFile = (content: string) => splitFront(content)[0] as unknown as CardFile

export function sourceFile(head: SourceHead, text: string): string {
  return `---\n${diffableJson(Object.fromEntries(SOURCE_FIELDS.map((k) => [k, head[k] ?? null])))}\n---\n\n${text}\n`
}

export function parseSourceFile(content: string): [SourceHead, string] {
  const [head, body] = splitFront(content)
  return [head as unknown as SourceHead, body.slice(1, -1)]
}
