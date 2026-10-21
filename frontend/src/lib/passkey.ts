/**
 * Passkeys in the browser. The server sends WebAuthn options as JSON (base64url for binary fields);
 * the browser's credential goes back the same way. The private key never leaves the device: on
 * Apple devices it is kept, and synced, in iCloud Keychain.
 */
import { api, type User } from './api'

const toBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
const toB64u = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential

function creationOptions(o: Json): PublicKeyCredentialCreationOptions {
  return {
    ...o, challenge: toBytes(o.challenge), user: { ...o.user, id: toBytes(o.user.id) },
    excludeCredentials: (o.excludeCredentials ?? []).map((c: Json) => ({ ...c, id: toBytes(c.id) })),
  } as unknown as PublicKeyCredentialCreationOptions
}

function requestOptions(o: Json): PublicKeyCredentialRequestOptions {
  return { ...o, challenge: toBytes(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c: Json) => ({ ...c, id: toBytes(c.id) })) } as unknown as PublicKeyCredentialRequestOptions
}

function credentialJson(c: PublicKeyCredential): Json {
  const r = c.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse
  const response: Json = { clientDataJSON: toB64u(r.clientDataJSON) }
  if ('attestationObject' in r && r.attestationObject) {
    response.attestationObject = toB64u(r.attestationObject)
    response.transports = r.getTransports?.() ?? []
  } else {
    response.authenticatorData = toB64u(r.authenticatorData)
    response.signature = toB64u(r.signature)
    response.userHandle = toB64u(r.userHandle)
  }
  return { id: c.id, rawId: toB64u(c.rawId), type: c.type, response, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment }
}

const cancelled = (e: unknown) => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')

/** Make a passkey: for a new account (with its handle), or added to the signed-in account. */
/** Add a passkey to the signed-in account, or (with a handle and an invite code) make a new account with it. */
export async function createPasskey(handle?: string, invite?: string): Promise<{ token?: string; user: User }> {
  const body = handle ? { handle, invite: invite ?? '' } : {}
  const { ceremony, options } = await api<{ ceremony: string; options: Json }>('POST', '/auth/passkeys/register/options', body)
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.create({ publicKey: creationOptions(options) })) as PublicKeyCredential
  } catch (e) {
    if (cancelled(e)) throw new Error('No passkey was made.')
    throw e
  }
  return api('POST', '/auth/passkeys/register/verify', { ceremony, credential: credentialJson(cred), name: deviceName() })
}

export async function signInWithPasskey(): Promise<{ token: string; user: User }> {
  const { ceremony, options } = await api<{ ceremony: string; options: Json }>('POST', '/auth/passkeys/login/options')
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.get({ publicKey: requestOptions(options) })) as PublicKeyCredential
  } catch (e) {
    if (cancelled(e)) throw new Error('Signing in with a passkey was cancelled.')
    throw e
  }
  return api('POST', '/auth/passkeys/login/verify', { ceremony, credential: credentialJson(cred) })
}

function deviceName(): string {
  const ua = navigator.userAgent
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : 'Passkey'
}
