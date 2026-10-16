// Offline support: the app shell and its hashed assets are cached as they are fetched, so the site
// opens instantly and works with no network. Traces are never fetched or cached; they stay local.
const CACHE = 'tracey-v1'

// Precache the page and every asset it (transitively) references, including the lazily-created
// parser worker, so the very first visit already works offline.
async function precache() {
  const cache = await caches.open(CACHE)
  const page = await fetch('/', { cache: 'reload' })
  await cache.put('/', page.clone())
  const html = await page.text()
  const seen = new Set()
  const queue = [...html.matchAll(/(?:href|src)="(\/[^"]+\.(?:js|css|png|svg|webmanifest))"/g)].map((m) => m[1])
  while (queue.length) {
    const url = queue.shift()
    if (seen.has(url)) continue
    seen.add(url)
    const res = await fetch(url)
    if (!res.ok) continue
    await cache.put(url, res.clone())
    if (url.endsWith('.js')) {
      const body = await res.text()
      for (const m of body.matchAll(/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)) queue.push('/' + m[0])
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // The page itself: network first so a new release shows up, cache as the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    )
    return
  }

  // Everything else (hashed assets, icons, manifest): cache first, fill on miss.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
