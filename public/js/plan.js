// Pure plan logic shared by the browser app and the push functions in /api.
// No DOM or storage access in this module.

export const PROGRAM_DAYS = 90;
export const DAY_ROLLOVER_HOUR = 4; // a "day" runs 04:00 → 03:59 so late nights count as the same day
export const MORNING_LOCK_MIN = 90;
export const GAP_MIN = 120;
export const BUFFER_MIN = 15;
export const BUFFER_WATER_ML = 200;
export const DINNER_BUFFER_MIN = 150;
export const WALK_MIN = 30;

export const PHASES = [
  { id: 'stabilize', name: 'Stabilize', from: 1, to: 14, rule: 'Freeze at baseline − 2' },
  { id: 'cut1', name: 'Cut 1', from: 15, to: 30, rule: 'Daily cap down 25%' },
  { id: 'cut2', name: 'Cut 2', from: 31, to: 60, rule: '50% of baseline + 2-hour gaps' },
  { id: 'final', name: 'Final Taper', from: 61, to: 90, rule: 'Weekly steps down to zero, with mouth replacements' },
];
const PRE_PHASE = { id: 'pre', name: 'Not started', from: -Infinity, to: 0, rule: 'Plan starts soon' };
const FREE_PHASE = { id: 'free', name: 'Pouch-free', from: 91, to: Infinity, rule: 'Zero pouches — protect the win' };

export const WALK_PHASES = {
  '4:1': { mode: '4:1', name: 'Vascular Rebound', weeks: 'Weeks 1–2', note: 'Ignore distance while oxygen flow recovers. Just own the 30:00.' },
  '3:2': { mode: '3:2', name: 'Pace Compression', weeks: 'Weeks 3–4', note: 'Add +100–150 m to your 30-min distance every 3 sessions.' },
  continuous: { mode: 'continuous', name: 'Peak 30-Min Mileage', weeks: 'Weeks 5+', note: 'Continuous high-tempo walk/run. Chase your distance PB.' },
};

export const pad = (n) => String(n).padStart(2, '0');

// ---- date keys (YYYY-MM-DD), calendar math done in UTC to dodge DST ----

export function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function keyToUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key, n) {
  const d = new Date(keyToUTC(key) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function diffDays(fromKey, toKey_) {
  return Math.round((keyToUTC(toKey_) - keyToUTC(fromKey)) / 86400000);
}

export function weekday(key) {
  return new Date(keyToUTC(key)).getUTCDay();
}

export function isValidKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(keyToUTC(key));
}

// Wall-clock parts of a timestamp in an IANA zone (or the runtime's local zone when tz is falsy).
export function zonedParts(ts, tz) {
  if (!tz) {
    const d = new Date(ts);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mm: d.getMinutes(), wd: d.getDay() };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: +get('year'), m: +get('month'), d: +get('day'), hh: +get('hour') % 24, mm: +get('minute'), wd };
}

