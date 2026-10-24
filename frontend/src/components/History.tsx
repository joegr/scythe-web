import { useEffect, useState } from 'react'
import { history, type Commit } from '../lib/api'
import { changeSentence } from '../lib/doc'

/** git log for one card's file: who changed what, and when, in sentences; any earlier version can be opened. */
export default function History({ path, refreshKey, me, onOpen }: {
  path: string; refreshKey: string | null; me?: string | null; onOpen?: (c: Commit) => void
}) {
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (open) history(path).then(setCommits).catch(() => setCommits([])) }, [open, path, refreshKey])
  return (
    <section className="gap">
      <button className="link" onClick={() => setOpen(!open)}>{open ? 'hide history' : 'history'}</button>
      {open && commits && (
        <ul className="list">
          {commits.map((c, i) => (
            <li key={c.sha} className="row">
              <span style={{ flex: 1 }} title={c.message.split('\n')[0]}>{changeSentence(c.message, c.author === me ? 'You' : c.author)}</span>
              <span>{c.author}, {new Date(c.date).toLocaleString()}</span>
              {onOpen && i > 0 && <button className="link" onClick={() => onOpen(c)}>open this version</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
