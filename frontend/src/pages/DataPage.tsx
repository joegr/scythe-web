import { useCallback, useEffect, useState } from 'react'
import { api, download } from '../lib/api'
import { useSignedIn } from '../lib/session'

interface ModelRun {
  name: string; ready: boolean; status?: string; n_train?: number; n_dev?: number; card_ids?: number[]
  started?: string; performance?: Record<string, number>
}
interface ModelStatus { base_model: string; active: ModelRun | null; runs: ModelRun[]; training: boolean }

/** How often a run's suggestions are marks the team itself made (spancat precision on held-out cards). */
const matchRate = (r: ModelRun) => {
  const p = Object.entries(r.performance ?? {}).find(([k]) => k.endsWith('_p'))?.[1]
  return p != null ? Math.round(p * 100) : null
}

/** The team's cutting: teach Scythe to suggest marks, and take the cards out for spaCy. */
export default function DataPage() {
  const signedIn = useSignedIn()
  const [model, setModel] = useState<ModelStatus | null>(null)
  const [learning, setLearning] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(() => {
    api<ModelStatus>('GET', '/model').then((m) => { setModel(m); if (!m.training) setLearning(null) }).catch((e) => setMessage(e.message))
  }, [])
  useEffect(reload, [reload])
  useEffect(() => {
    if (!model?.training) return
    const t = setInterval(reload, 3_000)
    return () => clearInterval(t)
  }, [model?.training, reload])

  const act = (fn: () => Promise<unknown>, done: string) => fn().then(() => setMessage(done)).catch((e) => setMessage(e.message))
  const get = (path: string, name: string) => act(() => download(path, name), `Downloaded ${name}.`)
  const learn = () => {
    setMessage(null)
    api<{ run: string; cards: number }>('POST', '/model/train?max_steps=2000')
      .then((r) => { setLearning(r.cards); reload() }).catch((e) => setMessage(e.message))
  }
  const cards = learning ?? model?.runs.find((r) => r.status === 'training')?.card_ids?.length ?? null
  const rate = model?.active ? matchRate(model.active) : null

  return (
    <div className="stack">
      <section className="gap">
        <h1>Team</h1>
        <p>How this team cuts: the marks on the cards you’ve approved.</p>
        {message && <p className="note">{message}</p>}
      </section>
      {model && (
        <section className="gap">
          <h2>Suggested highlighting</h2>
          <p>Scythe learns the team’s underlining and highlighting from approved cards, then suggests marks on new ones. A suggestion is dotted until someone keeps it.</p>
          {model.training
            ? <p>{cards != null ? `Learning from ${cards} approved ${cards === 1 ? 'card' : 'cards'}…` : 'Learning…'}</p>
            : model.active
              ? <p>{rate != null ? `Suggestions match the team’s highlighting ${rate}% of the time.` : 'Suggestions are ready.'} Learned {model.active.started ? `on ${new Date(model.active.started).toLocaleDateString()}` : ''} from {model.active.card_ids?.length ?? model.active.n_train ?? 'the team’s'} cards.</p>
              : <p>Not taught yet.</p>}
          {signedIn && (
            <button className="link" disabled={model.training} onClick={learn}>learn the team’s cutting</button>
          )}
        </section>
      )}
      <section className="gap">
        <h2>Training data</h2>
        <p>Every card, with its marks and the names, places and dates Scythe found, ready for spaCy.</p>
        <ul className="list">
          <li><button className="link" onClick={() => get('/spacy/export.spacy', 'scythe.spacy')}>DocBin (.spacy)</button></li>
          <li><button className="link" onClick={() => get('/spacy/export.jsonl?format=docjson', 'scythe-docjson.jsonl')}>spaCy Doc JSON lines</button></li>
          <li><button className="link" onClick={() => get('/spacy/export.jsonl?format=prodigy', 'scythe-prodigy.jsonl')}>Prodigy JSONL</button></li>
          <li><button className="link" onClick={() => get('/spacy/training-bundle.zip', 'scythe-train.zip')}>Training bundle</button></li>
        </ul>
      </section>
    </div>
  )
}
