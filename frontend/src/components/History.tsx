import { useEffect, useState } from 'react'
import { history, type Commit } from '../lib/api'
import { LINK_WORDS } from '../lib/doc'

const MARKED: Record<string, string> = { underline: 'underlined', highlight: 'highlighted', emphasis: 'emphasized' }

/** A change to a card, as a sentence: "You highlighted “block sunlight”", "ana took the underline off “Soot”". The
 *  commit message is the record's; this is how a debater reads it. */
export function sentence(message: string, who: string): string {
  const m = message.split('\n')[0].replace(/\s*\(#\d+\)\s*$/, '')
  let r: RegExpExecArray | null
  if ((r = /^card: (.*)$/.exec(m))) return `${who} cut the card “${r[1]}”`
  if ((r = /^title: "(.*)"$/.exec(m))) return `${who} retagged it “${r[1]}”`
  if ((r = /^cite: "(.*)"$/.exec(m))) return `${who} rewrote the cite`
  if ((r = /^remove ([^:]+): "(.*)"$/.exec(m))) return `${who} took the ${r[1]} off “${r[2]}”`
  if ((r = /^([^:]+): "(.*)"$/.exec(m))) return MARKED[r[1]] ? `${who} ${MARKED[r[1]]} “${r[2]}”` : `${who} marked “${r[2]}” ${r[1]}`
  if ((r = /^file: (.*?) \/ (.*)$/.exec(m))) return `${who} filed it under ${r[1]}${r[2].trim() ? `, ${r[2].trim()}` : ''}`
  if (m === 'unfile') return `${who} took it out of its file`
  if (m === 'approve') return `${who} approved it`
  if (m === 'unapprove') return `${who} took the approval back`
  if (/^topic: /.test(m)) return `${who} set its resolution`
  if (/^archive: /.test(m)) return `${who} removed the card`
  if (/^bring back: /.test(m)) return `${who} brought the card back`
  if ((r = /^put back the version of (.*)$/.exec(m))) return `${who} put back the version of ${r[1]}`
  if ((r = /^unlink (.+) #(\d+)$/.exec(m))) return `${who} took off the link to card ${r[2]}`
  if ((r = /^(.+) #(\d+)$/.exec(m))) return `${who} linked it: ${(LINK_WORDS[r[1].replace(' ', '_')] ?? r[1]).toLowerCase()} card ${r[2]}`
  return `${who} changed it: ${m}`
}

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
              <span style={{ flex: 1 }} title={c.message.split('\n')[0]}>{sentence(c.message, c.author === me ? 'You' : c.author)}</span>
              <span>{c.author}, {new Date(c.date).toLocaleString()}</span>
              {onOpen && i > 0 && <button className="link" onClick={() => onOpen(c)}>open this version</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
