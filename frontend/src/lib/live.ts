/**
 * Live rounds (features/25): one round's clock shared by teammates, through the shared service (scythe-ocr's
 * rounds.py). The debater who starts it drives: their device is the time of record, and publishes the clock whenever
 * it changes. Everyone else follows, waiting on the service for the next change and counting down from the same
 * start times. The clock is kept in this device's time; it's turned into the service's time (and back) at the edge,
 * with `offset`, measured here the way network time does: a few quick calls, the fastest one trusted.
 */
import { api } from './api'

export interface Ticket { service: string; team: string; member: string; round: string; ticket: string }
export interface LiveSummary { id: string; version: number; driver: string; started_by: string; format: string | null; ended: string | null }
export interface LiveRound extends LiveSummary { state: Record<string, unknown>; log: Record<string, unknown>[]; changed: true }

export class LiveError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

/** A ticket from this team's server to a round on the shared service (or `*`: any of the team's rounds). */
export const ticketFor = (round: string) => api<Ticket>('POST', '/rounds/live', { round })

async function call<T>(t: Ticket, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${t.service}${path}`, {
      method, signal, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Authorization: `Bearer ${t.ticket}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new LiveError(0, 'Can’t reach the round. The clock keeps running here.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new LiveError(res.status, data.error ?? res.statusText)
  return data as T
}

/** How far the service's clock is ahead of this device's, in ms: a few calls, the quickest one's midpoint. */
export async function measureOffset(service: string, tries = 4): Promise<number> {
  let best: { rtt: number; offset: number } | null = null
  for (let i = 0; i < tries; i++) {
    const t0 = Date.now()
    const res = await fetch(`${service}/v1/time`, { cache: 'no-store' })
    const t1 = Date.now()
    const { now } = await res.json() as { now: number }
    const sample = { rtt: t1 - t0, offset: now - (t0 + t1) / 2 }
    if (!best || sample.rtt < best.rtt) best = sample
  }
  return Math.round(best!.offset)
}

export const listLive = (t: Ticket) => call<LiveSummary[]>(t, 'GET', '/v1/rounds')
export const publish = (t: Ticket, version: number | null, state: unknown) =>
  call<{ version: number; driver: string }>(t, 'PUT', `/v1/rounds/${t.round}`, { version, state })
export const addLog = (t: Ticket, entries: unknown[]) => call<{ version: number }>(t, 'POST', `/v1/rounds/${t.round}/log`, { entries })
export const takeOver = (t: Ticket) => call<{ version: number; driver: string }>(t, 'POST', `/v1/rounds/${t.round}/take`)
export const closeLive = (t: Ticket) => call<{ closed: boolean }>(t, 'DELETE', `/v1/rounds/${t.round}`)

/** The round once it's past `after` (the service waits up to 25 seconds for that), or null if nothing changed. */
export async function nextChange(t: Ticket, after: number, signal: AbortSignal): Promise<LiveRound | null> {
  const r = await call<LiveRound | { changed: false }>(t, 'GET', `/v1/rounds/${t.round}?after=${after}`, undefined, signal)
  return r.changed ? r as LiveRound : null
}
