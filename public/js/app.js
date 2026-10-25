import { PROGRAM_DAYS, WALK_MIN, WALK_PHASES, walkSegments } from './plan.js';
import { planFor } from './logic.js';
import { actions } from './actions.js';
import { initNotifications, scheduleLocal } from './notify.js';
import { getState, subscribe, todayKey, update } from './store.js';
import { esc, icon, longDate, mmss, since, toast, vibrate } from './ui.js';
import * as today from './views/today.js';
import * as taper from './views/taper.js';
import * as move from './views/move.js';
import * as fuel from './views/fuel.js';
import * as progress from './views/progress.js';
import * as settings from './views/settings.js';
import * as onboarding from './views/onboarding.js';

const ROUTES = {
  today: { view: today, title: 'Today', icon: 'home', tab: 'Today' },
  taper: { view: taper, title: 'Taper', icon: 'leaf', tab: 'Taper' },
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
  'hide-notify-banner': () => update((s) => { s.settings.hideNotifyBanner = true; }),
  install: async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    render();
  },
};
const CHANGES = { ...taper.changes, ...fuel.changes, ...settings.changes };
const SUBMITS = { ...move.submits, ...onboarding.submits };

const root = document.getElementById('root');
const overlayHost = document.getElementById('overlay');

function route() {
  const name = location.hash.replace(/^#/, '').split('/')[0];
  return ROUTES[name] ? name : 'today';
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0d0d' : '#f4f4f1');
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
  return { id: a.id, start: a.selectionStart, end: a.selectionEnd };
}

function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el) return;
  el.focus({ preventScroll: true });
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch { /* not a text input */ }
}

let lastRoute = null;
let renderedDay = todayKey();

function render() {
  const s = getState();
  applyTheme(s.settings.theme);
  renderedDay = todayKey();
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
}

// ---------- live counters ----------

let rerenderQueued = false;
function tick() {
  const now = Date.now();
  if (todayKey() !== renderedDay) {
    render();
    scheduleLocal();
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
});

window.addEventListener('hashchange', render);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    scheduleLocal();
  }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getState().settings.theme));

subscribe(render);
render();
setInterval(tick, 1000);
initNotifications().then(() => { if (route() === 'settings') render(); });
