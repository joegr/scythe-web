import { createContext, useContext } from 'react'
import type { User } from './api'

export const SessionContext = createContext<{ user: User | null; setUser: (u: User | null) => void }>({ user: null, setUser: () => {} })
/** Signed in = a Scythe account. Signed out, the app shows only signing in. */
export const useSignedIn = () => useContext(SessionContext).user !== null
export const useUser = () => useContext(SessionContext).user
export const useSession = () => useContext(SessionContext)
