import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CardView from '../components/CardView'
import Divergence from '../components/Divergence'
import History from '../components/History'
import Links from '../components/Links'
import { People } from '../components/People'
import Reader from '../components/Reader'
import { ApiError, type Commit } from '../lib/api'
import { snapChars, type SpanRec } from '../lib/doc'
import { useCard, useLabels } from '../lib/hooks'
import { namesToCheck, settleName, type Verdict } from '../lib/names'
import { useSignedIn, useUser } from '../lib/session'
import {
  acceptSuggestion, archiveCard, bringBack, cardAt, DivergedSave, force, getCard, ops, putBack, rebase, rejectSuggestion, save, spanKey, suggest,
  type CardDoc, type Divergence as D, type Op,
} from '../lib/store'
import { topicLabel, useTopic } from '../lib/topic'

/** Select text, press a label's key. Every change is a git commit to cards/<n>.md. */
export default function CardPage() {
  const n = Number(useParams().id)
  const navigate = useNavigate()
  const signedIn = useSignedIn()
  const { card, setCard, reload, error } = useCard(n)
  const { labels } = useLabels()
  const { choose } = useTopic()
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const [active, setActive] = useState<SpanRec | null>(null)
  const [entities, setEntities] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [diverged, setDiverged] = useState<D | null>(null)
  const [reader, setReader] = useState(false)
  const [place, setPlace] = useState({ file: '', block: '' })
  const [removing, setRemoving] = useState(false)
  // An earlier version opened from the history, shown in the card's place until put back or closed.
  const [version, setVersion] = useState<{ commit: Commit; card: CardDoc; content: string } | null>(null)
  const me = useUser()?.handle

  useEffect(() => { if (card) setPlace({ file: card.file ?? '', block: card.block ?? '' }) }, [card?.file, card?.block]) // eslint-disable-line react-hooks/exhaustive-deps
  // Another card (followed from a link): it opens the way a card always does, names hidden and nothing chosen.
  useEffect(() => { setEntities(false); setActive(null); setSelection(null); setMessage(null); setRemoving(false); setVersion(null) }, [n])

  // Followed from a case (#/cards/12?words=33-60): mark the words it reads.
  const words = useSearchParams()[0].get('words')
  const [fromCase, setFromCase] = useState(false)
  const loaded = card !== null
  useEffect(() => {
    const m = /^(\d+)-(\d+)$/.exec(words ?? '')
    if (!loaded || !m || !card) return
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a >= b || b > card.meta.text.length) return
    setSelection([a, b]); setFromCase(true)
    requestAnimationFrame(() => document.querySelector('.card .t-mark')?.scrollIntoView({ block: 'center' }))
  }, [words, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (fn: () => ReturnType<typeof save>) => {
    setSaving(true); setMessage(null)
    try { setCard(await fn()); setDiverged(null) } catch (e) {
      if (e instanceof DivergedSave) setDiverged(e.d)
      else {
        setMessage((e as Error).message)
        // Approval refused until the card's names are checked: show the names, and which still wait.
        if (e instanceof ApiError && e.status === 422 && /names in this card/i.test(e.message)) setEntities(true)
      }
    } finally { setSaving(false) }
  }, [setCard])

  const commit = useCallback((op: Op) => { if (card) run(() => save(card, op)) }, [card, run])

  /** A verdict on a name: the server commits it (to this card's names and the team's names.json), then the card
   *  reloads, so the name shows as checked once Scythe has re-read the card. */
  const settle = useCallback(async (span: SpanRec, verdict: Verdict, id: string | null) => {
    if (span.id === undefined) return
    const spanId = span.id
    await run(async () => {
      try { await settleName(spanId, verdict, id) } catch (e) {
        // Scythe re-read the card since this name was shown (the last verdict): the same words, found again.
        if (!(e instanceof ApiError && e.status === 404)) throw e
        const again = (await getCard(n)).meta.spans.find((s) => s.key === 'ents' && s.start_char === span.start_char && s.end_char === span.end_char)
        if (again?.id === undefined || again.id === spanId) throw e
        await settleName(again.id, verdict, id)
      }
      return getCard(n)
    })
  }, [n, run])

  /** The team's model: ask, then Enter keeps a suggestion (a commit) and x drops it for good. */
  const askModel = useCallback(async () => {
    await run(async () => {
      const added = await suggest(n)
      setMessage(added
        ? `${added} ${added === 1 ? 'suggestion' : 'suggestions'}, dotted. Click one: Enter keeps it, x drops it.`
        : 'No suggestions for this card.')
      return getCard(n)
    })
  }, [n, run])
  const decide = useCallback((s: SpanRec, keep: boolean) => {
    setActive(null)
    run(async () => {
      if (keep) await acceptSuggestion(s.id!)
      else {
        await rejectSuggestion(s.id!)
        setMessage(`Dropped. Scythe won’t suggest that ${s.label} here again.`)
      }
      return getCard(n)
    })
  }, [n, run])

  const apply = useCallback((name: string) => {
    const label = labels.find((l) => l.name === name)
    if (!selection || !label || !card) return
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    // The same key again over the same words takes that mark off.
    const same = card.meta.spans.find((s) => s.label === label.name && s.key === label.key && s.start_char === selection[0] && s.end_char === selection[1])
    try { commit(same ? ops.removeSpan(card.meta.text, same) : ops.addSpan(card.meta.text, label, selection[0], selection[1])) } catch (e) { setMessage((e as Error).message) }
  }, [selection, labels, card, commit])

  const editable = signedIn && card?.state === 'open' && !saving && !diverged

  useEffect(() => {
    if (!editable || !card) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return
      if (active?.id !== undefined && !selection) {
        if (e.key === 'Enter') { e.preventDefault(); decide(active, true); return }
        if (e.key === 'x' || e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); decide(active, false); return }
      }
      const label = labels.find((l) => l.hotkey && l.hotkey === e.key)
      if (label && selection) { e.preventDefault(); apply(label.name); return }
      // Only spaces selected: say so, rather than do nothing.
      const sel = window.getSelection()
      if (label && sel && !sel.isCollapsed && !sel.toString().trim() && document.querySelector('.card .token-text')?.contains(sel.anchorNode)) {
        e.preventDefault(); setMessage('That selection has no words in it.'); return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && active) { e.preventDefault(); setActive(null); commit(ops.removeSpan(card.meta.text, active)); return }
      if (e.key === 'Escape') { setActive(null); setSelection(null); window.getSelection()?.removeAllRanges() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, labels, selection, active, apply, card, commit, decide])

  if (error) return <p className="error">{error}</p>
  if (!card) return null

  const toCheck = namesToCheck(card.meta.text, card.meta.spans, card.names)

  const pick = (spans: SpanRec[]) => {
    if (window.getSelection()?.isCollapsed === false) return
    const sorted = spans.filter((s) => s.key !== 'ents').sort((a, b) => (a.end_char - a.start_char) - (b.end_char - b.start_char))
    if (!sorted.length) return
    const i = active ? sorted.findIndex((s) => spanKey(s) === spanKey(active)) : -1
    setActive(sorted[(i + 1) % sorted.length])
  }

  return (
    <div className="stack">
      {signedIn && card.state === 'closed' && (
        <p className="note no-print">This card was removed; its history keeps every version.{' '}
          <button className="link" disabled={saving} onClick={() => run(async () => { await bringBack(n); return getCard(n) })}>bring back</button></p>
      )}
      {signedIn && card.state === 'open' && !version && (
        <div className="row no-print">
          {labels.map((l) => (
            <button key={`${l.key}-${l.name}`} className="link" disabled={!selection || !editable} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(l.name)}>
              {l.hotkey && <kbd>{l.hotkey}</kbd>} {l.name}
            </button>
          ))}
          <span className="spacer">{saving ? 'committing…' : card.sha ? `at ${card.sha.slice(0, 7)}` : ''}</span>
        </div>
      )}

      {version ? (
        <section className="stack">
          <p className="note no-print">The card as it was on {new Date(version.commit.date).toLocaleString()}.{' '}
            {editable && <button className="action" onClick={() => {
              const when = new Date(version.commit.date).toLocaleString()
              setVersion(null)
              run(async () => { await putBack(card, version.content, when); return getCard(n) })
            }}>Put this version back</button>}{' '}
            <button className="link" onClick={() => setVersion(null)}>back to the latest</button></p>
          <CardView card={version.card} link={false} />
        </section>
      ) : <CardView card={card} link={false} editable={!!editable} showEntities={entities}
        activeKey={active ? spanKey(active) : null} mark={selection} onSpanClick={pick}
        onSelect={(r) => { const s = r ? snapChars(card.meta.text, r[0], r[1]) : null; setSelection(s); setFromCase(false); if (s) setActive(null) }}
        onChange={(patch) => {
          if (patch.title !== undefined && patch.title.trim()) commit(ops.set('title', patch.title.trim()))
          if (patch.cite !== undefined) commit(ops.set('cite', patch.cite))
        }}
        onSettle={settle}
        meta={editable && <button className="link" onClick={() => commit(ops.approve(!card.approved))}
          title={card.approved ? 'Take it back: the card isn’t ready for rounds.' : 'Approve when the card is cut and checked, ready for rounds.'}>
          {card.approved ? 'unapprove' : 'approve'}</button>} />}

      <p className="no-print">
        {message ? message : active?.id !== undefined ? (
          <>Suggested {active.label}: “{card.meta.text.slice(active.start_char, active.end_char).slice(0, 60)}”. <kbd>Enter</kbd> keeps it, <kbd>x</kbd> drops it.</>
        ) : active ? (
          <>{active.label}: “{card.meta.text.slice(active.start_char, active.end_char).slice(0, 60)}”. <kbd>⌫</kbd> removes it, <kbd>Esc</kbd> clears.</>
        ) : selection && fromCase ? 'The words a case reads from this card.'
          : selection ? 'Snapped to whole words. Press a label key.'
          : signedIn ? 'Select text, then press a label key. Each change is a commit.' : 'Sign in to edit.'}
      </p>
      <div className="row no-print">
        <button className={`link ${entities ? 'on' : ''}`} aria-pressed={entities} onClick={() => setEntities(!entities)}>names and places</button>
        {editable && <button className="link" onClick={askModel}>suggest</button>}
        {card.state === 'open' && <span>{card.processed ? 'Words checked' : 'Checking words…'}</span>}
      </div>
      {entities && <People card={card} />}
      {entities && card.names !== null && toCheck.length > 0 && (
        <p className="no-print">
          Still to check: {toCheck.join(' · ')}. Point at a name to see who Scythe thinks it is, then say whether that’s right.
          {card.approved ? '' : ' The card is approved once every name is checked.'}
        </p>
      )}

      <Links card={card} commit={commit} canEdit={!!editable} />

      <section className="gap">
        <h3>Filed under</h3>
        <p>
          {editable
            ? <button className="link" onClick={async () => {
                const t = await choose().catch(() => null)
                if (t) commit(ops.topic({ slug: t.slug, event: t.event, season: t.season, period: t.period, resolution: t.resolution }))
              }}>{card.meta.topic ? `${topicLabel(card.meta.topic)}: ${card.meta.topic.resolution}` : 'choose a topic'}</button>
            : card.meta.topic ? `${topicLabel(card.meta.topic)}: ${card.meta.topic.resolution}` : 'no topic'}
        </p>
        {editable && (
          <div className="row">
            <input className="field" style={{ flex: 1 }} placeholder="File" maxLength={300} value={place.file} onChange={(e) => setPlace({ ...place, file: e.target.value })} />
            <input className="field" style={{ flex: 1 }} placeholder="Block" maxLength={300} value={place.block} onChange={(e) => setPlace({ ...place, block: e.target.value })} />
            <button className="link" disabled={place.file === (card.file ?? '') && place.block === (card.block ?? '')}
              onClick={() => commit(ops.place(place.file.trim() || null, place.block.trim() || null))}>file it</button>
          </div>
        )}
      </section>

      <History path={`cards/${card.number}.md`} refreshKey={card.sha} me={me}
        onOpen={(c) => run(async () => {
          const got = await cardAt(n, c.sha)
          if (got) setVersion({ commit: c, ...got }); else setMessage('That version can’t be read.')
          return card
        })} />

      <section className="row">
        {card.meta.source && <button className="link" onClick={() => setReader(true)}>source #{card.meta.source}</button>}
        {card.brief && <Link className="link" to={`/search?brief=${encodeURIComponent(card.brief.name)}`}>
          from {card.brief.name}, {card.brief.pages.length > 1 ? `pages ${card.brief.pages.join('–')}` : `page ${card.brief.pages[0]}`}</Link>}
        <Link className="link" to={`/print/${card.number}`}>print</Link>
        {editable && !removing && <button className="link spacer" onClick={() => setRemoving(true)}>remove</button>}
      </section>
      {removing && (
        <section className="gap note">
          <p>Remove this card? It stays in the history and can be brought back.</p>
          <div className="row">
            <button className="action" disabled={saving} onClick={async () => {
              setSaving(true); setMessage(null)
              try { await archiveCard(card); navigate('/') } catch (e) { setMessage((e as Error).message); setRemoving(false) } finally { setSaving(false) }
            }}>Remove</button>
            <button className="link" onClick={() => setRemoving(false)}>keep it</button>
          </div>
        </section>
      )}

      {diverged && card.record && (
        <Divergence d={diverged} base={card.record} busy={saving}
          onRebase={() => run(() => rebase(card.number, diverged))}
          onTheirs={() => { setDiverged(null); reload() }}
          onForce={() => run(() => force(card.number, diverged))} />
      )}

      <Reader open={reader} onClose={() => setReader(false)} sourceNumber={card.meta.source}
        onCut={(c) => { setReader(false); navigate(`/cards/${c}`) }} />
    </div>
  )
}
