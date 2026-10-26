import { PROGRAM_DAYS, WALK_MIN, WALK_PHASES, walkSegments } from './plan.js';
import { planFor, scoreFor } from './logic.js';
import { badges } from './achievements.js';
import { celebrate } from './joy.js';
import { nextWindow, pouchFreeHours } from './taper.js';
import { actions, autoFinishCraving } from './actions.js';
import { initNotifications, scheduleLocal } from './notify.js';
import { emptyDay, getState, logEvent, noteOpen, peekDay, subscribe, todayKey, update } from './store.js';
import * as autopilot from './autopilot.js';
import { clock, dialog, esc, icon, longDate, mmss, since, toast, vibrate } from './ui.js';
import * as today from './views/today.js';
import * as coachView from './views/coach.js';
import * as taper from './views/taper.js';
import * as move from './views/move.js';
import * as fuel from './views/fuel.js';
import * as progress from './views/progress.js';
import * as settings from './views/settings.js';
import * as onboarding from './views/onboarding.js';

const ROUTES = {
  today: { view: today, title: 'Today', icon: 'home', tab: 'Today' },
  taper: { view: taper, title: 'Tansen taper', icon: 'leaf', tab: 'Taper' },
  coach: { view: coachView, title: 'Coach', icon: 'spark', tab: 'Coach' },
  move: { view: move, title: 'Move', icon: 'run', tab: 'Move' },
  fuel: { view: fuel, title: 'Fuel', icon: 'bowl', tab: 'Fuel' },
  progress: { view: progress, title: 'Progress', icon: 'chart', tab: 'Progress' },
  settings: { view: settings, title: 'Settings' },
};

let installPrompt = null;

const ACTIONS = {
  ...actions,
  ...move.moveActions,
  ...settings.settingsActions,
  ...coachView.coachActions,
  install: async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    render();
  },
};
// What a tap tells us about your routine. The autopilot learns your real times from these.
const EVENT_KIND = {
  wake: 'wake', 'craving-start': 'urge', 'craving-saved': 'urge_beaten', 'pouch-log': null,
  'water-add': 'water', 'craving-water': 'water', 'drink-water': 'water', 'drink-add': 'drink',
  'dinner-now': 'dinner', 'rep-add': 'reps', 'hold-start': 'hold', 'hold-add': 'hold', 'round-done': 'circuit',
  'walk-start': 'walk_start', 'walk-end': 'walk_end', checkin: 'checkin', 'kegel-add': 'kegel',
  toggle: (el) => ({ microManual: 'microset' })[el.dataset.field] || el.dataset.field,
  check: (el) => ({ morning: 'morningWater' })[el.dataset.id] || el.dataset.id,
};

// ---------- quick log from notifications ----------

// Each reminder's own one-tap action on the quick-log sheet.
const QUICK_EXTRA = {
  wake: { label: "☀️ I'm awake", action: 'wake' },
  water1: { label: '💧 +500 ml water', action: 'water-add', data: { ml: '500' } },
  water2: { label: '💧 +500 ml water', action: 'water-add', data: { ml: '500' } },
  lunch: { label: '🥗 Sprouts + protein done', action: 'check', data: { id: 'protein' } },
  shield: { label: '🛡️ 4 PM snack done', action: 'check', data: { id: 'snack' } },
  dinner: { label: '🍽️ Dinner done', action: 'dinner-now' },
  craving: { label: '✅ Urge passed', action: 'craving-saved', needsCraving: true },
  microset: { label: '💪 Log reps', action: 'nav', data: { to: '#move' } },
  walk: { label: '🏃 Start 30-min timer', action: 'nav', data: { to: '#move' } },
  circuit: { label: '🏋️ Open circuit', action: 'nav', data: { to: '#move' } },
  checkin: { label: '📝 Rate today', action: 'nav', data: { to: '#coach' } },
};

async function run(name, data = {}) {
  const el = { dataset: { ...data }, disabled: false };
  await ACTIONS[name]?.(el);
  noteActivity(name, el);
}

async function quickSheet(tag) {
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const plan = planFor(key);
  const w = nextWindow(key, rec, Date.now());
  const craving = getState().craving;
  const extra = QUICK_EXTRA[tag] && (!QUICK_EXTRA[tag].needsCraving || craving) ? QUICK_EXTRA[tag] : null;
  const status = `${rec.pouches.length} of ${plan.cap} pouches today${w.reason === 'cap' ? ' · cap reached' : w.next && w.next > Date.now() ? ` · next fits ${clock(w.next)}` : ''}`;
  const buttons = [
    ...(extra ? [{ label: extra.label, value: 'extra', cls: 'block good' }] : []),
    ...(craving ? [] : [{ label: '😮‍💨 Urge: start 15-min buffer', value: 'urge', cls: 'block primary' }]),
    { label: '➕ Log pouch', value: 'pouch', cls: 'block' },
    { label: 'Close', value: null, cls: 'block ghost' },
  ];
  const v = await dialog({ title: 'Quick log', html: `<p class="small muted">${esc(status)}</p>`, buttons });
  if (v === 'extra') await run(extra.action, extra.data);
  else if (v === 'urge') await run('craving-start');
  else if (v === 'pouch') await run('pouch-log');
}

