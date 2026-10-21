import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import SignIn from './components/SignIn'
import { api, config, me, SIGNED_OUT, type User } from './lib/api'
import { turnOffPush } from './lib/push'
import { LabelsContext, useLabelsLoader } from './lib/hooks'
import { SessionContext, useSession } from './lib/session'
import { isMobile } from './lib/scan'
import { TopicProvider } from './lib/topic'
import { ALPHA, arrivedCode, checkCode, teamAddress, thisTeam } from './lib/door'
import { mountUndertaker } from './lib/undertaker'
import AccountPage from './pages/AccountPage'
import CardPage from './pages/CardPage'
import DataPage from './pages/DataPage'
import HomePage from './pages/HomePage'
import LabelsPage from './pages/LabelsPage'
import LibraryPage from './pages/LibraryPage'
import PrintPage from './pages/PrintPage'
import SearchPage from './pages/SearchPage'

// A code another team's door sent here (?invite=), read once and taken out of the address bar.
const ARRIVED = arrivedCode()

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(config.token() ? undefined : null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!config.token()) return
    me().then(setUser).catch((e) => { setError(e.message); setUser(null) })
  }, [])
  useEffect(() => {
    const out = () => setUser(null)
    window.addEventListener(SIGNED_OUT, out)
    return () => window.removeEventListener(SIGNED_OUT, out)
  }, [])

  if (user === undefined) return null
  return (
    <SessionContext.Provider value={{ user, setUser }}>
      {user ? (user.approved === false ? <Waiting /> : <Shell error={error} />) : <SignedOut error={error} />}
    </SessionContext.Provider>
  )
}

/** A team's Scythe is members only: signed out, there is nothing to see but signing in, under the landing's banner,
 *  where the undertaker peeks in, drops onto the wordmark and strolls about (lib/undertaker.js, the landing's own file). */
function SignedOut({ error }: { error: string | null }) {
  const banner = useRef<HTMLElement>(null), wordmark = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null)
  useEffect(() => mountUndertaker({ svg: svg.current, banner: banner.current, wordmark: wordmark.current }), [])
  const [team, setTeam] = useState<string | null>(null)
  const [invite, setInvite] = useState(ARRIVED)
  useEffect(() => { thisTeam().then(setTeam) }, [])
  return (
    <>
      <header className="banner no-print" ref={banner}>
        <div className="page">
          <nav className="top">
            <Link to="/" className="brand">scythe</Link>
            <button className="link" onClick={() => document.querySelector<HTMLElement>('.sign-in input, .sign-in button')?.focus()}>sign in</button>
          </nav>
          <div className="wordmark" ref={wordmark}>scythe</div>
        </div>
        {/* Decorative, so hidden from screen readers. */}
        <svg className="undertaker" ref={svg} aria-hidden="true" focusable="false" />
      </header>
      <div className="page">
        {error && <p className="error">{error}</p>}
        <Door team={team} onCode={setInvite} />
        <SignIn invite={invite} key={invite} />
      </div>
    </>
  )
}

/** The front door, on every team's Scythe: alpha for everyone, and below it an optional code for a school's team.
 *  A code names its team (lib/door.ts): on this team's Scythe it goes into the sign-up; on another's, there. */
