// Tansen taper engine: pacing windows, triggers and taper progress.
import { GAP_MIN, addDays, tsForDayTime } from './plan.js';
import { gapEnd, lastPouchEnd, morningLockEnd, planFor } from './logic.js';
import { getState, peekDay, todayKey } from './store.js';

const MIN = 60000;
export const LAST_CALL_MIN = 60; // no pouch in the last hour before bed
export const MIN_SPACING_MIN = 30; // never plan pouches closer than this

// What sets off an urge, and a counter-move for each.
export const TRIGGERS = [
  { id: 'meal', emoji: '🍛', label: 'After a meal', tip: 'Straight after eating, brush or rinse, then chew elaichi. A clean mouth breaks the after-food link.' },
  { id: 'chai', emoji: '☕', label: 'Tea / coffee', tip: 'Have roasted saunf with your chai instead, and change where you drink it so the cue changes too.' },
  { id: 'stress', emoji: '😤', label: 'Stress', tip: 'Breathe in 4, hold 4, out 4, hold 4 for one minute, then walk for 2 minutes. Stress urges spike fast and fade fast.' },
  { id: 'bored', emoji: '🥱', label: 'Boredom', tip: 'Keep your hands busy: 10 squats, a quick task, or message someone. Boredom urges die when you move.' },
  { id: 'work', emoji: '💼', label: 'Work break', tip: 'Take the break without the pouch: water and a stretch by a window. Keep pouches out of your desk and bag.' },
  { id: 'social', emoji: '👥', label: 'With friends', tip: 'Tell one friend you are quitting. Hold a glass of water or chew gum while others use.' },
  { id: 'travel', emoji: '🛵', label: 'Driving / travel', tip: 'Keep elaichi or saunf in the vehicle instead of pouches. A podcast fills the gap.' },
  { id: 'tired', emoji: '😴', label: 'Tired / low energy', tip: 'Low energy feels like a craving. Drink 300 ml of water, eat a clean snack, and get 5 minutes of daylight.' },
  { id: 'habit', emoji: '🔁', label: 'Just habit', tip: 'Automatic pouches are the easiest to drop. Always run the 15-minute buffer and most of these urges vanish.' },
];
export const triggerById = (id) => TRIGGERS.find((t) => t.id === id) || null;

// 45 → "45 min", 125 → "2 h 05 m", 480 → "8 h"
export const fmtGap = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')} m` : ''}`);

// Quick things to do instead, shown in the urge buffer and on the Taper tab.
export const SOS = [
  { emoji: '🌿', text: 'Chew 1–2 elaichi pods slowly' },
  { emoji: '🪥', text: 'Brush your teeth or rinse with mouthwash' },
  { emoji: '💧', text: 'Drink a full glass of cold water' },
  { emoji: '🚶', text: 'Walk for 2 minutes, even indoors' },
  { emoji: '🫁', text: 'Breathe out slowly, longer than you breathe in' },
  { emoji: '🏋️', text: 'Do 10 squats or 10 push-ups' },
  { emoji: '📱', text: 'Message someone you trust' },
  { emoji: '🍋', text: 'Nimbu pani or chaas instead' },
];

// What to expect while cutting nicotine. General guidance, not medical advice.
export const WITHDRAWAL = [
  { from: 1, to: 3, title: 'Days 1–3: cravings at their loudest', text: 'Irritability and restlessness are common. Every urge you ride out makes the next one weaker.' },
  { from: 4, to: 14, title: 'Week 1–2: fog and low energy', text: 'Poor focus, tiredness and appetite changes are normal as your brain adjusts. Water, sleep and walks help most.' },
  { from: 15, to: 30, title: 'Weeks 3–4: urges get shorter', text: 'Cravings come less often and pass faster. Watch for trigger moments: meals, chai, stress.' },
  { from: 31, to: 60, title: 'Month 2: new habits settle', text: 'Most physical withdrawal has eased. The 2-hour gap rule trains your brain to wait.' },
  { from: 61, to: 90, title: 'Month 3: the last few pouches', text: 'The final pouches are mostly ritual. Replace each one with elaichi, saunf or a walk.' },
];

export function lastCallTs(key) {
  return tsForDayTime(key, getState().settings.sleepTime) - LAST_CALL_MIN * MIN;
}

