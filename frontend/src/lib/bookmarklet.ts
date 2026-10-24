/**
 * "Read in Scythe": a bookmark that sends the article on screen to the reader's paste form. For a page the team's server
 * can't read (a paywall the debater pays for, a site that turns readers away): the debater's own browser has the page
 * open, so the words come from what they're reading, and nothing is fetched. No credentials are touched and the site's
 * checks are left alone. The text only becomes a source when the debater checks it and presses Read, through the same
 * create-source call as any paste.
 *
 * The page's words travel in the new window's name, never in its link (a link is length-limited, logged and shared,
 * and personal data never goes in one). A browser that clears the name falls back to postMessage: the reader asks the
 * window that opened it, and takes only a message from that window, in the expected shape. A site that cuts its
 * windows off from others' leaves neither: the bookmark then offers to copy the page, to paste into the reader.
 */
import { checkDate, checkUrl, cleanLine, countWords, LIMITS, sanitizeText, WORDS } from './text'

/** What the bookmark sends: the article as text, and the citation details the page states about itself. */
export interface ReadPage { text: string; title: string; url: string; authors: string; publisher: string; published: string; words: number }

const NAME = 'scythe-page:'
const READY = 'scythe:ready'
const GOT = 'scythe:got'

/**
 * Runs on the article's page, as the bookmark: it's serialized into a javascript: link, so it uses nothing from
 * outside itself. It reads the article (an <article>, else the block holding most of the page's paragraphs), its title,
 * link, authors, publication and date, and opens Scythe's reader in a new window with them.
 */
export function readThisPage(app: string, limit: number) {
  const d = document
  const SKIP = 'nav, header, footer, aside, form, figcaption, script, style, noscript, button, [aria-hidden="true"], [hidden]'
  const BLOCKS = 'p, h2, h3, h4, li, blockquote, pre'
  const shown = (e: Element) => e.getClientRects().length > 0 && !e.closest(SKIP)
  const words = (e: Element) => ((e as HTMLElement).innerText || e.textContent || '').replace(/\s+/g, ' ').trim()
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = d.querySelector(`meta[name="${n}" i], meta[property="${n}" i], meta[itemprop="${n}" i]`)?.getAttribute('content')?.trim()
      if (v) return v
    }
    return ''
  }
  // Schema.org's article details, which most news sites state: authors, publisher and date.
  type Thing = { [k: string]: unknown }
  const things: Thing[] = []
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') { things.push(x as Thing); walk((x as Thing)['@graph']) }
  }
  d.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { walk(JSON.parse(s.textContent || '')) } catch { /* not ours to fix */ } })
  const story = things.find((t) => /Article|Posting|Report/.test(String(t['@type'])) && (t.author || t.datePublished)) || {}
  const nameOf = (x: unknown): string => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Thing).name || '') : '')
  const people = ([] as unknown[]).concat(story.author || []).map(nameOf)

  // The article: the <article> holding most words, else the element whose paragraphs (and their parents') hold most.
  const size = (root: Element) => [...root.querySelectorAll('p')].filter(shown).reduce((n, p) => n + words(p).length, 0)
  let root: Element | null = [...d.querySelectorAll('article')].filter((a) => !a.closest(SKIP))
    .sort((a, b) => size(b) - size(a))[0] || null
  if (!root || size(root) < 500) {
    const score = new Map<Element, number>()
    for (const p of d.body.querySelectorAll('p')) {
      if (!shown(p)) continue
      const n = words(p).length
      let up = p.parentElement
      for (let k = 1; up && k <= 3; k++, up = up.parentElement) score.set(up, (score.get(up) || 0) + n / k)
    }
    let best = 0
    score.forEach((n, e) => { if (n > best) { best = n; root = e } })
  }
  root = root || d.body
  const paras = [...root.querySelectorAll(BLOCKS)].filter((e) => shown(e) && !e.querySelector(BLOCKS)).map(words).filter(Boolean)
  if (!paras.length) paras.push(words(root))

  // At most `limit` words, whole paragraphs first: the reader says how long the article was.
  let total = 0, kept = 0
  const out: string[] = []
  for (const p of paras) {
    const w = p.split(' ')
    total += w.length
    if (kept < limit) { out.push(w.slice(0, limit - kept).join(' ')); kept += Math.min(w.length, limit - kept) }
  }

  const canonical = d.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || meta('og:url')
  const page = {
    scythe: 'page',
    text: out.join('\n\n'),
    title: meta('og:title', 'twitter:title', 'headline') || nameOf(story.headline) || d.title,
    url: /^https?:\/\//.test(canonical) ? canonical : location.href,
    authors: (people.filter(Boolean).length ? people : [meta('author', 'article:author', 'parsely-author', 'sailthru.author', 'dc.creator')])
      .filter((a) => a && !/^https?:/.test(a)).join(', '),
    publisher: meta('og:site_name', 'application-name') || nameOf(story.publisher),
    published: (meta('article:published_time', 'datePublished', 'parsely-pub-date', 'sailthru.date', 'dc.date', 'date') || String(story.datePublished || '')
      || d.querySelector('time[datetime]')?.getAttribute('datetime') || '').slice(0, 10),
    words: total,
  }
  const there = new URL(app).origin
  const sent = `scythe-page:${JSON.stringify(page)}`
  const w = window.open(`${app}#/?read=1`, sent)
  if (!w) { alert('Scythe couldn’t open a window. Let this site open pop-ups, then click the bookmark again.'); return }
  // If the browser cleared the window's name, the reader asks for the page, and only Scythe's window gets an answer.
  // The reader says when it has the page.
  let box: HTMLElement | null = null
  const answer = (e: MessageEvent) => {
    if (e.source !== w || e.origin !== there) return
    if (e.data === 'scythe:ready') w.postMessage(page, there)
    if (e.data === 'scythe:got') { removeEventListener('message', answer); clearTimeout(late); box?.remove() }
  }
  addEventListener('message', answer)
  setTimeout(() => removeEventListener('message', answer), 120_000)
  // A site that keeps its windows apart from other sites' (Cross-Origin-Opener-Policy: same-origin) leaves the reader
  // nothing to take, and says nothing back. Then a button on this page copies the article, to paste in the reader.
  const late = setTimeout(() => {
    box = d.createElement('div')
    const shadow = box.attachShadow({ mode: 'open' })
    const panel = d.createElement('div')
    panel.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:22rem;padding:12px 14px;background:#fff;color:#111;'
      + 'border:1px solid #111;font:16px/1.4 system-ui,sans-serif;text-align:left'
    const say = d.createElement('p')
    say.style.margin = '0 0 10px'
    say.textContent = 'This site keeps its window apart from Scythe’s. Copy the article, then paste it in Scythe’s reader.'
    const copy = d.createElement('button')
    const close = d.createElement('button')
    copy.textContent = 'Copy the article for Scythe'
    close.textContent = 'close'
    copy.style.cssText = 'font:inherit;padding:2px 12px;border:1px solid #111;border-radius:0;background:#111;color:#fff;cursor:pointer;margin-right:8px'
    close.style.cssText = 'font:inherit;padding:2px 12px;border:1px solid transparent;border-radius:0;background:#eee;color:#111;cursor:pointer'
    copy.onclick = () => navigator.clipboard.writeText(sent).then(
      () => { say.textContent = 'Copied. Paste it in Scythe’s reader, in the article box.' },
      () => { say.textContent = 'Couldn’t copy here. Select the article, copy it, and paste it in Scythe’s reader.' })
    close.onclick = () => box?.remove()
    panel.append(say, copy, close)
    shadow.append(panel)
    d.body.append(box)
  }, 4000)
}

