import { useState } from 'react'
import { DEFAULT_LABELS, type LabelDef } from '../lib/doc'
import { useLabels } from '../lib/hooks'
import { updateSettings } from '../lib/store'
import { useSignedIn } from '../lib/session'

const STYLES = ['underline', 'highlight', 'emphasis', 'custom']
/** Scythe's own marks: every team has them, and they can't be removed (the server refuses too). */
const builtIn = (l: LabelDef) => DEFAULT_LABELS.some((d) => d.name === l.name && d.key === l.key)

/** Labels live in scythe.json in the repo, so everyone using it shares them (and git versions them). */
export default function LabelsPage() {
  const { labels, reload } = useLabels()
  const signedIn = useSignedIn()
  const [draft, setDraft] = useState<LabelDef>({ name: '', key: 'sc', style: 'custom', hotkey: '' })
  const [error, setError] = useState<string | null>(null)
  const save = async (next: LabelDef[]) => {
    // the built-in three always stay, whatever list this is
    const kept = [...DEFAULT_LABELS.filter((d) => !next.some((l) => l.name === d.name && l.key === d.key)), ...next]
    setError(null)
    try { await updateSettings('labels', (s) => ({ ...s, labels: kept })); reload() } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="stack">
      <section className="gap">
        <h1>Labels</h1>
        <p>Marks are how a card’s words are drawn. Underline, highlight and emphasis are Scythe’s own and always here. A team’s
          own mark, for its own drills, draws as a wavy line and is named when you point at it. A mark a card uses that isn’t
          listed yet is added here when the card is saved.</p>
        {error && <p className="error">{error}</p>}
        <ul className="list">
          {labels.map((l, i) => (
            <li key={`${l.key}-${l.name}`} className="row">
              <span style={{ minWidth: '8rem' }}>{l.name}</span><span>{l.key}</span><span>{l.style}</span>
              <span>{l.hotkey ? <>key <kbd>{l.hotkey}</kbd></> : 'no key'}</span>
              {builtIn(l) ? <span className="spacer">Scythe’s own</span>
                : signedIn && <button className="link spacer" onClick={() => save(labels.filter((_, j) => j !== i))}>remove</button>}
            </li>
          ))}
        </ul>
      </section>
      {signedIn && (
        <section className="row">
          {/* A team's mark goes with Scythe's own (key sc). */}
          <input className="field" style={{ width: '10rem' }} aria-label="Mark name" placeholder="New mark" maxLength={100} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select className="field" style={{ width: '8rem' }} aria-label="Drawn as" value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })}>
            {STYLES.map((s) => <option key={s} value={s}>{s === 'custom' ? 'its own line' : s}</option>)}
          </select>
          <input className="field" style={{ width: '3rem' }} aria-label="Key" maxLength={1} placeholder="key" value={draft.hotkey ?? ''} onChange={(e) => setDraft({ ...draft, hotkey: e.target.value })} />
          <button className="link" disabled={!draft.name.trim()} onClick={() => { save([...labels, { ...draft, name: draft.name.trim(), hotkey: draft.hotkey || null }]); setDraft({ ...draft, name: '', hotkey: '' }) }}>Add mark</button>
        </section>
      )}
    </div>
  )
}
