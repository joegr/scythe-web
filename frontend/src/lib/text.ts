// A word broken across lines by a PDF's hyphenation ("agri-" / "culture") is one word; a real compound broken at its
// own hyphen ("long-" / "term") keeps it. These first halves are compounds far more often than not. Same list as the
// backend's reader._COMPOUND_FIRST.
const COMPOUND_FIRST = new Set(['self', 'well', 'all', 'ex', 'half', 'cross', 'non', 'anti', 'long', 'short', 'high', 'low',
  'full', 'co', 'so', 'far', 'near', 'wide', 'post', 'pre', 'multi', 'semi', 'mid', 'one', 'two', 'three', 'first', 'second',
  'third', 'large', 'small', 'real', 'open', 'free', 'life', 'state', 'world'])

/** Lines of one paragraph -> one line, mending words a PDF hyphenated across lines (backend reader._join_lines). */
function joinLines(lines: string[]): string {
  let out = ''
  for (const ln of lines) {
    const m = /(\w+)-$/.exec(out)
    if (out && m && /^\p{Ll}/u.test(ln) && /^\p{L}+$/u.test(m[1]) && !COMPOUND_FIRST.has(m[1].toLowerCase())) out = out.slice(0, -1) + ln
    else if (out && m && /^[\p{L}\p{N}]/u.test(ln)) out += ln // a compound or range split at its own hyphen
    else out = out ? `${out} ${ln}` : ln
  }
  return out
}

/** Same rules as backend reader.sanitize_text: NFC, no invisible or control characters (a page break reads as a
 *  space), words a PDF hyphenated across lines mended, one blank line between paragraphs. */
export function sanitizeText(text: string): string {
  return text.normalize('NFC').replace(CONTROLS, '').replace(PAGE_BREAKS, ' ').replace(/\u00ad|\u200b|\u200c|\u200d|\u2060|\ufeff/g, '').replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/).map((b) => joinLines(b.split('\n').map((l) => l.replace(/[ \t\u00a0\u2000-\u200a\u202f\u205f\u3000]+/g, ' ').trim()).filter(Boolean)))
    .filter(Boolean).join('\n\n')
}

/** Pasted page HTML -> paragraphs, in the browser. */
/** Authors as typed, one person each: "Alan Robock, Owen Toon"; or, with semicolons between people, "Robock, Alan;
 *  Toon, Owen" (last name first, as library cites write them); or one person last name first, "Robock, Alan". */
export function parseAuthors(typed: string): string[] {
  const flip = (a: string) => { const [last, first] = a.split(',').map((s) => s.trim()); return first ? `${first} ${last}` : last }
  if (typed.includes(';')) return typed.split(';').map((a) => a.trim()).filter(Boolean).map((a) => (a.includes(',') ? flip(a) : a))
  const parts = typed.split(',').map((a) => a.trim()).filter(Boolean)
  return parts.length === 2 && parts.every((p) => !/\s/.test(p)) ? [`${parts[1]} ${parts[0]}`] : parts
}

export function htmlToText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, nav, header, footer, aside, form, noscript').forEach((n) => n.remove())
  const root = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body
  const paras = [...root.querySelectorAll('p, h1, h2, h3, li, blockquote')].map((p) => p.textContent ?? '').filter((t) => t.trim())
  return { title: doc.title.trim(), text: sanitizeText(paras.join('\n\n') || root.textContent || '') }
}

/** Index offsets count code points (Python); the browser and the card files count UTF-16 units. */
export function cpToU16(text: string, i: number): number {
  let units = 0
  let cp = 0
  for (const ch of text) {
    if (cp >= i) break
    units += ch.length
    cp++
  }
  return units
}

// ---------------------------------------------------------------- what the server accepts

/** Control characters but tab, newline and carriage return. */
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x08\x0e-\x1f\x7f-\x9f]/g
/** A vertical tab or form feed (a PDF's page break) reads as a space; in a line, so do line and paragraph separators. */
// eslint-disable-next-line no-control-regex
const PAGE_BREAKS = /[\x0b\x0c]/g
// eslint-disable-next-line no-control-regex
const BREAKS = /[\x0b\x0c\u2028\u2029]/g
/** Bidirectional overrides: they make a line read differently from what it holds. */
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g

