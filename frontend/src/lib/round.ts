/**
 * The round timer (features/25). The clock is local: a round lives in this browser's storage, as start times and
 * elapsed time, never a ticking count, so a reload, a trip to the case editor or a sleeping laptop loses nothing.
 * While a round is on, what the debater opens is written down with when and during which speech. When it ends, it
 * goes to the team's record once, as rounds/<n>.md (api/format.md).
 *
 * Signed in, a round is also live (lib/live.ts): the debater who starts it drives, and teammates follow the same
 * clock on their own devices. What any of them opens goes into the round's one log, with who did it.
 */
import { useSyncExternalStore } from 'react'
import { api, config } from './api'
import {
  addLog, closeLive, listLive, LiveError, measureOffset, nextChange, publish, takeOver, ticketFor,
  type LiveRound, type LiveSummary, type Ticket,
} from './live'

export interface Block { name: string; short: string; seconds: number }
export interface Format { name: string; blocks: Block[]; prep: { sides: [string, string]; seconds: number } }

const b = (short: string, name: string, minutes: number): Block => ({ name, short, seconds: Math.round(minutes * 60) })

/** The NSDA's times. PF's speeches are named first and second: a coin flip decides which side speaks first. */
export const FORMATS: Format[] = [
  { name: 'LD', prep: { sides: ['Affirmative', 'Negative'], seconds: 240 }, blocks: [
    b('1AC', 'Affirmative Constructive', 6), b('CX', 'Cross-Examination of the Affirmative', 3),
    b('1NC', 'Negative Constructive', 7), b('CX', 'Cross-Examination of the Negative', 3),
    b('1AR', 'First Affirmative Rebuttal', 4), b('NR', 'Negative Rebuttal', 6), b('2AR', 'Second Affirmative Rebuttal', 3)] },
  { name: 'PF', prep: { sides: ['Pro', 'Con'], seconds: 180 }, blocks: [
    b('C1', 'First Constructive', 4), b('C2', 'Second Constructive', 4), b('CF', 'First Crossfire', 3),
    b('R1', 'First Rebuttal', 4), b('R2', 'Second Rebuttal', 4), b('CF', 'Second Crossfire', 3),
    b('S1', 'First Summary', 3), b('S2', 'Second Summary', 3), b('GCF', 'Grand Crossfire', 3),
    b('FF1', 'First Final Focus', 2), b('FF2', 'Second Final Focus', 2)] },
  { name: 'Policy', prep: { sides: ['Affirmative', 'Negative'], seconds: 480 }, blocks: [
    b('1AC', 'First Affirmative Constructive', 8), b('CX', 'Cross-Examination of the 1AC', 3),
    b('1NC', 'First Negative Constructive', 8), b('CX', 'Cross-Examination of the 1NC', 3),
    b('2AC', 'Second Affirmative Constructive', 8), b('CX', 'Cross-Examination of the 2AC', 3),
    b('2NC', 'Second Negative Constructive', 8), b('CX', 'Cross-Examination of the 2NC', 3),
    b('1NR', 'First Negative Rebuttal', 5), b('1AR', 'First Affirmative Rebuttal', 5),
    b('2NR', 'Second Negative Rebuttal', 5), b('2AR', 'Second Affirmative Rebuttal', 5)] },
]

export type Did = 'began' | 'opened card' | 'found card' | 'scanned card' | 'opened case'
export interface Entry { at: string; during: string; did: Did; card?: number; case?: number; query?: string; by?: string }

/** What's running: the speech the round is on, or one side's prep. `since` is when it started, in this device's ms. */
export type Running = { what: 'speech' | 0 | 1; since: number } | null

/** A round shared through the shared service: who drives it, and how this device's clock lines up with the service's. */
export interface Live {
  ticket: Ticket
  /** The service's clock minus this device's, in ms. */
  offset: number
  version: number
  /** Whether this device drives the clock (the time of record). */
  driving: boolean
  driver: string
  startedBy: string
  /** Set when the service can't be reached; the clock keeps running here. */
  trouble?: string | null
  /** The driver closed the round (saved it, or let it go): a follower's copy is only to look at now. */
  closed?: boolean
}

export interface Round {
  id: string
  format: Format
  started: string
  current: number
  /** Milliseconds each speech has run, not counting a run in progress. */
  used: number[]
  prepUsed: [number, number]
  running: Running
  log: Entry[]
  notes: string
  /** Set once the round is over: it's then saved, or let go. */
  ended: string | null
  live?: Live | null
}

// ---------------------------------------------------------------- storage: this browser only, shared by its tabs

const ROUND = 'scythe:round'
const CUSTOM = 'scythe:formats'

function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}
function keep(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked: the round lives as long as the page */ }
}

let round: Round | null = valid(load<Round | null>(ROUND, null))
const listeners = new Set<() => void>()

