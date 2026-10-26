// Notifications in two tiers:
//  • push  — Web Push via /api/push/* + QStash; arrives even when the app is closed.
//  • local — the service worker shows reminders on timers while the app is open or
//            backgrounded. Used when the server isn't configured.
import { addDays, tsForDayTime, weekday } from './plan.js';
import { buildMessage, messageContext, resolveReminders } from './reminders.js';
import { getState, peekDay, subscribe, todayKey, update } from './store.js';
import { gapEnd, morningLockEnd, planFor } from './logic.js';
import { postJson } from './api.js';
import { smartLine, smartSnapshot } from './coach.js';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const support = {
  notifications: 'Notification' in window && 'serviceWorker' in navigator,
  push: 'serviceWorker' in navigator && 'PushManager' in window,
  ios: isIOS,
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
};

let reg = null;
let config = null;

export const getConfig = () => config;

export function permission() {
  return support.notifications ? Notification.permission : 'unsupported';
}

export function mode() {
  const n = getState().notify;
  if (!n.enabled || permission() !== 'granted') return 'off';
  return n.push ? 'push' : 'local';
}

async function fetchConfig() {
  try {
    const r = await fetch('/api/push/config', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch {
    return { push: false, publicKey: null, needsCode: false, missing: [], unreachable: true };
  }
}

export async function initNotifications() {
  if ('serviceWorker' in navigator) {
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate') location.hash = new URL(e.data.url, location.origin).hash || '#today';
    });
  }
  config = await fetchConfig();
  writeSnapshot();
  subscribe(writeSnapshot);
  const n = getState().notify;
  if (n.enabled && permission() !== 'granted') {
    update((s) => { s.notify.enabled = false; s.notify.push = false; });
  } else if (n.enabled && n.push && config.push) {
    syncPush().catch((err) => console.warn('Push re-sync failed', err));
  }
  scheduleLocal();
  return config;
}

const api = (path, body) => postJson(`/api/push/${path}`, body);

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function sameKey(buf, bytes) {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}

async function subscription() {
  const r = reg || (await navigator.serviceWorker.ready);
  const key = b64ToBytes(config.publicKey);
  let sub = await r.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub || withTimeout(
    r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
    20000,
    'The browser push service did not respond',
  );
}

function basePayload(sub) {
  const s = getState();
  return { uid: s.uid, subscription: sub.toJSON(), tz: tz(), ctx: messageContext(s.settings, tz()) };
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Push the reminder schedule to QStash. Skips the call when nothing changed this week.
export async function syncPush({ force = false } = {}) {
  if (!config?.push || !support.push) throw new Error('Server push is not configured');
  const sub = await subscription();
  const reminders = resolveReminders(getState().settings).filter((r) => r.on).map(({ key, time, days }) => ({ key, time, days }));
  const body = { ...basePayload(sub), reminders };
  const h = hash(JSON.stringify(body) + getState().settings.pushCode);
  const n = getState().notify;
  if (!force && n.push && n.syncedHash === h && Date.now() - n.lastSync < 7 * 86400000) return;
  await api('sync', body);
  update((s) => Object.assign(s.notify, { push: true, endpoint: sub.endpoint, lastSync: Date.now(), syncedHash: h }));
}

let resyncTimer;
export function settingsChanged() {
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => {
    if (mode() === 'push') syncPush().catch((err) => console.warn('Push re-sync failed', err));
    scheduleLocal();
  }, 1200);
}

