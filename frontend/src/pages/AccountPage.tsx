import { useCallback, useEffect, useState } from 'react'
import { api, config, type Role, type User } from '../lib/api'
import { appleConfigured, linkApple } from '../lib/apple'
import { createPasskey, passkeysSupported } from '../lib/passkey'
import { pushSubscription, pushSupported, testPush, turnOffPush, turnOnPush } from '../lib/push'
import { useSession } from '../lib/session'
import ReadHere from '../components/ReadHere'

interface Passkey { id: number; name: string; synced: boolean; created_at: string; last_used_at: string | null }
interface Invite {
  id: number; role: Role; created_by: string | null; created_at: string; expires_at: string; uses_left: number
  revoked: boolean; status: 'open' | 'used' | 'expired' | 'revoked'
}
interface Member { id: number; handle: string; role: Role; created: string; approved?: boolean }

/** How you sign in: passkeys, email and password, and Sign in with Apple (once you have a passkey). */
export default function AccountPage() {
  const { user, setUser } = useSession()
  const [keys, setKeys] = useState<Passkey[]>([])
  const [pw, setPw] = useState({ email: '', password: '', current: '' })
  const [nudgeEmail, setNudgeEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const reload = useCallback(() => {
    if (!user) return
    api<Passkey[]>('GET', '/auth/passkeys').then(setKeys).catch(() => setKeys([]))
  }, [user])
  useEffect(reload, [reload])

  if (!user) return <p>Sign in to see your account.</p>
  const m = user.methods
  const act = async (fn: () => Promise<User | { user: User }>, ok: string) => {
    setMessage(null)
    try { const r = await fn(); setUser('user' in r ? r.user : r); reload(); setMessage(ok) } catch (e) { setMessage((e as Error).message) }
  }

  return (
    <div className="stack">
      <section className="gap">
        <h1>{user.handle}</h1>
        {user.email && <p>{user.email}</p>}
        {message && <p className="note">{message}</p>}
      </section>

      <section className="gap">
        <h2>Passkeys</h2>
        <p>Sign in with Face ID, Touch ID or your device passcode. On Apple devices your passkey syncs through iCloud Keychain, end-to-end encrypted; Scythe only keeps the public half.</p>
        <ul className="list">
          {keys.map((k) => (
            <li key={k.id} className="row">
              <span>{k.name}{k.synced ? ', synced' : ''}</span>
              <span>added {new Date(k.created_at).toLocaleDateString()}</span>
              <button className="link spacer" onClick={() => act(() => api('DELETE', `/auth/passkeys/${k.id}`), 'Passkey removed.')}>remove</button>
            </li>
          ))}
          {keys.length === 0 && <li>No passkeys yet.</li>}
        </ul>
        {passkeysSupported() && <button className="link" onClick={() => act(() => createPasskey(), 'Passkey added.')}>Add a passkey</button>}
      </section>

      <section className="gap">
        <h2>Sign in with Apple</h2>
        {m.apple_linked ? (
          <p>Your Apple account signs you in. <button className="link" onClick={() => act(() => api('DELETE', '/auth/apple'), 'Apple sign-in removed.')}>remove</button></p>
        ) : !m.apple_available ? (
          <p>Sign in with Apple becomes available once you add a passkey.</p>
        ) : appleConfigured() ? (
          <button className="link" onClick={() => act(linkApple, 'You can now sign in with Apple.')}>Add Sign in with Apple</button>
        ) : (
          <p>This Scythe isn’t set up for Sign in with Apple.</p>
        )}
      </section>

      <section className="gap">
        <h2>Email and password</h2>
        {m.password && <input className="field" type="password" placeholder="Current password" maxLength={512} autoComplete="current-password"
          value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}
        {!user.email && <input className="field" type="email" placeholder="Email" maxLength={254} value={pw.email} onChange={(e) => setPw({ ...pw, email: e.target.value })} />}
        <input className="field" type="password" placeholder="New password, at least 10 characters" maxLength={512} autoComplete="new-password"
          value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
        <div className="row">
          <button className="link" disabled={!pw.password}
            onClick={() => act(() => api('POST', '/auth/password', { password: pw.password, current: pw.current || null, email: pw.email || null }), 'Password saved.')}>
            {m.password ? 'Change password' : 'Add a password'}</button>
          {m.password && m.passkeys > 0 && (
            <button className="link spacer" onClick={() => act(() => api('DELETE', '/auth/password'), 'Password removed; sign in with your passkey.')}>remove password</button>
          )}
        </div>
      </section>

      <section className="gap">
        <h2>Nudges</h2>
        <p>An email when you haven’t stored a card in 3 days{user.role === 'admin' ? ', and, as a coach, when nobody on your team has' : ''}. Turning this on shares your handle, role and email with your team’s mailing list, which sends them; turning it off takes you off it at the next daily sync. Every email has an unsubscribe link.</p>
        {user.nudges ? (
          <p>Nudges are on. <button className="link" onClick={() => act(() => api('PATCH', '/auth/me', { nudges: false }), 'Nudges are off.')}>turn off</button></p>
        ) : (
          <div className="row">
            {!user.email && <input className="field" type="email" placeholder="Email for nudges" maxLength={254} value={nudgeEmail} onChange={(e) => setNudgeEmail(e.target.value)} />}
            <button className="link" disabled={!user.email && !nudgeEmail}
              onClick={() => act(() => api('PATCH', '/auth/me', { nudges: true, email: user.email ? null : nudgeEmail }), 'Nudges are on.')}>Turn on nudges</button>
          </div>
        )}
      </section>

      <section className="gap">
        <h2>Reading in your browser</h2>
        <ReadHere account />
      </section>

      <Notifications />

      {user.role === 'admin' && <Team me={user} />}

      <section className="gap">
        {deleting ? (
          <div className="row">
            <span>Delete your account? Changes you made stay in the history under {user.handle}.</span>
            <button className="action" onClick={async () => { await api('DELETE', '/auth/me'); config.setToken(null); setUser(null) }}>Delete</button>
            <button className="link" onClick={() => setDeleting(false)}>cancel</button>
          </div>
        ) : <button className="link" onClick={() => setDeleting(true)}>delete my account</button>}
      </section>
    </div>
  )
}

const day = (iso: string) => new Date(iso).toLocaleDateString()

/** Nudges as notifications in this browser (Web Push), with a test. */
function Notifications() {
  const [on, setOn] = useState<boolean | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { pushSubscription().then((s) => setOn(!!s)).catch(() => setOn(false)) }, [])
  const run = async (fn: () => Promise<string>) => {
    setMessage(null)
    try { setMessage(await fn()) } catch (e) { setMessage((e as Error).message) }
  }
  return (
    <section className="gap">
      <h2>Notifications in this browser</h2>
      {!pushSupported() ? (
        <p>This browser can’t take notifications. On an iPhone, add Scythe to your Home Screen (Share, then Add to Home Screen) and open it from there.</p>
      ) : (
        <>
          <p>A nudge here when you haven’t stored a card in 3 days{' '}(as a coach, when nobody on your team has). It goes from your team’s server through this browser’s push service, encrypted for this browser.</p>
          {on ? (
            <div className="row">
              <span>Notifications are on.</span>
              <button className="link spacer" onClick={() => run(async () => {
                const r = await testPush()
                return r.sent ? 'Sent: look for it in your notifications.' : 'Nothing was delivered. Turn notifications off and on again.'
              })}>send me a test</button>
              <button className="link spacer" onClick={() => run(async () => { await turnOffPush(); setOn(false); return 'Notifications are off in this browser.' })}>turn off</button>
            </div>
          ) : on === false && (
            <button className="link" onClick={() => run(async () => { await turnOnPush(); setOn(true); return 'Notifications are on in this browser.' })}>Turn on notifications</button>
          )}
          {message && <p className="note">{message}</p>}
        </>
      )}
    </section>
  )
}