// When the next pouch fits the plan: spread what's left of the cap evenly from
// when the last one came out until an hour before bed, never inside the morning
// lock or the gap rule.
export function nextWindow(key, rec, now = Date.now()) {
  const plan = planFor(key);
  const used = rec?.pouches?.length || 0;
  const remaining = Math.max(0, plan.cap - used);
  const lockEnd = morningLockEnd(key, rec);
  const lastCall = lastCallTs(key);
  if (remaining === 0) return { remaining, next: null, reason: 'cap', lastCall };
  const last = used ? lastPouchEnd(rec) : null; // pacing counts from when the last pouch came out
  const from = last ?? lockEnd;
  // From the last pouch: `remaining` gaps. From the lock: the first pouch sits at lockEnd, so one fewer.
  const gaps = used ? remaining : Math.max(1, remaining - 1);
  let spacingMin = Math.max(MIN_SPACING_MIN, Math.round((lastCall - from) / MIN / gaps));
  if (plan.gapRule) spacingMin = Math.max(spacingMin, GAP_MIN);
  let next = used ? last + spacingMin * MIN : lockEnd;
  next = Math.max(next, lockEnd, gapEnd(key, rec) || 0);
  if (next > lastCall) return { remaining, next: null, reason: 'bedtime', lastCall, spacingMin };
  return { remaining, next, spacingMin, open: now >= next, reason: now < lockEnd ? 'lock' : 'pace', lastCall };
}

// Latest pouch across all days (for "time pouch-free").
export function lastPouchEver() {
  let latest = null;
  for (const d of Object.values(getState().days)) {
    for (const p of d.pouches) if (!latest || p.ts > latest) latest = p.ts;
  }
  return latest;
}

// Hours since the last pouch, but only while every day in between has some log,
// so a day you forgot to log doesn't count as pouch-free.
export function pouchFreeHours(now = Date.now()) {
  let last = null;
  let lastKey = null;
  for (const [k, d] of Object.entries(getState().days)) {
    for (const p of d.pouches) if (!last || p.ts > last) { last = p.ts; lastKey = k; }
  }
  if (!last) return null;
  const today = todayKey();
  for (let k = addDays(lastKey, 1); k < today; k = addDays(k, 1)) if (!peekDay(k)) return null;
  return { since: last, hours: (now - last) / 3600000 };
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// Completed days only (yesterday backwards).
function completedDays(n, offset = 0) {
  const today = todayKey();
  const out = [];
  for (let i = 1 + offset; i <= n + offset; i++) {
    const k = addDays(today, -i);
    const d = peekDay(k);
    if (d && k >= getState().settings.startDate) out.push([k, d]);
  }
  return out;
}

export function taperProgress() {
  const s = getState().settings;
  const week = completedDays(7).map(([, d]) => d.pouches.length);
  const prev = completedDays(7, 7).map(([, d]) => d.pouches.length);
  const weekAvg = avg(week);
  const prevAvg = avg(prev);
  let capStreak = 0;
  for (let i = 1; i <= 365; i++) {
    const k = addDays(todayKey(), -i);
    const d = peekDay(k);
    if (!d || k < s.startDate || d.pouches.length > planFor(k).cap) break;
    capStreak++;
  }
  return {
    weekAvg,
    prevAvg,
    weekChange: weekAvg != null && prevAvg ? (weekAvg - prevAvg) / prevAvg : null,
    reduction: weekAvg != null && s.baseline ? 1 - weekAvg / s.baseline : null,
    capStreak,
    days: week.length,
  };
}

// Trigger counts from pouches and beaten urges over the last n days (incl. today).
export function triggerStats(n = 14) {
  const counts = {};
  const today = todayKey();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const d = peekDay(addDays(today, -i));
    if (!d) continue;
    for (const p of d.pouches) if (p.trigger) { counts[p.trigger] = (counts[p.trigger] || { pouches: 0, beaten: 0 }); counts[p.trigger].pouches++; total++; }
    for (const u of d.urges || []) if (u.trigger) { counts[u.trigger] = (counts[u.trigger] || { pouches: 0, beaten: 0 }); counts[u.trigger].beaten++; total++; }
  }
  const list = Object.entries(counts)
    .map(([id, c]) => ({ ...triggerById(id), ...c, total: c.pouches + c.beaten, share: (c.pouches + c.beaten) / total }))
    .filter((t) => t.id)
    .sort((a, b) => b.total - a.total);
  return { total, list };
}

export function withdrawalFor(day) {
  return WITHDRAWAL.find((w) => day >= w.from && day <= w.to) || null;
}
