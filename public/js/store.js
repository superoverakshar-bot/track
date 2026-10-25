// App state, persisted to localStorage. Everything lives on this device.
import { dayKeyAt, isValidKey, toKey } from './plan.js';

const KEY = 'track.v1';

export function defaultSettings() {
  return {
    startDate: toKey(new Date()),
    baseline: 20,
    wakeTime: '06:30',
    sleepTime: '23:00',
    walkTime: '07:00',
    circuitDays: [1, 3, 5],
    circuitTime: '18:30',
    waistDays: [0],
    alcoholDays: [6],
    alcoholMax: 2,
    waterTargetL: 3,
    reminders: {},
    theme: 'system',
    focusAreas: ['quit', 'energy', 'focus', 'stamina'],
    why: '', // personal reason, shown on Today and during urges
    pricePerPouch: 0, // ₹, for money saved
    aiPrivate: true,
    pushCode: '',
    onboarded: false,
  };
}

export function emptyDay() {
  return {
    wakeAt: null,
    pouches: [], // [{ ts, flags: [] }]
    saved: 0,
    waterMl: 0,
    morningWater: false,
    sprouts: false,
    protein: false,
    booster: false,
    snack: false,
    dinnerAt: null,
    microManual: false,
    reps: { pushups: 0, squats: 0, pullups: 0, core: 0 },
    planks: [],
    hangs: [],
    rounds: 0,
    drinks: 0,
    drinkWater: 0,
    checkin: null, // { energy: 1-5, focus: 1-5, sleepHrs }
    kegels: 0, // pelvic-floor sets
  };
}

function fresh() {
  return {
    version: 1,
    uid: (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`),
    settings: defaultSettings(),
    days: {},
    walks: [], // [{ id, date, durationMin, distanceKm, mode, energy, ts }]
    waist: [], // [{ date, inches }]
    craving: null, // { startedAt, endsAt, water }
    walkTimer: null, // { startedAt, mode, pausedAt, pausedMs }
    walkDraft: null, // prefill for the walk log after a timed session
    hold: null, // { kind: 'plank'|'hang', startedAt }
    vitality: [], // [{ date, sec, ts }] private stamina log
    ai: null, // last AI coach reply { at, day, question, result }
    dismissed: null, // { day, ids } suggestions hidden for today
    badgesSeen: [], // achievement ids already celebrated
    perfectDay: null, // last day a 5/5 was celebrated
    notify: { enabled: false, push: false, endpoint: null, lastSync: 0, syncedHash: '', once: {} },
  };
}

// Fill in anything missing so older saves and imports keep working.
function normalize(raw) {
  const base = fresh();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.settings = { ...base.settings, ...(raw.settings || {}) };
  s.notify = { ...base.notify, ...(raw.notify || {}) };
  s.days = {};
  for (const [k, d] of Object.entries(raw.days || {})) {
    if (!isValidKey(k)) continue;
    const day = { ...emptyDay(), ...d };
    day.reps = { ...emptyDay().reps, ...(d.reps || {}) };
    s.days[k] = day;
  }
  s.walks = Array.isArray(raw.walks) ? raw.walks.filter((w) => isValidKey(w?.date)) : [];
  s.waist = Array.isArray(raw.waist) ? raw.waist.filter((w) => isValidKey(w?.date)) : [];
  s.vitality = Array.isArray(raw.vitality) ? raw.vitality.filter((v) => isValidKey(v?.date) && v.sec > 0) : [];
  return s;
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return fresh();
  }
}

let state = load();
const listeners = new Set();

export const getState = () => state;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save', err);
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Mutate state, persist, re-render.
export function update(fn) {
  fn(state);
  save();
  for (const l of listeners) l(state);
}

export const todayKey = () => dayKeyAt(Date.now());

export function dayRecord(key = todayKey()) {
  if (!state.days[key]) state.days[key] = emptyDay();
  return state.days[key];
}

// Read without creating.
export const peekDay = (key) => state.days[key] || null;

export function exportJson() {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.settings) throw new Error('Not a Track backup file');
  const next = normalize(parsed);
  next.notify = state.notify; // keep this device's notification wiring
  next.uid = state.uid;
  update((s) => Object.assign(s, next));
}

export function resetAll() {
  const keep = { uid: state.uid };
  state = { ...fresh(), ...keep };
  save();
  for (const l of listeners) l(state);
}