/** For the team's admins: invite people (each code is shown once), and manage who is a member. */
function Team({ me }: { me: User }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [made, setMade] = useState<{ code: string; role: Role; school?: boolean } | null>(null)
  const [role, setRole] = useState<Role>('member')
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)

  const reload = useCallback(() => {
    api<Invite[]>('GET', '/auth/invites').then(setInvites).catch((e) => setMessage((e as Error).message))
    api<Member[]>('GET', '/auth/members').then(setMembers).catch((e) => setMessage((e as Error).message))
  }, [])
  useEffect(reload, [reload])

  const act = async (fn: () => Promise<unknown>, ok: string | null = null) => {
    setMessage(null)
    try { await fn(); reload(); setMessage(ok) } catch (e) { setMessage((e as Error).message) }
  }
  const invite = () => act(async () => {
    const r = await api<{ code: string; role: Role }>('POST', '/auth/invites', { role })
    setMade({ code: r.code, role: r.role }); setCopied(false)
  })
  // A school's standing code: hundreds of sign-ups for a year. Everyone it lets in waits for an admin here.
  const schoolCode = () => act(async () => {
    const r = await api<{ code: string; role: Role }>('POST', '/auth/invites', { role: 'member', uses: 500, days: 365 })
    setMade({ code: r.code, role: r.role, school: true }); setCopied(false)
  })
  const waiting = members.filter((m) => m.approved === false)
  const copy = async () => {
    if (!made) return
    try { await navigator.clipboard.writeText(made.code); setCopied(true) } catch { setMessage('Couldn’t copy. Select the code and copy it.') }
  }

  return (
    <>
      <section className="gap">
        <h2>Invites</h2>
        <p>Scythe is open only to this team. Someone joins with an invite code: it works once, for 14 days.</p>
        {message && <p className="note">{message}</p>}
        {made && (
          <div className="note">
            <p>{made.school
              ? 'Your school’s code. Anyone with it can ask to join, for a year, and waits for an admin to let them in. It’s shown only now:'
              : `New ${made.role} invite. Give this code to the person joining. It’s shown only now:`}</p>
            <p className="row"><code className="invite-code">{made.code}</code>
              <button className="link" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
              <button className="link spacer" onClick={() => setMade(null)}>done</button></p>
          </div>
        )}
        <div className="row">
          <button className="action" onClick={invite}>Make an invite</button>
          <button className="link" onClick={schoolCode}>Make a school code</button>
          <label><input type="checkbox" checked={role === 'admin'} onChange={(e) => setRole(e.target.checked ? 'admin' : 'member')} /> as an admin</label>
        </div>
        <ul className="list invites">
          {invites.map((i) => (
            <li key={i.id} className="row">
              <span>{i.role} invite, {i.status}{i.status === 'open' ? `, expires ${day(i.expires_at)}` : ''}</span>
              <span>made {day(i.created_at)}{i.created_by ? ` by ${i.created_by}` : ''}</span>
              {i.status === 'open' && <button className="link spacer" onClick={() => act(() => api('DELETE', `/auth/invites/${i.id}`), 'Invite revoked.')}>revoke</button>}
            </li>
          ))}
          {invites.length === 0 && <li>No invites yet.</li>}
        </ul>
      </section>

      {waiting.length > 0 && (
        <section className="gap">
          <h2>Waiting to be let in</h2>
          <p>They signed up with one of this team’s codes. Until you let them in, they see none of the team’s work.</p>
          <ul className="list waiting">
            {waiting.map((m) => (
              <li key={m.id} className="row">
                <span>{m.handle}</span>
                <span>asked {day(m.created)}</span>
                <span className="spacer">
                  <button className="action" onClick={() => act(() => api('POST', `/auth/members/${m.id}/approve`), `${m.handle} is in.`)}>let in</button>{' '}
                  <button className="link" onClick={() => act(() => api('DELETE', `/auth/members/${m.id}`), `${m.handle} was turned away.`)}>turn away</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="gap">
        <h2>Members</h2>
        <ul className="list members">
          {members.filter((m) => m.approved !== false).map((m) => (
            <li key={m.id} className="row">
              <span>{m.handle}{m.role === 'admin' ? ', admin' : ''}{m.id === me.id ? ' (you)' : ''}</span>
              <span>joined {day(m.created)}</span>
              {m.id !== me.id && (removing === m.id ? (
                <span className="spacer">Remove {m.handle}? They are signed out everywhere at once.{' '}
                  <button className="action" onClick={() => { setRemoving(null); act(() => api('DELETE', `/auth/members/${m.id}`), `${m.handle} was removed.`) }}>Remove</button>{' '}
                  <button className="link" onClick={() => setRemoving(null)}>cancel</button></span>
              ) : (
                <span className="spacer">
                  <button className="link" onClick={() => act(() => api('PATCH', `/auth/members/${m.id}`, { role: m.role === 'admin' ? 'member' : 'admin' }))}>
                    {m.role === 'admin' ? 'make a member' : 'make admin'}</button>{' '}
                  <button className="link" onClick={() => setRemoving(m.id)}>remove</button>
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
