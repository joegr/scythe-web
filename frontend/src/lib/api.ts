/**
 * The Scythe API. A team's server is members only: reading and saving both need a Scythe
 * account, made with an invite code from one of the team's admins and signed in with a passkey, an
 * email and password, or Sign in with Apple (once the account has a passkey). The bearer token lives
 * only in this browser.
 *
 * Where the API is comes from the build (VITE_API_URL; localhost:8000 under `npm run dev`) and can't
 * be changed in the browser. A production build without VITE_API_URL talks to the server it was
 * served from: each team's server serves this app on its own origin.
 */

const TOKEN_KEY = 'scythe.token'

function get(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function put(key: string, value: string | null) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key) } catch { /* storage blocked */ }
}

export const config = {
  apiBase: () => (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : location.origin)).replace(/\/$/, ''),
  appleClientId: () => import.meta.env.VITE_APPLE_CLIENT_ID || '',
  token: () => get(TOKEN_KEY),
  setToken: (t: string | null) => put(TOKEN_KEY, t?.trim() || null),
}

/** Fired when the server stops accepting this browser's token (expired, revoked, or the member was removed). */
export const SIGNED_OUT = 'scythe:signed-out'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export interface Theirs { content: string; sha: string; commit: { sha: string | null; message: string | null; author: string | null; date: string | null } }
export class Diverged extends Error {
  theirs: Theirs
  constructor(theirs: Theirs) { super('Your partner saved this card first.'); this.theirs = theirs }
}

/** Endpoints the server said to leave alone for a while (429 + Retry-After): until when, by "METHOD /path". */
const held = new Map<string, number>()

function wait(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return s < 10 ? 'a few seconds' : s < 60 ? `${s} seconds` : s < 120 ? 'a minute' : `${Math.ceil(s / 60)} minutes`
}

/** What the server said, in words: its `detail`, or each field it refused (a list from request validation). */
function said(d: unknown): string | null {
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    const msgs = d.map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg).replace(/^Value error, /, '') : null))
      .filter(Boolean)
    if (msgs.length) return msgs.join('; ')
  }
  return null
}

/** `signal` cancels a request nobody needs any more (a search the next keystroke replaced): it rejects with an
 *  AbortError, which callers drop. */
export async function api<T>(method: string, path: string, body?: unknown,
  { auth = true, signal }: { auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const key = `${method} ${path.split('?')[0]}`
  const until = held.get(key)
  if (until !== undefined) {
    if (until > Date.now()) throw new ApiError(429, `Too many requests. Wait ${wait(until - Date.now())} and try again.`)
    held.delete(key)
  }
  const headers: Record<string, string> = {}
  const token = auth ? config.token() : null
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${config.apiBase()}/api${path}`, {
      method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new ApiError(0, 'Can’t reach Scythe. Check your connection and try again.')
  }
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}))
    if (data.diverged) throw new Diverged(data.theirs)
    throw new ApiError(409, data.detail ?? 'That changed while you were working. Reload and try again.')
  }
  if (!res.ok) {
    let message = res.statusText
    try { const d = await res.json(); message = said(d.detail) ?? message } catch { /* not json */ }
    if (res.status === 429) {
      const after = Number(res.headers.get('Retry-After'))
      held.set(key, Date.now() + (Number.isFinite(after) && after > 0 ? Math.min(after, 3600) : 30) * 1000)
    }
    if (res.status === 401 && token) {
      config.setToken(null)
      message = 'You were signed out. Sign in again to keep working.'
      window.dispatchEvent(new Event(SIGNED_OUT))
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

/** Download an export (spaCy files) with the signed-in token. */
export async function download(path: string, name: string) {
  const token = config.token()
  const res = await fetch(`${config.apiBase()}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`)
  const url = URL.createObjectURL(await res.blob())
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------- the account

export interface Methods { password: boolean; passkeys: number; apple_linked: boolean; apple_available: boolean }
export type Role = 'member' | 'admin'
/** `approved`: let in by an admin of the team; false while waiting (absent from an older server: let in). */
export interface User { id: number; handle: string; role: Role; email: string | null; methods: Methods; nudges: boolean; approved?: boolean }
export const me = () => api<User>('GET', '/auth/me')

// ---------------------------------------------------------------- git files

/** A record file at the branch tip, with its blob sha: the version a save must build on. */
export async function readFile(path: string): Promise<{ text: string; sha: string } | null> {
  try {
    const f = await api<{ content: string; sha: string }>('GET', `/git/file?${new URLSearchParams({ path })}`)
    return { text: f.content, sha: f.sha }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export interface Commit { sha: string; message: string; author: string; date: string }
export const history = (path: string) => api<Commit[]>('GET', `/git/log?${new URLSearchParams({ path })}`)
