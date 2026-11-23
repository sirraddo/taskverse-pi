// Makes the owner dashboard installable. Pages are always fetched fresh (they hold private, live numbers);
// only the icons and an offline page are kept on the phone.
const CACHE = 'sirraddo-owner-v2';
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="margin:0;font:16px -apple-system,Roboto,Arial,sans-serif;background:#13254F;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px"><div><b style="font-size:22px">You are offline</b><p>Connect to the internet, then pull down or reopen the app.</p></div></body>';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/icon-192.png', '/icon-512.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    return;
  }
  if (/\.(png)$/.test(new URL(req.url).pathname)) e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});

// Phone alerts sent by the owner hub.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SIRRADDO', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/owner' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/owner';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ('focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
