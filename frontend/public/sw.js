/*
 * OG_FITNESS service worker.
 *
 * Three caches, because they have three different lifetimes:
 *
 *   shell   — the app itself, precached at install so the first offline load
 *             works even if nothing was visited online first. Named after the
 *             build, so a deploy replaces it wholesale instead of serving half
 *             of yesterday's app.
 *   media   — exercise images and animations. Deliberately NOT tied to the
 *             build: there are 1,300 exercises, and re-downloading them on
 *             every deploy is a real cost on a phone in India.
 *   runtime — everything else that gets fetched: language packs, the lazy
 *             route chunks, whatever the app asks for next.
 *
 * The placeholders below are filled in at build time (see the sw-shell plugin
 * in vite.config.js). Served unbuilt — the dev server — they stay literal, and
 * the guard below turns precaching off rather than caching a placeholder.
 */
const BUILD = '__BUILD__'
const SHELL = [/*__SHELL__*/]

const BUILT = BUILD !== '__' + 'BUILD__' && SHELL.length > 0
const SHELL_CACHE = `workout-shell-${BUILD}`
const MEDIA_CACHE = 'workout-media-v1'
const RUNTIME_CACHE = `workout-rt-${BUILD}`
const KEEP = [SHELL_CACHE, MEDIA_CACHE, RUNTIME_CACHE]

/*
 * The shell as absolute URLs. Requests arrive absolute, so comparing them
 * against relative build paths would never match — the cache-first branch
 * below would silently never fire.
 */
const SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.registration.scope).href))

/** The app shell's own entry, and the offline fallback for any navigation. */
const INDEX = new URL('index.html', self.registration.scope).href

self.addEventListener('install', e => {
  /*
   * Install used to be `skipWaiting()` and nothing else, so an install with no
   * network afterwards left an app that could not open at all: the fetch
   * handler only ever cached what had already been requested.
   *
   * `reload` bypasses the HTTP cache — installing a new build from a stale
   * disk copy is how a shell ends up pointing at asset hashes that no longer
   * exist on the server.
   */
  if (BUILT) {
    e.waitUntil(caches.open(SHELL_CACHE)
      .then(c => c.addAll([...SHELL_URLS].map(u => new Request(u, { cache: 'reload' }))))
      .catch(() => {})   // a failed precache must not block activation
      .then(() => self.skipWaiting()))
  } else {
    self.skipWaiting()
  }
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('workout-') && !KEEP.includes(k)).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(data.title || 'OG_FITNESS', {
    body: data.body || '',
    icon: 'icon-512.png',
    badge: 'icon-180.png',
    tag: data.tag || 'workout',
    renotify: true
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})

/*
 * `ignoreVary` on every lookup, and it is not optional.
 *
 * The preview and production servers both answer with `Vary: Origin`. A
 * precache request the worker makes itself carries no Origin header, and the
 * page's own module loads do — so a strict match misses every single entry.
 * The result is a worker that installs, reports a full cache, and still cannot
 * open the app offline, which is exactly what it did until this was measured.
 */
const MATCH = { ignoreVary: true }

/** Cache-first: for content whose URL changes when the content does. */
const cacheFirst = (req, cache) => caches.open(cache).then(c =>
  c.match(req, MATCH).then(hit => hit || fetch(req).then(res => {
    if (res.ok) c.put(req, res.clone())
    return res
  })))

/** Network-first, falling back to whatever was last seen. */
const networkFirst = (req, cache) => fetch(req).then(res => {
  if (res.ok) caches.open(cache).then(c => c.put(req, res.clone()))
  return res
}).catch(() => caches.match(req, MATCH).then(hit => hit || Promise.reject(new Error('offline'))))

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  // A navigation offline must land on the app, not on the browser's error page.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(INDEX, MATCH)))
    return
  }

  if (url.pathname.includes('/img/') || url.pathname.includes('/gif/')) {
    e.respondWith(cacheFirst(e.request, MEDIA_CACHE))
    return
  }

  /*
   * Build assets carry a content hash in the filename, so a hit is by
   * definition the right bytes and there is nothing to revalidate. Going to
   * the network first for them — as this did — spent a round trip per asset to
   * be told what the URL already guaranteed.
   */
  if (BUILT && SHELL_URLS.has(url.href)) {
    e.respondWith(cacheFirst(e.request, SHELL_CACHE))
    return
  }

  e.respondWith(networkFirst(e.request, RUNTIME_CACHE)
    .catch(() => caches.match(INDEX, MATCH).then(hit => hit || Response.error())))
})
