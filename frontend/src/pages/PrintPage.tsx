import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { cardMarkdown } from '../lib/doc'
import { renderMarkdown } from '../lib/render'
import { backlinks, getCard, listCards, type CardDoc } from '../lib/store'

/**
 * Print, from each card's committed file (cards/<n>.md, the Markdown it's saved in), so a printout is exactly what
 * was cut and marked:
 *   /print/12             one card
 *   /print/12/frontlines  a card, then every card that answers it
 *   /print/file/Name      a file as a speech document: the file, each block, each card
 * Marks print as underlines (thin: underline, heavy: highlight, double: emphasis).
 */
export default function PrintPage({ frontlines = false }: { frontlines?: boolean }) {
  const { id, file } = useParams()
  const [cards, setCards] = useState<CardDoc[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [condensed, setCondensed] = useState(false)
  const [raw, setRaw] = useState(false)

  useEffect(() => {
    setCards(null)
    const load = async (): Promise<CardDoc[]> => {
      if (file) {
        const listed = (await listCards({ file, limit: 500 }))
          .sort((a, b) => (a.block ?? '').localeCompare(b.block ?? '') || a.number - b.number)
        return Promise.all(listed.map((c) => getCard(c.number)))
      }
      const n = Number(id)
      const first = await getCard(n)
      if (!frontlines) return [first]
      const answers = (await backlinks(n)).filter((b) => b.rel === 'answers').map((b) => b.card.number).sort((a, b) => a - b)
      return [first, ...await Promise.all(answers.map((a) => getCard(a)))]
    }
    load().then(setCards).catch((e) => setError((e as Error).message))
  }, [id, file, frontlines])

  let source = ''
  if (cards && file) {
    source = `# ${file}\n\n`
    let block: string | null | undefined
    for (const c of cards) {
      if (c.block !== block) { block = c.block; source += `### ${block ?? 'Unfiled'}\n\n` }
      source += cardMarkdown(c.title, c.meta, { condensed }) + '\n'
    }
  } else if (cards && frontlines) {
    const [first, ...answers] = cards
    source = `# Frontlines\n\n${cardMarkdown(first.title, first.meta, { condensed })}\n`
    source += answers.length ? `### Answers (${answers.length})\n\n` : '### No answers yet\n\n'
    for (const c of answers) source += cardMarkdown(c.title, c.meta, { condensed }) + '\n'
  } else if (cards) {
    source = cards.map((c) => cardMarkdown(c.title, c.meta, { condensed })).join('\n')
  }

  return (
    <div className="stack">
      <div className="row no-print">
        <button className={`link ${!raw ? 'on' : ''}`} aria-pressed={!raw} onClick={() => setRaw(false)}>preview</button>
        <button className={`link ${raw ? 'on' : ''}`} aria-pressed={raw} onClick={() => setRaw(true)}>markdown</button>
        <button className={`link ${condensed ? 'on' : ''}`} aria-pressed={condensed} onClick={() => setCondensed(!condensed)}>read-aloud</button>
        <button className="link spacer" onClick={() => window.print()}>print</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!cards && !error && <p className="no-print">Reading the cards…</p>}
      {cards && (raw ? <pre className="md">{source}</pre> : <article className="print-sheet" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />)}
    </div>
  )
}