function valid(r: Round | null): Round | null {
  if (!(r && Array.isArray(r.format?.blocks) && r.format.blocks.length && Array.isArray(r.used) && Array.isArray(r.log))) return null
  return r.id ? r : { ...r, id: newId() }
}
function set(next: Round | null) {
  round = next
  keep(ROUND, next)
  listeners.forEach((f) => f())
  sync()
}
// Another tab (or the case editor's page) changed the round: read it again.
window.addEventListener('storage', (e) => {
  if (e.key !== ROUND) return
  round = valid(load<Round | null>(ROUND, null))
  listeners.forEach((f) => f())
})

/** The round in progress (or just ended), kept current. */
export function useRound(): Round | null {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => round)
}

const newId = () => `round-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`

// ---------------------------------------------------------------- the clock's arithmetic

/** Milliseconds `what` has run, counting a run in progress up to `now`. */
export function ran(r: Round, what: 'speech' | 0 | 1, now = Date.now()): number {
  const before = what === 'speech' ? r.used[r.current] ?? 0 : r.prepUsed[what]
  return before + (r.running && r.running.what === what ? Math.max(0, now - r.running.since) : 0)
}

/** Milliseconds left of the current speech (negative once it's over). */
export const speechLeft = (r: Round, now = Date.now()) => r.format.blocks[r.current].seconds * 1000 - ran(r, 'speech', now)
/** Milliseconds of prep a side has left (negative once it's used more than it had). */
export const prepLeft = (r: Round, side: 0 | 1, now = Date.now()) => r.format.prep.seconds * 1000 - ran(r, side, now)

/** "6:00", "0:05", or "0:05 over" once the time's gone. Rounded so a fresh speech reads its full length. */
export function clock(ms: number): string {
  const over = ms < 0
  const s = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000)
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return over && s > 0 ? `${text} over` : text
}

/** "4:00" from 240, and back: how a custom block's length is written. */
export function lengthOf(text: string): number | null {
  const m = /^\s*(\d{1,3})(?::([0-5]\d))?\s*$/.exec(text)
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null
}

/** What the clock is on, as the log says it: the speech's name, or a side's prep. */
export function during(r: Round): string {
  return r.running && r.running.what !== 'speech' ? `${r.format.prep.sides[r.running.what]} prep` : r.format.blocks[r.current].name
}

/** Whether this device may change the clock: a local round, or a live one it drives. */
export const drives = (r: Round) => !r.live || r.live.driving

// ---------------------------------------------------------------- running a round

