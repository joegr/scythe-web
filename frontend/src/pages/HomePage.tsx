import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import CardView from '../components/CardView'
import Reader from '../components/Reader'
import Scan from '../components/Scan'
import { receivePage, type ReadPage } from '../lib/bookmarklet'
import { isMobile, listCards as listScans } from '../lib/scan'
import { countWords, pasteOver, sanitizeText, tooLongCard, WORDS } from '../lib/text'
import { createCard, createSource, listCards, type CardDoc } from '../lib/store'
import { topicLabel, useTopic } from '../lib/topic'
import { useSignedIn } from '../lib/session'

/** The cut page. At /scan (the menu's "scan", on a phone or tablet) it opens with the scanner. */
export default function HomePage({ scan = false }: { scan?: boolean }) {
  const navigate = useNavigate()
  const signedIn = useSignedIn()
  const { current, require, choose } = useTopic()
  const [reader, setReader] = useState(false)
  // Opened by the "Read in Scythe" bookmark (#/?read=1): the page it sent fills the reader's paste form.
  const [page, setPage] = useState<ReadPage | 'missing' | null>(null)
  const reading = useSearchParams()[0].get('read') === '1'
  // The scanner sheet: closed, on the camera, or on the scans waiting to be checked (from any device).
  const [scanning, setScanning] = useState<false | 'camera' | 'queue'>(scan ? 'camera' : false)
  const [toCheck, setToCheck] = useState(0)
  const [clip, setClip] = useState<{ text: string; title: string; cite: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [recent, setRecent] = useState<CardDoc[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { listCards({ limit: 15 }).then(setRecent).catch((e) => setError(e.message)) }, [])
  useEffect(() => {
    if (!reading) return
    let live = true
    receivePage().then((p) => {
      if (!live) return
      navigate('/', { replace: true })
      setPage(p ?? 'missing'); setReader(true)
    })
    return () => { live = false }
  }, [reading]) // eslint-disable-line react-hooks/exhaustive-deps
  // Scans waiting for this member, counted again each time the scanner closes. Not being able to count them hides
  // the link and nothing else.
  useEffect(() => { if (signedIn && !scanning) listScans().then((cs) => setToCheck(cs.length)).catch(() => setToCheck(0)) }, [signedIn, scanning])

  /** A clip is the author's words as pasted: they're saved as a source, and the card is that whole source, so even a
   *  quick card is the source's own words (the server checks). */
  const saveClip = async () => {
    if (saving) return
    setSaving(true)
    try {
      const t = await require()
      const text = sanitizeText(clip!.text)
      const source = await createSource({ text, title: clip!.title, cite: clip!.cite })
      navigate(`/cards/${await createCard({ text, title: clip!.title, cite: clip!.cite, source, topic: t })}`)
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="stack">
      {signedIn && (
        <section className="gap">
          {isMobile() && <p><button className="action" onClick={() => setScanning('camera')}>Scan a card</button></p>}
          {toCheck > 0 && <p><button className="link" onClick={() => setScanning('queue')}>{toCheck === 1 ? '1 scanned card' : `${toCheck} scanned cards`} to check</button></p>}
          <p>
            <button className="link" onClick={() => setReader(true)}>Open a source</button> to cut a card from it, or{' '}
            <button className="link" onClick={() => setClip(clip ? null : { text: '', title: '', cite: '' })}>paste a clip</button>
.
          </p>
          <p>Topic: <button className="link" onClick={() => choose().catch(() => {})}>{current ? `${topicLabel(current)}: ${current.resolution}` : 'none yet, choose one'}</button></p>
          {clip && (
            <div className="gap">
              <input className="field" placeholder="Tag" maxLength={1000} value={clip.title} onChange={(e) => setClip({ ...clip, title: e.target.value })} style={{ fontWeight: 600 }} />
              <input className="field" placeholder="Cite (author, date, publication)" maxLength={2000} value={clip.cite} onChange={(e) => setClip({ ...clip, cite: e.target.value })} />
              <textarea className="field" rows={5} autoFocus placeholder="The author's words, as written" value={clip.text} onChange={(e) => setClip({ ...clip, text: e.target.value })}
                onPaste={(e) => {
                  // A clip over a card's limit isn't taken in: say so, and leave the field as it was.
                  const n = pasteOver(e.currentTarget, e.clipboardData.getData('text'), WORDS.card)
                  if (n !== null) { e.preventDefault(); setError(tooLongCard(n)) }
                }} />
              {clip.text.trim() && (
                <p className={countWords(clip.text) > WORDS.card ? 'error' : undefined}>
                  {countWords(clip.text)} of {WORDS.card} words{countWords(clip.text) > WORDS.card ? ': too long for a card. Cut it to the words that matter.' : ''}
                </p>
              )}
              <button className="action" disabled={saving || !clip.text.trim() || !clip.title.trim() || countWords(clip.text) > WORDS.card} onClick={saveClip}>{saving ? 'Creating…' : 'Create card'}</button>
            </div>
          )}
        </section>
      )}
      {error && <p className="error">{error}</p>}
      {recent?.length === 0 && <p>No cards yet.</p>}
      {recent?.map((c) => <CardView key={c.number} card={c} mode="read" />)}
      <Reader open={reader} page={page} onClose={() => { setReader(false); setPage(null) }} onCut={(n) => navigate(`/cards/${n}`)} />
      {signedIn && <Scan open={!!scanning} start={scanning || 'camera'} onClose={() => { setScanning(false); if (scan) navigate('/') }}
        onSaved={(n) => { setScanning(false); navigate(`/cards/${n}`) }}
        onSavedBrief={(name) => { setScanning(false); navigate(`/search?brief=${encodeURIComponent(name)}`) }} />}
    </div>
  )
}