// The tracking day a timestamp belongs to, honouring the 04:00 rollover.
export function dayKeyAt(ts, tz) {
  const p = zonedParts(ts - DAY_ROLLOVER_HOUR * 3600000, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// Epoch ms for a wall-clock "HH:MM" on a tracking day (local zone). Times before the
// rollover hour belong to the following calendar date.
export function tsForDayTime(key, time) {
  const [y, m, d] = key.split('-').map(Number);
  const mins = timeToMin(time);
  const date = new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60, 0, 0);
  if (mins < DAY_ROLLOVER_HOUR * 60) date.setDate(date.getDate() + 1);
  return date.getTime();
}

// ---- clock strings ----

export function isValidTime(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function shiftTime(t, deltaMin) {
  return minToTime(timeToMin(t) + deltaMin);
}

export function dinnerCutoff(sleepTime) {
  return shiftTime(sleepTime, -DINNER_BUFFER_MIN);
}

// ---- 90-day taper ----

export function programDay(startDate, key) {
  return diffDays(startDate, key) + 1;
}

export function phaseFor(day) {
  if (day < 1) return PRE_PHASE;
  return PHASES.find((p) => day >= p.from && day <= p.to) || FREE_PHASE;
}

// Cap for each block. Every cut is at least one pouch lower than the previous
// block (until zero) so small baselines still taper. The final taper (days
// 61–84) steps down weekly by at most ~40% to 2 → 1, so high baselines don't
// face a cliff; day 85 onwards is zero.
export const ZERO_DAY = 85;

export function capSchedule(baseline) {
  const b = Math.max(0, Math.round(Number(baseline) || 0));
  const stabilize = b > 2 ? b - 2 : b;
  const cut1 = Math.max(0, Math.min(Math.floor(b * 0.75), stabilize - 1));
  const cut2 = Math.max(0, Math.min(Math.floor(b * 0.5), cut1 - 1));
  const steps = [];
  let x = cut2;
  while (x > 2) {
    x = Math.min(x - 1, Math.max(2, Math.round(x * 0.6)));
    if (x > 2) steps.push(x);
  }
  for (const v of [Math.min(2, cut2), Math.min(1, cut2)]) {
    if (v > 0 && v !== steps[steps.length - 1]) steps.push(v);
  }
  const span = (ZERO_DAY - 61) / (steps.length || 1);
  const final = steps.map((cap, i) => ({ from: 61 + Math.round(i * span), to: 60 + Math.round((i + 1) * span), cap }));
  return { baseline: b, stabilize, cut1, cut2, final };
}

export function capSteps(baseline) {
  const s = capSchedule(baseline);
  return [s.stabilize, s.cut1, s.cut2, ...s.final.map((f) => f.cap), 0];
}

export function dailyCap(baseline, day) {
  const s = capSchedule(baseline);
  if (day < 1) return s.baseline;
  if (day <= 14) return s.stabilize;
  if (day <= 30) return s.cut1;
  if (day <= 60) return s.cut2;
  return s.final.find((f) => day >= f.from && day <= f.to)?.cap ?? 0;
}

export function gapRuleActive(day) {
  return day >= 31;
}

// ---- movement ----

export function walkModeFor(day) {
  if (day <= 14) return '4:1';
  if (day <= 28) return '3:2';
  return 'continuous';
}

export function walkSegments(mode) {
  if (mode === 'continuous') return [{ kind: 'fast', label: 'High-tempo walk / run', min: WALK_MIN }];
  const [easy, fast] = mode === '3:2' ? [3, 2] : [4, 1];
  const easyLabel = mode === '3:2' ? 'Brisk walk' : 'Comfortable walk';
  const fastLabel = mode === '3:2' ? 'Jog / fast stride' : 'Power-walk / jog';
  const segs = [];
  for (let r = 1; r <= 6; r++) {
    segs.push({ kind: 'easy', label: easyLabel, min: easy, round: r });
    segs.push({ kind: 'fast', label: fastLabel, min: fast, round: r });
  }
  return segs;
}

export function paceText(durationMin, distanceKm) {
  if (!(distanceKm > 0) || !(durationMin > 0)) return '—';
  const secPerKm = Math.round((durationMin * 60) / distanceKm);
  return `${Math.floor(secPerKm / 60)}:${pad(secPerKm % 60)} /km`;
}

// Next block target: best of the last three sessions plus 100–150 m.
export function distanceTarget(walks) {
  const recent = walks.slice(-3).map((w) => w.distanceKm).filter((d) => d > 0);
  if (!recent.length) return null;
  const best = Math.max(...recent);
  return { from: best, low: +(best + 0.1).toFixed(2), high: +(best + 0.15).toFixed(2) };
}

export function circuitRounds(day) {
  return day <= 30 ? 3 : 4;
}

export const MICRO_SET = { pushups: 10, squats: 15, plankSec: 30 };

export const CIRCUIT_ROUND = { pushups: 12, squats: 20, hangSec: 30, plankSec: 45, core: 12 };

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
