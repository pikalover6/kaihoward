// Kai Planner service worker — web push for reminders.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? JSON.parse(event.data.text()) : {}
  } catch {
    data = { title: 'Kai Planner', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Kai Planner'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: data.tag,
      data: { url: data.url || '/personal' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/personal'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        if (client.url.includes('/personal') && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })(),
  )
})

// Present so the app meets installability criteria.
self.addEventListener('fetch', () => {})
