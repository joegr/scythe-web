/**
 * Sign in with Apple (Apple's JS SDK, as a popup). Only offered to accounts that hold a passkey: the
 * server refuses an Apple sign-in for an account without one. The server issues a single-use nonce;
 * Apple signs its SHA-256 into the identity token, so a token can't be replayed.
 */
import { api, config, type User } from './api'

interface AppleSDK { auth: { init: (o: Record<string, unknown>) => void; signIn: () => Promise<{ authorization: { id_token: string } }> } }
declare global { interface Window { AppleID?: AppleSDK } }

const SDK = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

export const appleConfigured = () => !!config.appleClientId()

function loadSdk(): Promise<AppleSDK> {
  if (window.AppleID) return Promise.resolve(window.AppleID)
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: SDK, async: true })
    s.onload = () => (window.AppleID ? resolve(window.AppleID) : reject(new Error('Apple sign-in didn’t load.')))
    s.onerror = () => reject(new Error('Apple sign-in didn’t load.'))
    document.head.append(s)
  })
}

async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function appleToken(): Promise<{ ceremony: string; id_token: string }> {
  const [sdk, { ceremony, nonce }] = await Promise.all([loadSdk(), api<{ ceremony: string; nonce: string }>('POST', '/auth/apple/nonce')])
  sdk.auth.init({ clientId: config.appleClientId(), scope: '', redirectURI: location.origin + location.pathname, nonce: await sha256Hex(nonce), usePopup: true })
  try {
    return { ceremony, id_token: (await sdk.auth.signIn()).authorization.id_token }
  } catch {
    throw new Error('Signing in with Apple was cancelled.')
  }
}

export const signInWithApple = async () => api<{ token: string; user: User }>('POST', '/auth/apple', await appleToken())
export const linkApple = async () => api<User>('POST', '/auth/apple/link', await appleToken())