/** The bookmark itself: this Scythe's address, and the page reader, as one javascript: link with nothing loaded. */
export function bookmarklet(app = location.origin + location.pathname): string {
  return `javascript:${encodeURIComponent(`(${readThisPage.toString()})(${JSON.stringify(app)},${WORDS.source});void 0`)}`
}

/** A page copied by the bookmark's button, pasted into the reader's article box; null for any other paste. */
export function pastedPage(text: string): ReadPage | null {
  if (!text.startsWith(NAME)) return null
  try { return asPage(JSON.parse(text.slice(NAME.length))) } catch { return null }
}

/** The bookmark's page in the shape the paste form takes, cleaned as the server will clean it; null if it isn't one. */
export function asPage(raw: unknown): ReadPage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (k: string) => (typeof r[k] === 'string' ? r[k] as string : '')
  if (r.scythe !== 'page' || !str('text').trim()) return null
  let text = sanitizeText(str('text').slice(0, LIMITS.article))
  const words = Math.max(countWords(text), typeof r.words === 'number' && Number.isFinite(r.words) ? r.words : 0)
  if (countWords(text) > WORDS.source) text = (text.match(/\S+\s*/g) ?? []).slice(0, WORDS.source).join('').trim()
  const url = checkUrl(str('url')), date = checkDate(str('published'))
  return {
    text, words,
    title: cleanLine(str('title'), LIMITS.tag),
    url: 'url' in url ? url.url : '',
    authors: cleanLine(str('authors'), LIMITS.cite),
    publisher: cleanLine(str('publisher')),
    published: 'date' in date && date.date ? date.date : '',
  }
}

let received: Promise<ReadPage | null> | null = null

/**
 * The page the bookmark sent, for a reader opened at #/?read=1: from the window's name (cleared once read, so it
 * doesn't stay with the tab), else asked of the window that opened this one. Null if nothing comes within `wait` ms.
 * Taken once per window: asking again gives the same answer.
 */
export function receivePage(wait = 10_000): Promise<ReadPage | null> {
  return (received ??= take(wait))
}

function take(wait: number): Promise<ReadPage | null> {
  const opener = window.opener as Window | null
  // Tells the bookmark the page came, so it doesn't offer to copy it. No data goes with it.
  const got = (p: ReadPage | null) => { if (p) opener?.postMessage(GOT, '*'); return p }
  if (window.name.startsWith(NAME)) {
    const p = pastedPage(window.name)
    window.name = ''
    return Promise.resolve(got(p))
  }
  if (!opener) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (p: ReadPage | null) => { removeEventListener('message', take); clearTimeout(timer); resolve(got(p)) }
    // Only the window that opened this one, a web page, with a page in the bookmark's shape.
    const take = (e: MessageEvent) => {
      if (e.source !== opener || !/^https?:\/\//.test(e.origin)) return
      const p = asPage(e.data)
      if (p) done(p)
    }
    const timer = setTimeout(() => done(null), wait)
    addEventListener('message', take)
    opener.postMessage(READY, '*') // says only that the reader is open: no data goes with it
  })
}