// Links from notifications and home-screen shortcuts: #today?do=urge, #fuel?quick=water1
async function handleIntent() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  if (!query) return;
  history.replaceState(null, '', `#${path || 'today'}`);
  if (!getState().settings.onboarded) return;
  const q = new URLSearchParams(query);
  try {
    if (q.get('do') === 'urge') { if (!getState().craving) await run('craving-start'); }
    else if (q.get('do') === 'pouch') await run('pouch-log');
    else if (q.get('quick')) await quickSheet(q.get('quick'));
  } catch (err) {
    toast(err.message || 'Something went wrong');
  }
}

function noteActivity(name, el) {
  if (!(name in EVENT_KIND)) return;
  const kind = typeof EVENT_KIND[name] === 'function' ? EVENT_KIND[name](el) : EVENT_KIND[name];
  update(() => logEvent(kind));
  autopilot.poke();
}

const CHANGES = { ...taper.changes, ...fuel.changes, ...settings.changes, ...coachView.coachChanges };
const SUBMITS = { ...move.submits, ...onboarding.submits };

const root = document.getElementById('root');
const overlayHost = document.getElementById('overlay');

function route() {
  const name = location.hash.replace(/^#/, '').split(/[/?]/)[0];
  return ROUTES[name] ? name : 'today';
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0a1a' : '#fff8f3');
}

function header(name) {
  const plan = planFor();
  const r = ROUTES[name];
  const dayText = plan.day < 1 ? `Starts in ${1 - plan.day} day${plan.day === 0 ? '' : 's'}` : plan.day > PROGRAM_DAYS ? 'Program complete' : `Day ${plan.day}/${PROGRAM_DAYS} · ${plan.phase.name}`;
  const notifyOn = getState().notify.enabled;
  const pct = Math.max(0, Math.min(100, (plan.day / PROGRAM_DAYS) * 100));
  return `<header class="topbar">
      <div class="title"><h1>${esc(r.title)}</h1><div class="sub">${esc(dayText)} · ${esc(longDate(todayKey()))}</div></div>
      <a class="icon-btn ${notifyOn ? 'on' : ''}" href="#settings" aria-label="Notifications ${notifyOn ? 'on' : 'off'}">${icon(notifyOn ? 'bell' : 'bellOff')}</a>
      <a class="icon-btn" href="#settings" aria-label="Settings">${icon('gear')}</a>
    </header>
    <div class="progress-strip" aria-hidden="true"><span style="width:${pct}%"></span></div>`;
}

function tabbar(name) {
  return `<div class="tabbar"><nav aria-label="Sections">${Object.entries(ROUTES).filter(([, r]) => r.tab)
    .map(([k, r]) => `<a href="#${k}" ${k === name ? 'aria-current="page"' : ''}>${icon(r.icon)}<span>${r.tab}</span></a>`).join('')}</nav></div>`;
}

function installCard() {
  if (!installPrompt) return '';
  return `<div class="banner info" style="margin-bottom:14px">${icon('download')}<div class="grow"><b>Install Track</b><span class="small">Home-screen app, full screen, reliable notifications.</span></div>
    <button class="btn sm primary" data-action="install">Install</button></div>`;
}

// Keep focus (and caret) on the same control across re-renders.
function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.id || !root.contains(a)) return null;
  const typed = ['text', 'password', 'number', 'search'].includes(a.type);
  return { id: a.id, start: a.selectionStart, end: a.selectionEnd, value: typed ? a.value : null };
}

function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el) return;
  if (f.value != null) el.value = f.value;
  el.focus({ preventScroll: true });
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch { /* not a text input */ }
}

let lastRoute = null;
let renderedDay = todayKey();
let renderedAt = 0;

