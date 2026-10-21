/**
 * Notifications in this browser (Web Push). Once a member turns them on, the team's server sends their nudges here,
 * encrypted for this browser, through the browser's own push service (Google's, Mozilla's, Apple's or Microsoft's).
 * public/sw.js shows them. On an iPhone, Scythe must be added to the Home Screen and opened from there first.
 */
import { api } from './api'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** This browser's subscription, if notifications are on here. */
export async function pushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

export async function turnOnPush(): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('This browser is blocking notifications from Scythe. Allow them in its settings for this site, then try again.')
  }
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  const { key } = await api<{ key: string }>('GET', '/auth/push/key')
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  const j = sub.toJSON()
  await api('POST', '/auth/push', { endpoint: j.endpoint, keys: j.keys })
}

/** Off in this browser: the server forgets it, and the browser drops the subscription. */
export async function turnOffPush(): Promise<void> {
  const sub = await pushSubscription()
  if (!sub) return
  try { await api('DELETE', `/auth/push?${new URLSearchParams({ endpoint: sub.endpoint })}`) } finally { await sub.unsubscribe() }
}

export const testPush = () => api<{ sent: number; gone: number; failed: number }>('POST', '/auth/push/test')
