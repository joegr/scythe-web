import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CARDS_PER_SOURCE, countWords, htmlToText, pasteOver, safeUrl, sanitizeText, siteOf, SOURCE_FULL, tooLongSource, WORDS } from '../lib/text'
import { ApiError, config } from '../lib/api'
import { snapChars } from '../lib/doc'
import { selectionRange } from '../lib/render'
import { readPhoto } from '../lib/scan'
import { cardsCutFrom, createCard, createSource, defaultCite, fetchSource, getSource, listSources, locate, type SourceDoc } from '../lib/store'
import { topicLabel, useTopic } from '../lib/topic'
import PhotoPick from './PhotoPick'

interface Props { open: boolean; onClose: () => void; onCut: (card: number) => void; sourceNumber?: number | null }

/** Reader: a source as clean text. Select a passage (or paste one to find it) and cut it verbatim. */
export default function Reader({ open, onClose, onCut, sourceNumber }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const { current: topic, require, choose } = useTopic()
  const [mode, setMode] = useState<'paste' | 'url' | 'photo'>('paste')
  const [note, setNote] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [paste, setPaste] = useState({ text: '', title: '', url: '', authors: '', publisher: '', published: '' })
  const [source, setSource] = useState<SourceDoc | null>(null)
  const [recent, setRecent] = useState<{ number: number; title: string }[]>([])
  const [range, setRange] = useState<[number, number] | null>(null)
  const [passage, setPassage] = useState('')
  const [form, setForm] = useState({ title: '', cite: '', file: '', block: '' })
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cards already cut from the open source (null: not known yet): one source gives at most CARDS_PER_SOURCE.
  const [cuts, setCuts] = useState<number | null>(null)
  // Only the source asked for last is shown: an earlier one that loads late (a slow click before a quick one) is dropped.
  const asked = useRef(0)
  const openNumber = (n: number) => run(async () => {
    const ticket = ++asked.current
    setSource((s) => (s?.number === n ? s : null))
    const s = await getSource(n)
    if (ticket === asked.current) load(s)
  })

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
    if (!open) return
    setError(null)
    setRange(null)
    if (sourceNumber) openNumber(sourceNumber)
    else { asked.current++; setSource(null); listSources().then(setRecent).catch(() => {}) }
  }, [open, sourceNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { textRef.current?.querySelector('.reader-sel')?.scrollIntoView({ block: 'center' }) }, [range])

  function load(s: SourceDoc) {
    setSource(s)
    setCuts(null)
    const ticket = asked.current
    cardsCutFrom(s.number).then((n) => { if (ticket === asked.current) setCuts(n) }).catch(() => setCuts(null))
    setForm((f) => ({ ...f, cite: s.head.cite || defaultCite(s.head) }))
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const openSource = () => run(async () => {
    if (mode === 'url') {
      setFetching(true)
      try {
        const ticket = ++asked.current
        const s = await getSource(await fetchSource(url.trim()))
        if (ticket === asked.current) load(s)
      } catch (e) {
        if (e instanceof ApiError && e.status === 422) {
          // The site refused, or the page has no article: the server says which, and what to do ("Open it in your
          // browser and paste the article's text instead; the link is kept."). The paste form opens with the link.
          setMode('paste'); setPaste((p) => ({ ...p, url: url.trim() }))
          throw new Error(e.message || 'Couldn\'t read this page. Paste the article\'s text instead.')
        }
        throw e
      } finally { setFetching(false) }
      return
    }
    const isHtml = /^\s*</.test(paste.text)
    const parsed = isHtml ? htmlToText(paste.text) : { title: '', text: sanitizeText(paste.text) }
    const authors = paste.authors.split(/;|,/).map((a) => a.trim()).filter(Boolean)
    const meta = { title: paste.title || parsed.title || parsed.text.slice(0, 80), url: paste.url || null, publisher: paste.publisher,
      published: paste.published || null, authors }
    load(await getSource(await createSource({ ...meta, text: parsed.text, cite: defaultCite(meta) })))
  })

  /** A passage picked in the text also fills the find field, so it can be found again. */
  const pick = (r: [number, number]) => {
    setRange(r)
    if (source) setPassage(source.text.slice(r[0], r[1]))
  }

  const find = () => {
    if (!source) return
    const r = locate(source.text, passage)
    if (r) setRange(r); else setError('That passage isn’t in this source.')
  }

  const cut = () => run(async () => {
    if (!source || !range) return
    const t = await require()
    let [a, b] = range
    while (a < b && /\s/.test(source.text[a])) a++
    while (b > a && /\s/.test(source.text[b - 1])) b--
    const text = source.text.slice(a, b)
    // No tag yet (a cut from the tooltip): the passage's first words, to change on the card.
    const title = form.title.trim() || firstWords(text)
    const card = await createCard({ text, title, cite: form.cite, url: source.head.url ?? '',
      source: source.number, topic: t, file: form.file || null, block: form.block || null })
    setForm((f) => ({ ...f, title: '' })); setPassage(''); setRange(null)
    setCuts((n) => (n === null ? null : n + 1))
    onCut(card)
  })

  // A card is at most WORDS.card words, and a source gives at most CARDS_PER_SOURCE cards: past either, no cut.
  const picked = source && range ? countWords(source.text.slice(range[0], range[1])) : 0
  const full = cuts !== null && cuts >= CARDS_PER_SOURCE
  const cutBlocked = picked > WORDS.card || full
  const pastedWords = /^\s*</.test(paste.text) ? null : countWords(paste.text)

  // The cut tooltip sits just above the selected words.
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const box = textRef.current, sel = box?.querySelector<HTMLElement>('.reader-sel')
    if (!box || !sel || !range) { setTip(null); return }
    const b = box.getBoundingClientRect(), r = sel.getClientRects()[0] ?? sel.getBoundingClientRect()
    setTip({ top: r.top - b.top, left: Math.max(0, r.left - b.left) })
  }, [range, source])

  const paragraphs = useMemo(() => {
    if (!source) return []
    let pos = 0
    return source.text.split('\n\n').map((text) => { const p = { start: pos, text }; pos += text.length + 2; return p })
  }, [source])

  return (
    <dialog ref={ref} className="sheet" onCancel={onClose}>
      <div className="sheet-inner stack">
        <div className="row">
          <h1>{source ? source.title || 'Untitled source' : 'Open a source'}</h1>
          <button className="link spacer" onClick={onClose}>close</button>
        </div>
        {error && <p className="error">{error}</p>}

        {!source ? (
          <div className="stack">
            <div className="gap">
              <div className="row">
                <button className={`link ${mode === 'paste' ? 'on' : ''}`} aria-pressed={mode === 'paste'} onClick={() => setMode('paste')}>paste text or page HTML</button>
                <button className={`link ${mode === 'url' ? 'on' : ''}`} aria-pressed={mode === 'url'} onClick={() => setMode('url')}>fetch a link</button>
                <button className={`link ${mode === 'photo' ? 'on' : ''}`} aria-pressed={mode === 'photo'} onClick={() => setMode('photo')}>from a photo</button>
              </div>
              {mode === 'photo' ? (
                <>
                  <PhotoPick onPhoto={(f) => run(async () => {
                    const d = await readPhoto(f)
                    setPaste((p) => ({ ...p, text: d.text }))
                    setMode('paste')
                    setNote('Read from the photo. Check the words against the page, add the title and author, then read it.')
                  })} />
                  <p>{busy ? 'Reading the photo… this takes a few seconds.'
                    : 'A photo of a book page, a printout or a screenshot. Your team’s server reads the words (the photo isn’t kept), and they become a source to cut from.'}</p>
                </>
              ) : mode === 'url' ? (
                <input className="field" type="url" placeholder="https://" maxLength={2048} value={url} onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && url.trim() && openSource()} />
              ) : (
                <>
                  <textarea className="field" rows={8} placeholder="Article text, or the page's HTML" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })}
                    onPaste={(e) => {
                      // An article over the limit isn't taken in: say so, and leave the field as it was.
                      const pasted = e.clipboardData.getData('text')
                      const n = /^\s*</.test(pasted) ? null : pasteOver(e.currentTarget, pasted, WORDS.source)
                      if (n !== null) { e.preventDefault(); setError(tooLongSource(n)) }
                    }} />
                  {pastedWords !== null && pastedWords > 0 && (
                    <p className={pastedWords > WORDS.source ? 'error' : undefined}>
                      {pastedWords.toLocaleString()} of {WORDS.source.toLocaleString()} words{pastedWords > WORDS.source ? ': too long to keep. Paste the part you’ll cut from.' : ''}
                    </p>
                  )}
                  <input className="field" placeholder="Title" maxLength={1000} value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} />
                  <input className="field" placeholder="Link" maxLength={2048} value={paste.url} onChange={(e) => setPaste({ ...paste, url: e.target.value })} />
                  <input className="field" placeholder="Authors, separated by commas" maxLength={2000} value={paste.authors} onChange={(e) => setPaste({ ...paste, authors: e.target.value })} />
                  <div className="row">
                    <input className="field" style={{ flex: 2 }} placeholder="Publication" maxLength={300} value={paste.publisher} onChange={(e) => setPaste({ ...paste, publisher: e.target.value })} />
                    <input className="field" style={{ flex: 1 }} placeholder="Date, YYYY-MM-DD" maxLength={10} value={paste.published} onChange={(e) => setPaste({ ...paste, published: e.target.value })} />
                  </div>
                </>
              )}
              {mode === 'paste' && note && <p className="note">{note}</p>}
              {mode !== 'photo' && <p>{mode === 'url'
                ? 'Scythe reads the article and keeps its text, exactly as written. Paywalled pages can’t be read; paste those.'
                : 'The article’s text is kept exactly as you paste it, so every card cut from it is word for word.'}</p>}
              {mode !== 'photo' && (
                <button className="action" disabled={busy || (mode === 'url' ? !url.trim() : !paste.text.trim() || (pastedWords ?? 0) > WORDS.source)} onClick={openSource}>
                  {fetching ? 'Reading the article…' : busy ? 'Saving…' : 'Read'}
                </button>
              )}
            </div>
            {recent.length > 0 && (
              <ul className="list">
                {recent.slice(0, 8).map((s) => (
                  <li key={s.number}><button className="link" onClick={() => openNumber(s.number)}>{s.title}</button> #{s.number}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <p>
              {[source.head.authors.join(', '), source.head.publisher, source.head.published].filter(Boolean).join(' · ')}
              {safeUrl(source.head.url) && <> · <a href={safeUrl(source.head.url)!} target="_blank" rel="noreferrer noopener">original, {siteOf(safeUrl(source.head.url)!)}</a></>}
              {' · '}<a href={`${config.apiBase()}/api/git/file?path=sources/${source.number}.md`} target="_blank" rel="noreferrer">#{source.number}</a>
              {cuts !== null && <> · {cuts} of {CARDS_PER_SOURCE} cards cut</>}
            </p>
            {full && <p className="note">{SOURCE_FULL}</p>}
            <div ref={textRef} className="reader-text" onMouseUp={(e) => {
                // The words picked show as the whole tokens they touch, as on a card (snapChars); the browser's
                // ragged selection goes. A double click still takes the whole paragraph, after this.
                const r = selectionRange(e.currentTarget), s = r && snapChars(source.text, r[0], r[1])
                if (s) { window.getSelection()?.removeAllRanges(); pick(s) }
              }}
              onDoubleClick={(e) => {
                // A double click takes the whole paragraph, not the word the browser picked.
                const p = (e.target as HTMLElement).closest<HTMLElement>('p[data-para]')
                if (!p) return
                window.getSelection()?.removeAllRanges()
                pick([Number(p.dataset.para), Number(p.dataset.paraEnd)])
              }}>
              {paragraphs.map((p) => <Para key={p.start} {...p} range={range} />)}
              {tip && (
                <div className="cut-tip" style={{ top: tip.top, left: tip.left }} role="toolbar" aria-label="Selected words">
                  <button className="action" disabled={busy || cutBlocked} onMouseDown={(e) => e.preventDefault()} onClick={cut}
                    title={picked > WORDS.card ? `${picked} words: a card is ${WORDS.card} at most` : full ? SOURCE_FULL : undefined}>cut</button>
                </div>
              )}
            </div>
            <div className="cut-bar">
              <div className="inner gap">
                <div className="row">
                  <input className="field" style={{ flex: 1, minWidth: '12rem' }} placeholder="Paste a copied passage to find it" maxLength={100000} value={passage}
                    onChange={(e) => setPassage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && passage.trim() && find()} />
                  <button className="link" disabled={!passage.trim()} onClick={find}>find</button>
                </div>
                <input className="field" style={{ fontWeight: 600 }} placeholder="Tag" maxLength={1000} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <input className="field" placeholder="Cite" maxLength={2000} value={form.cite} onChange={(e) => setForm({ ...form, cite: e.target.value })} />
                <div className="row">
                  <button className="link" onClick={() => choose()} title={topic?.resolution}>{topic ? topicLabel(topic) : 'choose a topic'}</button>
                  <input className="field" style={{ flex: 1, minWidth: '6rem' }} placeholder="File" maxLength={300} value={form.file} onChange={(e) => setForm({ ...form, file: e.target.value })} />
                  <input className="field" style={{ flex: 1, minWidth: '6rem' }} placeholder="Block" maxLength={300} value={form.block} onChange={(e) => setForm({ ...form, block: e.target.value })} />
                  <span className={picked > WORDS.card ? 'error' : undefined}>
                    {range ? `${(range[1] - range[0]).toLocaleString()} characters · ${picked.toLocaleString()} of ${WORDS.card} words${picked > WORDS.card ? ': too long for a card' : ''}` : 'select text above'}
                  </span>
                  <button className="action" disabled={!range || busy || !form.title.trim() || cutBlocked} onClick={cut}>Cut</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}

function Para({ start, text, range }: { start: number; text: string; range: [number, number] | null }) {
  const end = start + text.length
  if (!range || range[1] <= start || range[0] >= end) return <p data-para={start} data-para-end={end}><span data-start={start}>{text}</span></p>
  const a = Math.max(start, range[0]) - start
  const b = Math.min(end, range[1]) - start
  return (
    <p data-para={start} data-para-end={end}>
      {a > 0 && <span data-start={start}>{text.slice(0, a)}</span>}
      <span data-start={start + a} className="reader-sel">{text.slice(a, b)}</span>
      {b < text.length && <span data-start={start + b}>{text.slice(b)}</span>}
    </p>
  )
}

/** A tag to start from: the passage's first words. */
function firstWords(text: string, max = 8): string {
  const words = text.split(/\s+/).filter(Boolean)
  return words.slice(0, max).join(' ') + (words.length > max ? '…' : '')
}