function render() {
  const s = getState();
  applyTheme(s.settings.theme);
  renderedDay = todayKey();
  renderedAt = Date.now();
  if (!s.settings.onboarded) {
    root.innerHTML = onboarding.render();
    onboarding.mount(root);
    overlayHost.innerHTML = '';
    return;
  }
  const name = route();
  const focus = captureFocus();
  const view = ROUTES[name].view;
  root.innerHTML = `<div class="app">${header(name)}${name === 'settings' || name === 'today' ? installCard() : ''}<main id="main">${view.render()}</main></div>${tabbar(name)}`;
  view.mount?.(root.querySelector('#main'));
  if (lastRoute !== name) {
    window.scrollTo(0, 0);
    lastRoute = name;
  }
  restoreFocus(focus);
  renderWalk(true);
  tick();
  checkMilestones();
}

// ---------- celebrations ----------

// Pouch-free stretches worth a party (hours since the last pouch).
const FREE_HOURS = [24, 48, 72, 168, 336, 720];
const freeLabel = (h) => (h < 168 ? `${h} hours` : h === 168 ? '1 week' : h === 336 ? '2 weeks' : '30 days');

let milestoneTimer;
let lastParty = 0;
function checkMilestones() {
  clearTimeout(milestoneTimer);
  const wait = Math.max(400, 3500 - (Date.now() - lastParty));
  milestoneTimer = setTimeout(() => {
    const s = getState();
    if (!s.settings.onboarded) return;
    const key = todayKey();
    if (scoreFor(key) === 5 && s.perfectDay !== key) {
      lastParty = Date.now();
      update((st) => { st.perfectDay = key; });
      celebrate('Perfect day! ⭐ All 5 non-negotiables done');
      return;
    }
    const free = pouchFreeHours();
    if (free) {
      const hit = FREE_HOURS.filter((h) => free.hours >= h).pop();
      const seen = s.freeMilestone?.since === free.since ? s.freeMilestone.hours : 0;
      if (hit && hit > seen) {
        lastParty = Date.now();
        update((st) => { st.freeMilestone = { since: free.since, hours: hit }; });
        celebrate(`${freeLabel(hit)} pouch-free! 🕊️ Your body is already healing`);
        return;
      }
    }
    const fresh = badges().filter((b) => b.unlocked && !s.badgesSeen.includes(b.id));
    if (fresh.length) {
      lastParty = Date.now();
      update((st) => { st.badgesSeen = [...st.badgesSeen, ...fresh.map((b) => b.id)]; });
      celebrate(fresh.length === 1 ? `Badge unlocked: ${fresh[0].emoji} ${fresh[0].name}` : `${fresh.length} badges unlocked! ${fresh.map((b) => b.emoji).join(' ')}`);
    }
  }, wait);
}

// ---------- live counters ----------

let rerenderQueued = false;
function tick() {
  const now = Date.now();
  if (getState().craving && autoFinishCraving(now)) return; // re-renders itself
  if (todayKey() !== renderedDay) {
    render();
    scheduleLocal();
    return;
  }
  // Suggestions are time-aware; refresh them every few minutes while the app is open.
  if (now - renderedAt > 5 * 60000 && !document.querySelector('dialog[open]') && !getState().walkTimer) {
    render();
    return;
  }
  for (const el of root.querySelectorAll('[data-countdown]')) {
    const left = Number(el.dataset.countdown) - now;
    el.textContent = left > 0 ? mmss(left) : '00:00';
    if (left <= 0 && el.hasAttribute('data-rerender') && !rerenderQueued) {
      rerenderQueued = true;
      setTimeout(() => { rerenderQueued = false; render(); }, 300);
    }
  }
  for (const el of root.querySelectorAll('[data-since]')) el.textContent = since(now - Number(el.dataset.since));
  for (const el of root.querySelectorAll('[data-since-sec]')) el.textContent = `${Math.floor((now - Number(el.dataset.sinceSec)) / 1000)}s`;
  for (const el of root.querySelectorAll('[data-until]')) {
    const left = Number(el.dataset.until) - now;
    el.textContent = left > 3600000 ? since(left) : `${Math.max(0, Math.ceil(left / 60000))} min`;
  }
  renderWalk(false);
}

// ---------- walk interval timer ----------

let audio = null;
let wakeLock = null;
let lastSeg = -1;

function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
  } catch { /* no audio */ }
}

function beep(times = 1, freq = 880) {
  if (!audio) return;
  for (let i = 0; i < times; i++) {
    const t = audio.currentTime + i * 0.28;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.24);
  }
}

async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed */ }
}

function walkState(t, now) {
  const segs = walkSegments(t.mode);
  const total = WALK_MIN * 60000;
  const elapsed = Math.min(total, Math.max(0, (t.pausedAt || now) - t.startedAt - t.pausedMs));
  let start = 0;
  let idx = 0;
  for (; idx < segs.length - 1; idx++) {
    const end = start + segs[idx].min * 60000;
    if (elapsed < end) break;
    start = end;
  }
  const seg = segs[idx];
  return { segs, idx, seg, elapsed, segLeft: start + seg.min * 60000 - elapsed, totalLeft: total - elapsed, done: elapsed >= total };
}

