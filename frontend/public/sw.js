// Scythe's service worker. It does one thing: show the notifications (nudges) the team's server pushes to this
// browser. No caching, no offline. The browser has already decrypted each push; only this origin's pages open.
self.addEventListener('push', (event) => {
  let note = { title: 'Scythe', body: '', url: '/' }
  if (event.data) {
    try { note = { ...note, ...event.data.json() } } catch { note.body = event.data.text() }
  }
  event.waitUntil(self.registration.showNotification(String(note.title), {
    body: String(note.body), tag: 'scythe-nudge', data: { url: String(note.url) },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin)
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
    return open ? open.focus() : self.clients.openWindow(url.href)
  }))
})
