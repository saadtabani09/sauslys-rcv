const V = 'sauslys-rcv-v2';
const SHELL = [
  '/sauslys-rcv/',
  '/sauslys-rcv/index.html',
  '/sauslys-rcv/manifest.json',
  '/sauslys-rcv/icons/icon-192.png',
  '/sauslys-rcv/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;

  // HTML: network first
  if (e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }

  // Assets: cache first
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => { const cl = r.clone(); caches.open(V).then(ca => ca.put(e.request, cl)); return r; })));
});
