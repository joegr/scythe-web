import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import TopicPicker from '../components/TopicPicker'
import type { TopicRef } from './doc'
import type { Topic } from './store'

interface TopicCtx {
  current: Topic | null
  /** The current topic, or prompt for one (resolves once picked; rejects with PickerClosed if closed without one). */
  require: () => Promise<Topic>
  /** Prompt even if one is set. */
  choose: () => Promise<Topic>
}

/** The picker was closed without a topic. Its message is empty, so a page that shows errors shows nothing. */
class PickerClosed extends Error {
  constructor() { super(''); this.name = 'PickerClosed' }
}

const KEY = 'scythe.topic'
const Ctx = createContext<TopicCtx>({ current: null, require: () => Promise.reject(), choose: () => Promise.reject() })
export const useTopic = () => useContext(Ctx)

export function topicLabel(t: Pick<TopicRef, 'event' | 'season' | 'period'>): string {
  const event = ({ policy: 'Policy', ld: 'LD', pf: 'PF', bq: 'BQ', custom: 'Custom' } as Record<string, string>)[t.event] ?? t.event
  return [event, t.season, t.period].filter(Boolean).join(' · ')
}

function load(): Topic | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null }
}

export function TopicProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Topic | null>(load)
  const [open, setOpen] = useState(false)
  const waiters = useRef<{ resolve: (t: Topic) => void; reject: (e: Error) => void }[]>([])

  const choose = useCallback(() => new Promise<Topic>((resolve, reject) => { waiters.current.push({ resolve, reject }); setOpen(true) }), [])
  const require = useCallback(() => (current ? Promise.resolve(current) : choose()), [current, choose])

  const pick = (t: Topic) => {
    try { localStorage.setItem(KEY, JSON.stringify(t)) } catch { /* storage blocked */ }
    setCurrent(t)
    setOpen(false)
    waiters.current.splice(0).forEach((w) => w.resolve(t))
  }
  // Closed without choosing: whatever waited for a topic stops waiting (quietly: the message is empty), so a cut in
  // progress keeps its selection and tag and can be tried again.
  const closed = () => {
    setOpen(false)
    waiters.current.splice(0).forEach((w) => w.reject(new PickerClosed()))
  }

  return (
    <Ctx.Provider value={{ current, require, choose }}>
      {children}
      <TopicPicker open={open} onPick={pick} onClose={closed} />
    </Ctx.Provider>
  )
}