export async function enableNotifications() {
  if (!support.notifications) throw new Error('This browser does not support notifications.');
  if (support.ios && !support.standalone) {
    throw new Error('On iPhone/iPad, add Track to your Home Screen first (Share → Add to Home Screen), then turn on notifications inside the installed app.');
  }
  const p = await Notification.requestPermission();
  if (p !== 'granted') {
    throw new Error(p === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser settings and try again.' : 'Permission request was dismissed.');
  }
  update((s) => { s.notify.enabled = true; });
  let pushError = null;
  if (config?.push && support.push) {
    try {
      await syncPush({ force: true });
    } catch (err) {
      pushError = err.message;
      update((s) => { s.notify.push = false; });
    }
  }
  scheduleLocal();
  return { push: getState().notify.push, pushError };
}

export async function disableNotifications() {
  const s = getState();
  if (s.notify.push) {
    await api('unsubscribe', { uid: s.uid }).catch(() => null);
    try {
      const sub = await (reg || (await navigator.serviceWorker.ready)).pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch { /* already gone */ }
  }
  update((st) => Object.assign(st.notify, { enabled: false, push: false, endpoint: null, syncedHash: '', once: {} }));
  scheduleLocal();
}

// One-off timers (craving buffer, morning lock, 2-hour gap).
export async function scheduleOnce(key, at, data = {}) {
  const s = getState();
  if (mode() === 'push') {
    const replace = s.notify.once[key];
    update((st) => { delete st.notify.once[key]; });
    try {
      const sub = await subscription();
      const res = await api('once', { ...basePayload(sub), key, at, data, replace });
      update((st) => { st.notify.once[key] = res.messageId; });
    } catch (err) {
      console.warn('One-off push failed; falling back to local timer', err);
    }
  }
  scheduleLocal();
}

export function cancelOnce(key) {
  const id = getState().notify.once[key];
  if (id) {
    update((st) => { delete st.notify.once[key]; });
    api('cancel', { messageId: id }).catch(() => null);
  }
  scheduleLocal();
}

export async function show(m) {
  const r = reg || (await navigator.serviceWorker?.ready);
  const opts = {
    body: m.body, tag: m.tag, renotify: true, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
    data: { url: m.url, tag: m.tag },
    actions: [{ action: 'urge', title: '😮‍💨 Urge' }, { action: 'pouch', title: 'Log pouch' }], // same as sw.js
  };
  if (r) return r.showNotification(m.title, opts);
  delete opts.actions; // only service-worker notifications can have buttons
  return new Notification(m.title, opts);
}

export async function sendTest() {
  const s = getState();
  if (mode() === 'push') {
    const sub = await subscription();
    await api('test', basePayload(sub));
    return 'push';
  }
  await show({
    title: '✅ Notifications are working',
    body: 'Local mode: reminders appear while Track is open or in the background.',
    tag: 'test',
    url: '/#settings',
  });
  return s.notify.enabled ? 'local' : 'preview';
}

// ---- smart reminder text for the service worker ----

let snapTimer;
export function writeSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(async () => {
    try {
      const cache = await caches.open('track-smart');
      await cache.put('/__smart.json', new Response(JSON.stringify(smartSnapshot()), { headers: { 'content-type': 'application/json' } }));
    } catch { /* storage unavailable */ }
  }, 500);
}

// ---- local timers ----

let timers = [];

export function scheduleLocal() {
  timers.forEach(clearTimeout);
  timers = [];
  const s = getState();
  if (mode() === 'off') return;
  const now = Date.now();
  const key = todayKey();
  const pushOn = mode() === 'push';
  const events = [];

  if (!pushOn) {
    for (const r of resolveReminders(s.settings)) {
      if (!r.on) continue;
      for (const k of [key, addDays(key, 1)]) {
        if (r.days && !r.days.includes(weekday(k))) continue;
        events.push({ key: r.key, at: tsForDayTime(k, r.time) });
      }
    }
  }
  const once = s.notify.once || {};
  const local = (k) => !(pushOn && once[k]);
  const rec = peekDay(key);
  if (s.craving && local('craving')) events.push({ key: 'craving', at: s.craving.endsAt });
  if (rec?.wakeAt && local('lockEnd')) events.push({ key: 'lockEnd', at: morningLockEnd(key, rec) });
  const g = gapEnd(key, rec);
  if (g && local('gap')) events.push({ key: 'gap', at: g, data: { remaining: Math.max(0, planFor(key).cap - rec.pouches.length) } });

  for (const e of events) {
    const delay = e.at - now;
    if (delay <= 0 || delay > 36 * 3600000) continue;
    timers.push(setTimeout(() => {
      const m = buildMessage(e.key, messageContext(getState().settings, tz()), Date.now(), e.data || {});
      show({ ...m, ...smartLine(smartSnapshot(), e.key) }).catch(() => null);
    }, delay));
  }
}
