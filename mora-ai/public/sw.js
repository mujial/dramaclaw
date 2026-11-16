const CACHE_NAME = 'redmagic-mora-v3'
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/mora-cyber-cutout.png',
  '/assets/mora-academy-cutout.png',
  '/assets/mora-esports-cutout.png',
  '/assets/mora-chibi-cutout.png',
  '/assets/mora-charging.png',
  '/assets/bg-space-bridge.png',
  '/assets/bg-cyber-lab.png',
  '/assets/bg-neon-arena.png',
  '/assets/mora-icon-192.png',
  '/assets/mora-icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  )
})
