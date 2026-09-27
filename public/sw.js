// App-shell cache so the installed app opens instantly and without a network.
// The API is never cached: a food log served stale would show the wrong day.
const CACHE = 'macros-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  // Network first, so a new build shows up on the next open; cache as fallback.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put(event.request, copy))
        }
        return res
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/'))),
  )
})