function renderWalk(full) {
  const t = getState().walkTimer;
  if (!t || !getState().settings.onboarded) {
    if (overlayHost.innerHTML) overlayHost.innerHTML = '';
    keepAwake(false);
    lastSeg = -1;
    return;
  }
  const w = walkState(t, Date.now());
  if (lastSeg !== -1 && w.idx !== lastSeg && !w.done) {
    const fast = w.seg.kind === 'fast';
    beep(fast ? 2 : 1, fast ? 990 : 660);
    vibrate(fast ? [120, 80, 120] : [200]);
    full = true;
  }
  if (w.done && !t.finished) {
    beep(3, 1040);
    vibrate([300, 100, 300]);
    update((s) => { s.walkTimer.finished = true; s.walkTimer.pausedAt = s.walkTimer.pausedAt || Date.now(); });
    return;
  }
  lastSeg = w.idx;
  if (!full && t.finished) return;
  if (!full && overlayHost.firstElementChild) {
    overlayHost.querySelector('[data-w="clock"]').textContent = mmss(w.done ? 0 : w.segLeft);
    overlayHost.querySelector('[data-w="total"]').textContent = mmss(w.totalLeft);
    const bar = overlayHost.querySelector(`[data-w-seg="${w.idx}"] > span`);
    if (bar) bar.style.width = `${Math.min(100, 100 - (w.segLeft / (w.seg.min * 60000)) * 100)}%`;
    return;
  }
  keepAwake(!t.pausedAt);
  const phase = WALK_PHASES[t.mode];
  const round = w.seg.round ? `Round ${w.seg.round} of 6 · ` : '';
  overlayHost.innerHTML = `<div class="overlay" role="dialog" aria-modal="true" aria-label="30-minute session timer">
    <div class="row"><div class="grow"><b>${esc(phase.name)}</b><div class="small muted">${t.mode === 'continuous' ? 'Continuous' : `${t.mode} intervals`}</div></div>
      <span class="badge ${t.pausedAt && !t.finished ? 'warn' : 'info'}">${t.finished ? 'Done' : t.pausedAt ? 'Paused' : 'Live'}</span></div>
    <div class="center">
      ${t.finished ? `<div class="seg-label">30:00 complete 🎉</div><div class="clock">00:00</div><p class="small muted" style="text-align:center">Check your distance and log it.</p>`
      : `<div class="seg-kind ${w.seg.kind}">${w.seg.kind === 'fast' ? 'Push' : 'Steady'}</div>
      <div class="seg-label">${esc(w.seg.label)}</div>
      <div class="clock" data-w="clock">${mmss(w.segLeft)}</div>
      <p class="small muted" style="text-align:center">${round}<span data-w="total">${mmss(w.totalLeft)}</span> left</p>`}
      <div class="timeline">${w.segs.map((s, i) => `<div class="${s.kind}" data-w-seg="${i}" style="flex:${s.min}"><span style="width:${i < w.idx || t.finished ? 100 : i === w.idx ? Math.min(100, 100 - (w.segLeft / (s.min * 60000)) * 100) : 0}%"></span></div>`).join('')}</div>
    </div>
    <div class="btn-row">
      ${t.finished ? '<button class="btn primary" data-action="walk-end">Log distance</button>'
      : `${t.pausedAt ? `<button class="btn primary" data-action="walk-resume">${icon('play')}Resume</button>` : `<button class="btn" data-action="walk-pause">${icon('pause')}Pause</button>`}
      <button class="btn danger" data-action="walk-end">${icon('stop')}End</button>`}
    </div></div>`;
}

// ---------- events ----------

async function onAction(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  if (el.dataset.action === 'walk-start') unlockAudio();
  try {
    await fn(el, e);
    noteActivity(el.dataset.action, el);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong');
  }
}

root.addEventListener('click', onAction);
overlayHost.addEventListener('click', onAction);
root.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el) CHANGES[el.dataset.change]?.(el, e);
});
root.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  SUBMITS[form.dataset.submit]?.(form);
  update(() => logEvent(null)); // a walk or waist log is new data too
  autopilot.poke();
});

window.addEventListener('hashchange', () => { render(); handleIntent(); });
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  render();
});
function opened() {
  if (getState().settings.onboarded) update(() => noteOpen());
  autopilot.poke(5000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    opened();
    render();
    scheduleLocal();
  }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getState().settings.theme));

subscribe(render);
render();
setInterval(tick, 1000);
initNotifications().then(() => { render(); opened(); }); // server features (push, AI) known now
handleIntent();