const now = () => Date.now()
const iso = (ms = now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Stop whatever runs, banking its time. */
function settle(r: Round, at = now()): Round {
  if (!r.running) return r
  const ms = Math.max(0, at - r.running.since)
  if (r.running.what === 'speech') {
    const used = [...r.used]; used[r.current] = (used[r.current] ?? 0) + ms
    return { ...r, used, running: null }
  }
  const prepUsed: [number, number] = [...r.prepUsed]; prepUsed[r.running.what] += ms
  return { ...r, prepUsed, running: null }
}

/** A change to the clock, by the device that drives it: kept here, then published to teammates. */
function change(next: Round) {
  set(next)
  if (next.live?.driving) dirty = true
  sync()
}

export function start(format: Format) {
  set({ id: newId(), format, started: iso(), current: 0, used: format.blocks.map(() => 0), prepUsed: [0, 0], running: null,
    log: [], notes: '', ended: null, live: null })
  if (config.token()) void goLive()
}

/** Start or stop the speech clock. Starting it stops any prep. */
export function toggleSpeech() {
  if (!round || round.ended || !drives(round)) return
  if (round.running?.what === 'speech') { change(settle(round)); return }
  const r = settle(round)
  const at = now()
  const began: Entry = { at: iso(at), during: r.format.blocks[r.current].name, did: 'began' }
  change({ ...r, running: { what: 'speech', since: at }, log: [...r.log, began] })
  share(began)
}

/** Start or stop one side's prep. Starting it stops the speech clock. */
export function togglePrep(side: 0 | 1) {
  if (!round || round.ended || !drives(round)) return
  if (round.running?.what === side) { change(settle(round)); return }
  const r = settle(round)
  const at = now()
  const began: Entry = { at: iso(at), during: `${r.format.prep.sides[side]} prep`, did: 'began' }
  change({ ...r, running: { what: side, since: at }, log: [...r.log, began] })
  share(began)
}

/** Go to another speech; the clock stops, ready for it. */
export function goTo(i: number) {
  if (!round || round.ended || !drives(round) || i < 0 || i >= round.format.blocks.length) return
  change({ ...settle(round), current: i })
}

export const setNotes = (notes: string) => { if (round) set({ ...round, notes }) }

/** The round is over: the clock stops, and what's left is notes and saving. */
export function end() {
  if (round && !round.ended && drives(round)) change({ ...settle(round), ended: iso() })
}

/** Let the round go, saved or not. The driver closes it for everyone; a follower just stops following. */
export function close() {
  const r = round
  set(null)
  if (r?.live?.driving) void closeLive(r.live.ticket).catch(() => { /* it expires on its own */ })
}

/** Note what the debater did, if a round is on. Opening the same thing twice in a row, moments apart, is once. */
export function note(did: Exclude<Did, 'began'>, what: { card?: number; case?: number; query?: string }) {
  if (!round || round.ended) return
  const last = round.log[round.log.length - 1]
  const at = now()
  if (last && last.did === did && last.card === what.card && last.case === what.case && at - Date.parse(last.at) < 10_000) return
  const entry: Entry = { at: iso(at), during: during(round), did, ...what, ...(round.live ? { by: round.live.ticket.member } : {}) }
  set({ ...round, log: [...round.log, entry] })
  share(entry)
}

/** The round as the server takes it (POST /api/rounds). */
export function body(r: Round, title: string) {
  const ms = (x: number) => Math.round(x / 1000)
  return {
    title: title.trim(), format: r.format.name, started: r.started, ended: r.ended ?? iso(), notes: r.notes,
    blocks: r.format.blocks.map((x, i) => ({ name: x.name, short: x.short, seconds: x.seconds, used: ms(r.used[i] ?? 0) })),
    prep: { sides: r.format.prep.sides, seconds: r.format.prep.seconds, used: r.prepUsed.map(ms) },
    log: r.log,
  }
}

export interface SavedRound { id: number; title: string; format: string; cases: number[] }

/** Save the ended round to the team's record. It stays here until it's saved, so a failed save loses nothing. */
export async function save(title: string): Promise<SavedRound> {
  if (!round?.ended) throw new Error('End the round before saving it.')
  if (!drives(round)) throw new Error(`${round.live!.driver} saves this round.`)
  return api<SavedRound>('POST', '/rounds', body(round, title))
}

// ---------------------------------------------------------------- live: driving, following, and the shared log

let dirty = false // the driver's clock changed and hasn't been published yet
let publishing = false
let following: { id: string; stop: AbortController } | null = null
let outbox: Entry[] = [] // log entries not yet added to the live round

/** The clock as teammates get it: start times in the service's clock. */
function shared(r: Round, offset: number) {
  return { format: r.format, started: r.started, current: r.current, used: r.used, prepUsed: r.prepUsed,
    running: r.running && { ...r.running, since: r.running.since + offset }, ended: r.ended }
}

/** A live round's clock and log, as this device keeps them. */
function adopt(r: Round, remote: LiveRound, live: Live): Round {
  const me = live.ticket.member
  const driving = remote.driver === me
  const next: Round = { ...r, log: (remote.log as unknown as Entry[]) ?? r.log,
    live: { ...live, version: remote.version, driving, driver: remote.driver, startedBy: remote.started_by, trouble: null } }
  if (driving && live.driving) return next // the driver's own clock is the record: only the log comes back
  const s = remote.state as unknown as Round & { running: Running }
  return { ...next, format: s.format, started: s.started, current: s.current, used: s.used, prepUsed: s.prepUsed,
    ended: s.ended ?? null, running: s.running && { ...s.running, since: s.running.since - live.offset } }
}

const trouble = (message: string) => { if (round?.live) set({ ...round, live: { ...round.live, trouble: message } }) }

/** Make the round in progress live: a ticket, this device's offset from the service, and the first publish. */
async function goLive() {
  const r = round
  if (!r) return
  try {
    const ticket = await ticketFor(r.id)
    const offset = await measureOffset(ticket.service)
    if (round?.id !== r.id) return // let go meanwhile
    const live: Live = { ticket, offset, version: 0, driving: true, driver: ticket.member, startedBy: ticket.member }
    round = { ...round, live, log: round.log.map((e) => ({ ...e, by: ticket.member })) }
    outbox = [...round.log] // what happened before the round went live goes into its shared log too
    dirty = true
    set(round)
  } catch {
    // No shared service, or it can't be reached: the round stays on this device, as the timer always could.
  }
}

/** Publish the driver's clock when it has changed, one publish at a time; and keep following the round. */
function sync() {
  const r = round
  if (!r?.live || r.live.closed) { following?.stop.abort(); following = null; return }
  if (dirty && r.live.driving && !publishing) {
    dirty = false
    publishing = true
    const live = r.live
    publish(live.ticket, null, shared(r, live.offset))
      .then((got) => { if (round?.live && round.id === r.id) set({ ...round, live: { ...round.live, version: Math.max(round.live.version, got.version), trouble: null } }) })
      .catch((e) => {
        if (e instanceof LiveError && e.status === 409) return // taken over: the next change says by whom
        dirty = true
        trouble((e as Error).message)
      })
      .finally(() => { publishing = false; if (dirty) setTimeout(sync, 2000) })
  }
  if (outbox.length && !publishing) flush(r.live)
  if (following?.id !== r.id) { following?.stop.abort(); following = { id: r.id, stop: new AbortController() }; void listen(r.id, following.stop.signal) }
}

function share(entry: Entry) {
  if (!round?.live) return
  outbox.push({ ...entry, by: round.live.ticket.member })
  flush(round.live)
}

let flushing = false
function flush(live: Live) {
  if (flushing || !outbox.length) return
  flushing = true
  const sending = outbox
  outbox = []
  addLog(live.ticket, sending)
    .then(() => { flushing = false; if (outbox.length && round?.live) flush(round.live) })
    .catch(() => {
      // Kept, and sent again shortly: what a debater opened never waits on some other change to the round.
      outbox = [...sending, ...outbox]
      flushing = false
      setTimeout(() => { if (round?.live && !round.live.closed) flush(round.live) }, 2000)
    })
}

/** Wait on the service for each change to the round, and take it in, until the round here changes or goes. */
async function listen(id: string, signal: AbortSignal) {
  let backoff = 1000
  while (!signal.aborted && round?.id === id && round.live && !round.live.closed) {
    const live = round.live
    try {
      const got = await nextChange(live.ticket, live.version, signal)
      backoff = 1000
      if (got && round?.id === id && round.live) set(adopt(round, got, round.live))
    } catch (e) {
      if (signal.aborted) return
      if (e instanceof LiveError && e.status === 404) {
        // The driver closed it (saved, or let it go): a follower's round ends here, theirs to save, not this device's.
        if (round?.id === id && round.live && !round.live.driving) {
          set({ ...settle(round), ended: round.ended ?? iso(), live: { ...round.live, closed: true, trouble: null } })
        }
        return
      }
      trouble((e as Error).message)
      await new Promise((ok) => setTimeout(ok, backoff))
      backoff = Math.min(backoff * 2, 15_000)
    }
  }
}

/** The team's rounds running now, to follow. */
export async function teamRounds(): Promise<{ ticket: Ticket; rounds: LiveSummary[] }> {
  const ticket = await ticketFor('*')
  return { ticket, rounds: await listLive(ticket) }
}

/** Follow a teammate's round: the same clock, theirs to drive. */
export async function follow(id: string) {
  const ticket = await ticketFor(id)
  const offset = await measureOffset(ticket.service)
  const remote = await nextChange(ticket, 0, new AbortController().signal)
  if (!remote) throw new Error('That round isn’t running any more.')
  const live: Live = { ticket, offset, version: 0, driving: false, driver: remote.driver, startedBy: remote.started_by }
  const s = remote.state as unknown as Round
  const base: Round = { id, format: s.format, started: s.started, current: 0, used: [], prepUsed: [0, 0], running: null,
    log: [], notes: '', ended: null, live }
  outbox = []
  set(adopt(base, remote, live))
}

/** Drive a teammate's round from this device: theirs ran out of battery, or they handed it over. */
export async function takeOverRound() {
  if (!round?.live || round.live.driving) return
  const got = await takeOver(round.live.ticket)
  if (round?.live) set({ ...round, live: { ...round.live, driving: got.driver === round.live.ticket.member, driver: got.driver, version: got.version } })
}

// ---------------------------------------------------------------- custom times, kept on this device

export const customFormats = (): Format[] => load<Format[]>(CUSTOM, []).filter((f) => f?.name && f.blocks?.length)

export function keepFormat(f: Format) {
  keep(CUSTOM, [f, ...customFormats().filter((x) => x.name !== f.name)].slice(0, 20))
}

export function forgetFormat(name: string) {
  keep(CUSTOM, customFormats().filter((x) => x.name !== name))
}

// ---------------------------------------------------------------- the team's cases, to open from the round

export interface CaseRef { number: number; title: string }

/** The team's cases (the case editor's own list). */
export async function teamCases(): Promise<CaseRef[]> {
  const res = await fetch(`${config.apiBase()}/cases/api/cases`, { headers: { Authorization: `Bearer ${config.token() ?? ''}` } })
  if (!res.ok) throw new Error('Couldn’t load the team’s cases.')
  const got = await res.json()
  return (Array.isArray(got) ? got : []).filter((c) => Number.isInteger(c?.number)).map((c) => ({ number: c.number, title: String(c.title ?? '') }))
}

/** Open a case from the round: it's noted, then opens in the case editor. */
export function openCase(n: number) {
  note('opened case', { case: n })
  window.open(`${config.apiBase()}/cases/${n}/`, '_blank', 'noopener')
}

// A live round in progress picks up where it was after a reload.
if (round?.live) queueMicrotask(sync)