export const LIMITS = { line: 300, tag: 1000, cite: 2000, url: 2048, query: 500, passage: 500_000, article: 5_000_000 }

/** One line, as the server keeps a title, tag, cite or name: no control characters, whitespace runs to one space. */
export const cleanLine = (v: string, max = LIMITS.line) =>
  v.replace(BREAKS, ' ').replace(CONTROLS, '').replace(BIDI, '').replace(/\s+/g, ' ').trim().slice(0, max)

/** A passage keeps its lines; control characters go. */
export const cleanPassage = (v: string) => v.replace(BREAKS, ' ').replace(CONTROLS, '')

export const BAD_URL = 'A link starts with http:// or https:// and names a site.'
export const BAD_DATE = 'Write the date as 2024-03-15, or leave the day off: 2024-03.'

/** The link as the server will take it, or an error in plain words. */
export function checkUrl(raw: string): { url: string } | { error: string } {
  const v = cleanLine(raw, Infinity)
  if (v.length > LIMITS.url) return { error: 'That link is too long.' }
  let u: URL
  try { u = new URL(v) } catch { return { error: BAD_URL } }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || !u.hostname.includes('.') && u.hostname !== 'localhost') return { error: BAD_URL }
  if (u.username || u.password) return { error: 'Links with a username or password can’t be used.' }
  return { url: v }
}

/** A link that's safe to put in an href: http(s) only, so a javascript: or data: link stored in a card or source
 *  never runs. Anything else is null, and the page shows no link. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const r = checkUrl(raw)
  return 'url' in r ? r.url : null
}

/** The site a link is on, for showing it short: "nytimes.com". */
export function siteOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A date as cites write it, in words: 2024-03-15 → "March 15, 2024", 2024-03 → "March 2024", 2024 → "2024". */
export function dateWords(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!m) return String(y)
  return day ? `${MONTHS[m - 1]} ${day}, ${y}` : `${MONTHS[m - 1]} ${y}`
}

/** The month a date is in, as search filters by it ("2024-03"), or null for a year alone. */
export const monthOf = (d: string | null): string | null => (d && d.length >= 7 ? d.slice(0, 7) : null)

/** A publication date as cites use it: 2024-03-15, 2024-03 or 2024; empty is fine. */
export function checkDate(raw: string): { date: string | null } | { error: string } {
  const v = raw.trim()
  if (!v) return { date: null }
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(v)
  if (!m) return { error: BAD_DATE }
  const [y, mo, d] = [Number(m[1]), m[2] ? Number(m[2]) : 1, m[3] ? Number(m[3]) : 1]
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return { error: BAD_DATE }
  return { date: v }
}

// ---------------------------------------------------------------- how much goes in (the server holds the same limits)

/** A card is a short span of an author's words; a source is the article it's cut from; one source gives ten cards.
 *  A scanned page is read into cards at once, so it holds a few cards' worth at most. */
export const WORDS = { card: 400, source: 20_000, page: 1000 }
export const CARDS_PER_SOURCE = 10

/** Words as the server counts them: runs of non-space characters. */
export const countWords = (text: string) => (text.match(/\S+/g) ?? []).length

export const tooLongCard = (n: number) =>
  `A card can be ${WORDS.card} words at most. This one is ${n.toLocaleString()}: cut it to the words that matter.`
export const tooLongSource = (n: number) =>
  `A source can be ${WORDS.source.toLocaleString()} words at most. This one is ${n.toLocaleString()}: keep the part you'll cut from.`
export const SOURCE_FULL = `This source already has ${CARDS_PER_SOURCE} cards cut from it, the most one source can have. Remove one of them to cut another.`

/** The words a field would hold if `pasted` went in where its selection is, when that's more than `max`; else null.
 *  A paste over the limit is refused whole rather than cut short, so nothing lands half in. */
export function pasteOver(field: HTMLTextAreaElement | HTMLInputElement, pasted: string, max: number): number | null {
  const at = field.selectionStart ?? field.value.length, to = field.selectionEnd ?? at
  const n = countWords(field.value.slice(0, at) + pasted + field.value.slice(to))
  return n > max ? n : null
}
