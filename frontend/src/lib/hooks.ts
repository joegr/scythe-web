import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { DEFAULT_LABELS, type LabelDef } from './doc'
import { getCard, readSettings, type CardDoc } from './store'

export interface LabelsCtx { labels: LabelDef[]; reload: () => void }
export const LabelsContext = createContext<LabelsCtx>({ labels: DEFAULT_LABELS, reload: () => {} })
export const useLabels = () => useContext(LabelsContext)

export function useLabelsLoader(): LabelsCtx {
  const [labels, setLabels] = useState<LabelDef[]>(DEFAULT_LABELS)
  const reload = useCallback(() => { readSettings().then((r) => setLabels(r.settings.labels)).catch(() => {}) }, [])
  useEffect(reload, [reload])
  return { labels, reload }
}

/** Load a card from git; until the server has checked this exact file version with spaCy, re-check:
 *  2s, backing off to once a minute, for up to 15 minutes. */
export function useCard(n: number) {
  const [card, setCard] = useState<CardDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The card this page is showing now. A read of another card (the one just left, a re-check still on its way)
  // that comes back late is dropped, so the page never swaps back to the card it came from.
  const current = useRef(n)
  current.current = n
  const reload = useCallback(() => getCard(n)
    .then((c) => { if (current.current === n && c.number === n) setCard(c) })
    .catch((e) => { if (current.current === n) setError(e.message) }), [n])
  useEffect(() => { setCard(null); setError(null); reload() }, [reload])
  const waiting = card !== null && !card.processed && card.state === 'open'
  // While Scythe checks the card's words, ask again, backing off to once a minute, for as long as it takes: the page
  // never gets stuck on "Checking words…". Coming back to the tab asks at once.
  useEffect(() => {
    if (!waiting) return
    let delay = 2_000
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      reload()
      delay = Math.min(delay * 1.5, 60_000)
      t = setTimeout(tick, delay)
    }
    t = setTimeout(tick, delay)
    const back = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', back)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', back) }
  }, [waiting, reload])
  return { card, setCard, reload, error }
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
