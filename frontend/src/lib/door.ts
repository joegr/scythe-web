/**
 * The front door: alpha for everyone, and a code for a school's team. Every team runs its own Scythe at
 * https://scythe-team-<team>.fly.dev; a code names its team (lsn-7hqkz-2pzmw-…), so the app builds that team's
 * address from the code and asks its server whether the code works (/api/door/check). Nothing here lists the
 * teams: a school's Scythe is found only by someone holding one of its codes.
 */
import { config } from './api'

export const ALPHA = 'alpha'
export const NO_TEAM = 'That code doesn’t open a team. Check it with your coach.'

export const teamAddress = (team: string) => `https://scythe-team-${team}.fly.dev`

const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/

/** The team a code names: everything before its last four groups of five (team names may hold hyphens). */
export function teamOf(code: string): string | null {
  const parts = code.trim().toLowerCase().split(/[\s-]+/).filter(Boolean)
  if (parts.length < 5 || !parts.slice(-4).every((p) => /^[a-z0-9]{5}$/.test(p))) return null
  const team = parts.slice(0, -4).join('-')
  return SLUG.test(team) ? team : null
}

/** This server's team ('' on a development server, or an older one). */
export async function thisTeam(): Promise<string> {
  try {
    const r = await fetch(`${config.apiBase()}/api/door`)
    const d = r.ok ? await r.json() : {}
    return typeof d.team === 'string' && (d.team === '' || SLUG.test(d.team)) ? d.team : ''
  } catch {
    return ''
  }
}

/** Whether `code` opens a team, and where that team's Scythe is. Never uses the code up. */
export async function checkCode(code: string, here: string): Promise<{ team: string; address: string } | { error: string }> {
  const team = teamOf(code)
  if (!team) return { error: NO_TEAM }
  const address = team === here ? config.apiBase() : teamAddress(team)
  let r: Response
  try {
    // text/plain: a simple request, so another team's server answers without a preflight.
    r = await fetch(`${address}/api/door/check`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ code: code.trim() }) })
  } catch {
    // No answer: a team that doesn't exist looks the same as a dropped connection, so offline is the only tell.
    return { error: navigator.onLine ? NO_TEAM : 'You’re offline. Connect, then try the code again.' }
  }
  if (r.ok) return { team, address }
  const d = await r.json().catch(() => ({}))
  return { error: r.status === 429 && typeof d.detail === 'string' ? d.detail : NO_TEAM }
}

/** A code passed in the address (?invite=, from another team's door), taken out of the address bar once read. */
export function arrivedCode(): string {
  const params = new URLSearchParams(location.search), code = params.get('invite') ?? ''
  if (code) {
    params.delete('invite')
    const rest = params.toString()
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)
  }
  return code.slice(0, 120)
}
