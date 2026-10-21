import { useState } from 'react'
import { api, config, type User } from '../lib/api'
import { appleConfigured, signInWithApple } from '../lib/apple'
import { createPasskey, passkeysSupported, signInWithPasskey } from '../lib/passkey'
import { useSession } from '../lib/session'

/**
 * Sign in with a passkey (the usual way: Face ID, Touch ID or the device passcode), an email and
 * password, or Apple once the account has a passkey. A team's Scythe is members only: a new account
 * needs an invite code from one of the team's admins, and starts with a passkey or an email and password.
 */
export default function SignIn({ invite = '' }: { invite?: string }) {
  const { setUser } = useSession()
  // A code from the front door opens "new to Scythe" with it filled in.
  const [mode, setMode] = useState<'sign-in' | 'new'>(invite ? 'new' : 'sign-in')
  const [form, setForm] = useState({ handle: '', email: '', password: '', invite })
  const [withPassword, setWithPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const done = (r: { token?: string; user: User }) => {
    if (r.token) config.setToken(r.token)
    setUser(r.user)
  }
  const run = async (fn: () => Promise<{ token?: string; user: User }>) => {
    setBusy(true); setError(null)
    try { done(await fn()) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <section className="gap note sign-in" style={{ marginBottom: '3rem' }}>
      <p>Sign in to use Scythe. It’s open only to members of this team.</p>
      <div className="row">
        <button className={`link ${mode === 'sign-in' ? 'on' : ''}`} aria-pressed={mode === 'sign-in'} onClick={() => setMode('sign-in')}>sign in</button>
        <button className={`link ${mode === 'new' ? 'on' : ''}`} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>new to Scythe</button>
      </div>
      {error && <p className="error">{error}</p>}
      {mode === 'sign-in' ? (
        <>
          {passkeysSupported() && (
            <button className="action" disabled={busy} onClick={() => run(signInWithPasskey)}>Sign in with a passkey</button>
          )}
          {appleConfigured() && (
            <p><button className="link" disabled={busy} onClick={() => run(signInWithApple)}>Sign in with Apple</button> (once your account has a passkey)</p>
          )}
          <p>Or with your email and password:</p>
          <input className="field" type="email" placeholder="Email" maxLength={254} autoComplete="username" value={form.email} onChange={set('email')} />
          <input className="field" type="password" placeholder="Password" maxLength={512} autoComplete="current-password" value={form.password} onChange={set('password')}
            onKeyDown={(e) => e.key === 'Enter' && form.email && form.password && run(() => api('POST', '/auth/login', { email: form.email, password: form.password }))} />
          <button className="link" disabled={busy || !form.email || !form.password}
            onClick={() => run(() => api('POST', '/auth/login', { email: form.email, password: form.password }))}>Sign in</button>
        </>
      ) : (
        <>
          <p>To join, you need an invite code from your team’s admin.</p>
          <input className="field" placeholder="Invite code from your team's admin" maxLength={64} autoComplete="off" spellCheck={false}
            value={form.invite} onChange={set('invite')} />
          <p>Your name on Scythe is shown on every change you make. Use a nickname, not your full name.</p>
          <input className="field" placeholder="Your name on Scythe, e.g. ana-lincoln" maxLength={30} autoComplete="nickname" value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value.toLowerCase() })} />
          {!withPassword ? (
            <div className="row">
              <button className="action" disabled={busy || !form.handle.trim() || !passkeysSupported()}
                onClick={() => run(() => createPasskey(form.handle.trim(), form.invite.trim()))}>Create with a passkey</button>
              <button className="link" onClick={() => setWithPassword(true)}>use an email and password instead</button>
            </div>
          ) : (
            <>
              <input className="field" type="email" placeholder="Email" maxLength={254} autoComplete="email" value={form.email} onChange={set('email')} />
              <input className="field" type="password" placeholder="Password, at least 10 characters" maxLength={512} autoComplete="new-password" value={form.password} onChange={set('password')} />
              <div className="row">
                <button className="action" disabled={busy || !form.handle.trim() || !form.email || !form.password}
                  onClick={() => run(() => api('POST', '/auth/register', { handle: form.handle.trim(), email: form.email, password: form.password, invite: form.invite.trim() }))}>Create account</button>
                <button className="link" onClick={() => setWithPassword(false)}>use a passkey instead</button>
              </div>
            </>
          )}
          <p>A passkey signs you in with Face ID, Touch ID or your device passcode. It stays on your devices; Scythe never sees it.</p>
        </>
      )}
    </section>
  )
}
