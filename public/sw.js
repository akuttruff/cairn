// App-shell cache so the installed app opens instantly and without a network.
// The API is never cached: a food log served stale would show the wrong day.
const CACHE = 'cairn-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** Hashed build output: its name changes with every build, so a cached copy is never stale. */
const isAsset = (url) => url.pathname.startsWith('/assets/')

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  if (isAsset(url)) {
    // Cache first: once fetched, a build's script and stylesheet never need the network again.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) void caches.open(CACHE).then((c) => c.put(req, res.clone()))
        return res
      })),
    )
    return
  }
  if (req.mode === 'navigate' || url.pathname === '/') {
    event.respondWith(pageFirst(req))
    return
  }
  // Icons and the manifest: network first, so a new one shows up; the cached copy as fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) void caches.open(CACHE).then((c) => c.put(req, res.clone()))
        return res
      })
      .catch(() => caches.match(req)),
  )
})

/** The page: fresh from the network so a new build shows up on the next open; the cached one offline. */
async function pageFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (res.ok) {
      void cache.put('/', res.clone())
      void pruneAssets(cache, res.clone())
    }
    return res
  } catch {
    return (await cache.match(req)) || (await cache.match('/')) || fetch(req)
  }
}

/** Keep only the assets the current page references; older builds' files just take up space. */
async function pruneAssets(cache, pageRes) {
  try {
    const html = await pageRes.text()
    const keys = await cache.keys()
    await Promise.all(keys
      .filter((k) => isAsset(new URL(k.url)) && !html.includes(new URL(k.url).pathname))
      .map((k) => cache.delete(k)))
  } catch { /* housekeeping only */ }
}
