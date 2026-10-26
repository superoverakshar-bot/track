// Service worker: offline app shell (network-first, cache fallback) + push display.
const CACHE = 'track-v6';
const SMART = 'track-smart'; // reminder text written by the app (see coach.js smartSnapshot)
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/css/app.css',
  '/js/app.js', '/js/achievements.js', '/js/actions.js', '/js/api.js', '/js/autopilot.js', '/js/charts.js', '/js/coach.js', '/js/joy.js', '/js/logic.js', '/js/notify.js', '/js/plan.js',
  '/js/reminders.js', '/js/store.js', '/js/taper.js', '/js/ui.js', '/js/vapid.js',
  '/js/views/coach.js', '/js/views/fuel.js', '/js/views/move.js', '/js/views/onboarding.js', '/js/views/parts.js',
  '/js/views/progress.js', '/js/views/settings.js', '/js/views/taper.js', '/js/views/today.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/badge-96.png',
  '/fonts/PlusJakartaSans-latin.woff2', '/fonts/PlusJakartaSans-latin-ext.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SMART).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())),
  );
});

// The app keeps a snapshot of reminder text that reflects what you've logged
// today ("Shield done ✓", "1.2 L behind on water"); prefer it over the server copy.
async function smartLine(tag) {
  try {
    const res = await caches.match('/__smart.json', { cacheName: SMART });
    if (!res) return null;
    const now = Date.now();
    const snap = await res.json();
    return snap.blocks?.find((b) => now >= b.from && now < b.until)?.lines?.[tag] || null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = { title: 'Track', body: event.data?.text() };
  }
  event.waitUntil((async () => {
    Object.assign(m, await smartLine(m.tag));
    await self.registration.showNotification(m.title || 'Track', {
      body: m.body || '',
      tag: m.tag || 'track',
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      vibrate: [80, 40, 80],
      data: { url: m.url || '/#today', tag: m.tag },
      actions: ACTIONS, // buttons on Android and desktop; iPhone ignores them and opens the quick-log sheet instead
    });
  })());
});

// Tapping a button logs straight away; tapping the notification opens a quick-log
// sheet for that reminder (on iPhone, where buttons aren't shown, that's two taps).
const ACTIONS = [{ action: 'urge', title: '😮‍💨 Urge' }, { action: 'pouch', title: 'Log pouch' }];

function clickUrl(action, data = {}) {
  if (action === 'urge' || action === 'pouch') return `/#today?do=${action}`;
  const url = data.url || '/#today';
  return data.tag && data.tag !== 'test' ? `${url}?quick=${encodeURIComponent(data.tag)}` : url;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = clickUrl(event.action, event.notification.data);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      client.postMessage({ type: 'navigate', url });
      return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
