import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CardView from '../components/CardView'
import Divergence from '../components/Divergence'
import History from '../components/History'
import Links from '../components/Links'
import NameCard from '../components/NameCard'
import { People } from '../components/People'
import Reader from '../components/Reader'
import { snapChars, type SpanRec } from '../lib/doc'
import { useCard, useLabels } from '../lib/hooks'
import { useSignedIn } from '../lib/session'
import {
  acceptSuggestion, archiveCard, DivergedSave, force, getCard, ops, rebase, rejectSuggestion, save, settleName, spanKey, suggest,
  type Divergence as D, type Op, type Verdict,
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
  // The name pointed at, or tapped (pinned until closed): who it is, and the team's verdicts on it.
  const [named, setNamed] = useState<{ id: number; el: HTMLElement; pinned: boolean } | null>(null)
  const closing = useRef<number | undefined>(undefined)
  const hold = () => window.clearTimeout(closing.current)
  const letGo = () => { hold(); closing.current = window.setTimeout(() => setNamed((p) => (p?.pinned ? p : null)), 300) }

  useEffect(() => {
    if (!named?.pinned) return
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.name-card, [data-ent]')) setNamed(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setNamed(null) }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc) }
  }, [named?.pinned])

  useEffect(() => { if (card) setPlace({ file: card.file ?? '', block: card.block ?? '' }) }, [card?.file, card?.block]) // eslint-disable-line react-hooks/exhaustive-deps

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
      else setMessage((e as Error).message)
    } finally { setSaving(false) }
  }, [setCard])

  const commit = useCallback((op: Op) => { if (card) run(() => save(card, op)) }, [card, run])

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

  /** One verdict on a name: a commit of the card's `names` and the team's names.json, then the card as it is now. */
  const settle = useCallback((spanId: number, words: string, verdict: Verdict, item?: string) => {
    run(async () => {
      await settleName(spanId, verdict, item ?? null)
      setNamed(null)
      setMessage(verdict === 'not_a_name' ? `“${words}” isn't a name.`
        : verdict === 'wrong' && !item ? `“${words}” is nobody we can name.` : `“${words}” is checked, on every card that names them.`)
      return getCard(n)
    })
  }, [n, run])

  const apply = useCallback((name: string) => {
    const label = labels.find((l) => l.name === name)
    if (!selection || !label || !card) return
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    try { commit(ops.addSpan(card.meta.text, label, selection[0], selection[1])) } catch (e) { setMessage((e as Error).message) }
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
      if ((e.key === 'Backspace' || e.key === 'Delete') && active) { e.preventDefault(); setActive(null); commit(ops.removeSpan(card.meta.text, active)); return }
      if (e.key === 'Escape') { setActive(null); setSelection(null); window.getSelection()?.removeAllRanges() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, labels, selection, active, apply, card, commit, decide])

  if (error) return <p className="error">{error}</p>
  if (!card) return null

  const pick = (spans: SpanRec[]) => {
    if (window.getSelection()?.isCollapsed === false) return
    const sorted = spans.filter((s) => s.key !== 'ents').sort((a, b) => (a.end_char - a.start_char) - (b.end_char - b.start_char))
    if (!sorted.length) return
    const i = active ? sorted.findIndex((s) => spanKey(s) === spanKey(active)) : -1
    setActive(sorted[(i + 1) % sorted.length])
  }

  const entAt = (t: EventTarget) => (t as Element).closest?.('[data-ent]') as HTMLElement | null
  const namedSpan = named ? card.meta.spans.find((s) => s.key === 'ents' && s.id === named.id) : undefined
  const toCheck = card.namesToCheck ?? 0

  return (
    <div className="stack">
      {signedIn && card.state === 'open' && (
        <div className="row no-print">
          {labels.map((l) => (
            <button key={`${l.key}-${l.name}`} className="link" disabled={!selection || !editable} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(l.name)}>
              {l.hotkey && <kbd>{l.hotkey}</kbd>} {l.name}
            </button>
          ))}
          <span className="spacer">{saving ? 'committing…' : card.sha ? `at ${card.sha.slice(0, 7)}` : ''}</span>
        </div>
      )}

      {/* A name shows who it is under the pointer, and stays open with its verdicts once clicked or tapped. */}
      <div onMouseOver={(e) => {
        const el = entAt(e.target)
        if (!el) return
        hold()
        if (!named?.pinned) setNamed({ id: Number(el.dataset.ent), el, pinned: false })
      }} onMouseOut={(e) => { if (entAt(e.target) && !named?.pinned) letGo() }}
      onClick={(e) => {
        const el = entAt(e.target)
        if (el && window.getSelection()?.isCollapsed !== false) { hold(); setNamed({ id: Number(el.dataset.ent), el, pinned: true }) }
      }}>
      <CardView card={card} link={false} editable={!!editable} showEntities={entities}
        activeKey={active ? spanKey(active) : null} mark={selection} onSpanClick={pick}
        onSelect={(r) => { const s = r ? snapChars(card.meta.text, r[0], r[1]) : null; setSelection(s); setFromCase(false); if (s) setActive(null) }}
        onChange={(patch) => {
          if (patch.title !== undefined && patch.title.trim()) commit(ops.set('title', patch.title.trim()))
          if (patch.cite !== undefined) commit(ops.set('cite', patch.cite))
        }}
        meta={editable && <button className="link" onClick={() => commit(ops.approve(!card.approved))}>{card.approved ? 'unapprove' : 'approve'}</button>} />
      </div>
      {entities && named && namedSpan?.id !== undefined && named.el.isConnected && (
        <NameCard span={namedSpan} words={card.meta.text.slice(namedSpan.start_char, namedSpan.end_char)} anchor={named.el}
          names={card.names} canSettle={!!editable} busy={saving}
          onSettle={(verdict, item) => settle(namedSpan.id!, card.meta.text.slice(namedSpan.start_char, namedSpan.end_char), verdict, item)}
          onClose={() => setNamed(null)} onPointer={(inside) => (inside ? hold() : letGo())} />
      )}

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
        <button className={`link ${entities ? 'on' : ''}`} aria-pressed={entities} onClick={() => { setEntities(!entities); setNamed(null) }}>names and places</button>
        {toCheck > 0 && <span>{toCheck} {toCheck === 1 ? 'name' : 'names'} to check before it's approved</span>}
        {editable && <button className="link" onClick={askModel}>suggest</button>}
        {card.state === 'open' && <span>{card.processed ? 'Words checked' : 'Checking words…'}</span>}
      </div>
      {entities && <People card={card} />}

      <Links card={card} commit={commit} canEdit={!!editable} />

      <section className="gap">
        <h3>Filed under</h3>
        <p>
          {editable
            ? <button className="link" onClick={async () => {
                const t = await choose()
                commit(ops.topic({ slug: t.slug, event: t.event, season: t.season, period: t.period, resolution: t.resolution }))
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

      <History path={`cards/${card.number}.md`} refreshKey={card.sha} />

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