function Door({ team, onCode }: { team: string | null; onCode: (code: string) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toSignIn = () => document.querySelector<HTMLElement>('.sign-in input, .sign-in button')?.focus()
  const alpha = () => (team === ALPHA || !team ? toSignIn() : location.assign(teamAddress(ALPHA)))
  const join = async () => {
    setBusy(true); setError(null)
    const r = await checkCode(code, team ?? '')
    setBusy(false)
    if ('error' in r) { setError(r.error); return }
    if (r.team === team || r.address === config.apiBase()) { onCode(code.trim()); setTimeout(toSignIn) }
    else location.assign(`${r.address}/?${new URLSearchParams({ invite: code.trim() })}`)
  }
  return (
    <section className="gap door" style={{ marginBottom: '3rem' }}>
      {team && <p>This is <strong>{team}</strong>’s Scythe.</p>}
      <div className="row">
        <button className={`link ${team === ALPHA ? 'on' : ''}`} onClick={alpha}>alpha</button>
        <span>open to anyone with an invite</span>
      </div>
      <div className="row">
        <input className="field" style={{ flex: 1, minWidth: '12rem' }} placeholder="Your team’s code (optional)" maxLength={120}
          autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && code.trim() && join()} />
        <button className="link" disabled={busy || !code.trim()} onClick={join}>{busy ? 'checking…' : 'join team'}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

/** Signed in, but an admin of the team hasn't let them in yet: only this, and signing out. */
function Waiting() {
  const { user, setUser } = useSession()
  const [team, setTeam] = useState('')
  useEffect(() => { thisTeam().then(setTeam) }, [])
  const signOut = async () => {
    try { await api('POST', '/auth/logout') } catch { /* signed out either way */ }
    config.setToken(null)
    setUser(null)
  }
  return (
    <div className="page">
      <nav className="top no-print"><Link to="/" className="brand">scythe</Link><button className="link" onClick={signOut}>sign out</button></nav>
      <section className="gap note">
        <p>You’re signed in as <strong>{user!.handle}</strong>. An admin of {team || 'this team'} will let you in.</p>
        <p>You’ll see the team’s cards once they do. Ask your coach if it’s taking a while.</p>
        <button className="link" onClick={() => me().then(setUser).catch(() => {})}>check again</button>
      </section>
    </div>
  )
}

function Shell({ error }: { error: string | null }) {
  const labels = useLabelsLoader()
  const { user } = useSession()
  const [panel, setPanel] = useState<'me' | null>(null)
  return (
    <LabelsContext.Provider value={labels}>
      <TopicProvider>
        <div className="page">
          <nav className="top no-print">
            <Link to="/" className="brand">scythe</Link>
            {isMobile() && <NavLink to="/scan">scan</NavLink>}
            <NavLink to="/" end>cut</NavLink>
            <NavLink to="/search">search</NavLink>
            <NavLink to="/library">library</NavLink>
            {/* The case editor is served by the team's server (/cases/), not part of this app. */}
            <a href={`${config.apiBase()}/cases/`}>cases</a>
            <NavLink to="/team">team</NavLink>
            <NavLink to="/labels">labels</NavLink>
            {user && <NavLink to="/account" title="Your account">{user.handle}</NavLink>}
            {user && <button className="link" aria-expanded={panel === 'me'} onClick={() => setPanel(panel === 'me' ? null : 'me')}>sign out</button>}
          </nav>
          {error && <p className="error">{error}</p>}
          {panel === 'me' && user && <Me close={() => setPanel(null)} />}
          <main>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/scan" element={<HomePage scan />} />
              <Route path="/cards/:id" element={<CardPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/print/file/:file" element={<PrintPage />} />
              <Route path="/print/:id/frontlines" element={<PrintPage frontlines />} />
              <Route path="/print/:id" element={<PrintPage />} />
              <Route path="/team" element={<DataPage />} />
              <Route path="/data" element={<DataPage />} />
              <Route path="/labels" element={<LabelsPage />} />
              <Route path="/account" element={<AccountPage />} />
            </Routes>
          </main>
        </div>
      </TopicProvider>
    </LabelsContext.Provider>
  )
}

/** "sign out" in the bar: it asks first, since the next person on this browser shouldn't land in your account. */
function Me({ close }: { close: () => void }) {
  const { user, setUser } = useSession()
  const navigate = useNavigate()
  const signOut = async () => {
    // This browser stops taking this member's nudges: the next person on it shouldn't see them.
    try { await turnOffPush() } catch { /* notifications weren't on, or the server is unreachable */ }
    try { await api('POST', '/auth/logout') } catch { /* signed out either way */ }
    config.setToken(null)
    setUser(null)
    close()
  }
  return (
    <section className="gap note" style={{ marginBottom: '3rem' }}>
      <p>Signed in as <strong>{user!.handle}</strong>. <button className="link" onClick={() => { close(); navigate('/account') }}>your account</button></p>
      <p>Sign out of Scythe on this browser?</p>
      <div className="row">
        <button className="action" onClick={signOut}>Sign out</button>
        <button className="link" onClick={close}>stay signed in</button>
      </div>
    </section>
  )
}
