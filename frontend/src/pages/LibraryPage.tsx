import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CardView from '../components/CardView'
import type { TopicRef } from '../lib/doc'
import { library, listCards, type CardDoc } from '../lib/store'
import { topicLabel } from '../lib/topic'

/** The resolutions cards are filed under, and the team's files and blocks. */
export default function LibraryPage() {
  const [topics, setTopics] = useState<TopicRef[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { library().then((l) => { setTopics(l.topics); setFiles(l.files) }).catch((e) => setError(e.message)) }, [])

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <section className="gap">
        <h1>Topics</h1>
        {topics.length === 0 && <p>No cards filed under a topic yet.</p>}
        <ul className="list">
          {topics.map((t) => (
            <li key={t.slug}><Link to={`/search?topic=${t.slug}`}>{t.resolution}</Link><br />{topicLabel(t)}</li>
          ))}
        </ul>
      </section>
      <section className="gap">
        <h1>Files</h1>
        {files.length === 0 && <p>File a card from its page to start a file.</p>}
        <ul className="list">
          {files.map((f) => (
            <li key={f}>
              <button className="link" onClick={() => setOpenFile(openFile === f ? null : f)}>{f}</button>
              {openFile === f && <FileCards file={f} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function FileCards({ file }: { file: string }) {
  const [cards, setCards] = useState<CardDoc[] | null>(null)
  useEffect(() => { listCards({ file }).then(setCards).catch(() => setCards([])) }, [file])
  const blocks = useMemo(() => {
    const m = new Map<string, CardDoc[]>()
    for (const c of cards ?? []) m.set(c.block ?? '', [...(m.get(c.block ?? '') ?? []), c])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [cards])
  if (!cards) return null
  return (
    <div className="stack" style={{ marginTop: '1.5rem' }}>
      <Link className="link" to={`/print/file/${encodeURIComponent(file)}`}>print this file</Link>
      {blocks.map(([block, cs]) => (
        <section key={block} className="stack">
          <h2>{block || 'Unfiled'}</h2>
          {cs.map((c) => <CardView key={c.number} card={c} mode="read" />)}
        </section>
      ))}
    </div>
  )
}
