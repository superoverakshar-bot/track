// Derived numbers: today's plan, rule checks, checklist, streaks and stats.
import {
  BUFFER_MIN, GAP_MIN, MICRO_SET, MORNING_LOCK_MIN, PROGRAM_DAYS, addDays, circuitRounds, dailyCap,
  diffDays, dinnerCutoff, gapRuleActive, phaseFor, programDay, tsForDayTime, walkModeFor, weekday,
} from './plan.js';
import { getState, peekDay, todayKey } from './store.js';

const MIN = 60000;

export function planFor(key = todayKey()) {
  const s = getState().settings;
  const day = programDay(s.startDate, key);
  const wd = weekday(key);
  return {
    key,
    day,
    phase: phaseFor(day),
    cap: dailyCap(s.baseline, day),
    gapRule: gapRuleActive(day),
    walkMode: walkModeFor(day),
    rounds: circuitRounds(day),
    isCircuitDay: s.circuitDays.includes(wd),
    isAlcoholDay: s.alcoholDays.includes(wd),
    isWaistDay: s.waistDays.includes(wd),
    inProgram: day >= 1 && day <= PROGRAM_DAYS,
  };
}

export function wakeTs(key, rec) {
  return rec?.wakeAt || tsForDayTime(key, getState().settings.wakeTime);
}

export const morningLockEnd = (key, rec) => wakeTs(key, rec) + MORNING_LOCK_MIN * MIN;

export function lastPouch(rec) {
  return rec?.pouches?.length ? rec.pouches[rec.pouches.length - 1].ts : null;
}

// When a pouch came out: your "Done" tap, or start + your usual time with one in.
export function pouchEnd(p) {
  return p.endTs ?? p.ts + (getState().settings.pouchMin || 20) * MIN;
}

export function lastPouchEnd(rec) {
  return rec?.pouches?.length ? Math.max(...rec.pouches.map(pouchEnd)) : null;
}

// The pouch you have in right now, if any.
export function pouchIn(rec, now = Date.now()) {
  const p = rec?.pouches?.length ? rec.pouches[rec.pouches.length - 1] : null;
  return p && !p.endTs && now < pouchEnd(p) ? p : null;
}

// Gaps count from when the last pouch came out, not when it went in.
export function gapEnd(key, rec) {
  const last = lastPouchEnd(rec);
  return planFor(key).gapRule && last ? last + GAP_MIN * MIN : null;
}

export function cutoffTs(key) {
  return tsForDayTime(key, dinnerCutoff(getState().settings.sleepTime));
}

export const FLAG_TEXT = {
  morning: 'Inside the 90-min morning lock',
  gap: 'Less than 2 hours since the last pouch came out',
  cap: "Over today's cap",
  nobuffer: 'Skipped the 15-min urge buffer',
};

// Which rules a pouch logged right now would break.
export function pouchFlags(key, rec, now, buffered) {
  const flags = [];
  const plan = planFor(key);
  if (now < morningLockEnd(key, rec)) flags.push('morning');
  const g = gapEnd(key, rec);
  if (g && now < g) flags.push('gap');
  if ((rec?.pouches?.length || 0) >= plan.cap) flags.push('cap');
  if (!buffered) flags.push('nobuffer');
  return flags;
}

export function cravingState(now = Date.now()) {
  const c = getState().craving;
  if (!c) return null;
  return { ...c, done: now >= c.endsAt, left: c.endsAt - now };
}

export const bufferEnds = (startedAt) => startedAt + BUFFER_MIN * MIN;

const maxOf = (arr) => (arr?.length ? Math.max(...arr) : 0);

export function microSetDone(rec) {
  if (!rec) return false;
  return rec.microManual || (rec.reps.pushups >= MICRO_SET.pushups && rec.reps.squats >= MICRO_SET.squats
    && maxOf(rec.planks) >= MICRO_SET.plankSec);
}

// The five daily non-negotiables.
export function checklist(key, rec) {
  const s = getState().settings;
  const morningBroken = !!rec?.pouches?.some((p) => p.flags.includes('morning'));
  const cutoff = dinnerCutoff(s.sleepTime);
  const dinnerLate = rec?.dinnerAt && rec.dinnerAt > cutoffTs(key);
  return [
    {
      id: 'morning', label: 'Morning 500 ml water + 90-min pouch delay',
      sub: morningBroken ? 'Pouch logged inside the lock' : (rec?.morningWater ? 'Water done — hold the lock' : 'Drink 500 ml on waking'),
      done: !!rec?.morningWater && !morningBroken, fail: morningBroken,
    },
    {
      id: 'microset', label: 'Morning micro-set',
      sub: `${MICRO_SET.pushups}+ push-ups · ${MICRO_SET.squats}+ squats · ${MICRO_SET.plankSec}s+ plank`,
      done: microSetDone(rec),
    },
    {
      id: 'protein', label: '1 bowl sprouts + 100 g paneer/protein',
      sub: [rec?.sprouts ? 'Sprouts ✓' : 'Sprouts', rec?.protein ? 'Protein ✓' : 'Protein'].join(' · '),
      done: !!(rec?.sprouts && rec?.protein),
    },
    { id: 'snack', label: '4:00 PM clean energy snack', sub: 'Roasted chana, soaked nuts or chaas', done: !!rec?.snack },
    {
      id: 'dinner', label: 'Dinner 2.5 h before bed',
      sub: rec?.dinnerAt ? (dinnerLate ? `Finished after the ${cutoff} cutoff` : `Finished before ${cutoff} ✓`) : `Kitchen closes at ${cutoff}`,
      done: !!rec?.dinnerAt && !dinnerLate, fail: !!dinnerLate,
    },
  ];
}

export function scoreFor(key) {
  const rec = peekDay(key);
  if (!rec) return 0;
  return checklist(key, rec).filter((c) => c.done).length;
}

export function streak() {
  const today = todayKey();
  let key = scoreFor(today) === 5 ? today : addDays(today, -1);
  let current = 0;
  while (scoreFor(key) === 5) {
    current++;
    key = addDays(key, -1);
  }
  let best = 0;
  let run = 0;
  const keys = Object.keys(getState().days).sort();
  let prev = null;
  for (const k of keys) {
    const full = scoreFor(k) === 5;
    run = full ? (prev && diffDays(prev, k) === 1 && run ? run + 1 : 1) : 0;
    best = Math.max(best, run);
    prev = k;
  }
  return { current, best: Math.max(best, current) };
}

export function rangeKeys(fromKey, toKey_) {
  const n = diffDays(fromKey, toKey_);
  const out = [];
  for (let i = 0; i <= n; i++) out.push(addDays(fromKey, i));
  return out;
}

// Program days that have already happened (start → min(today, day 90)).
export function programKeysSoFar() {
  const s = getState().settings;
  const today = todayKey();
  const end = addDays(s.startDate, PROGRAM_DAYS - 1);
  const last = today < end ? today : end;
  if (last < s.startDate) return [];
  return rangeKeys(s.startDate, last);
}

export function stats() {
  const st = getState();
  const keys = programKeysSoFar();
  let saved = 0;
  let underCap = 0;
  let lockKept = 0;
  let logged = 0;
  let zeroAlcohol = 0;
  for (const k of keys) {
    const d = peekDay(k);
    if (!d) continue;
    logged++;
    saved += d.saved;
    if (d.pouches.length <= planFor(k).cap) underCap++;
    if (!d.pouches.some((p) => p.flags.includes('morning'))) lockKept++;
    if (!d.drinks) zeroAlcohol++;
  }
  const walks = st.walks.slice().sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  const best = walks.reduce((m, w) => (w.distanceKm > (m?.distanceKm || 0) ? w : m), null);
  const allPlanks = Object.values(st.days).flatMap((d) => d.planks);
  const waist = st.waist.slice().sort((a, b) => a.date.localeCompare(b.date));
  return {
    loggedDays: logged,
    saved,
    underCap,
    lockKept,
    zeroAlcohol,
    bestWalk: best,
    walks,
    plankBest: maxOf(allPlanks),
    waistFirst: waist[0] || null,
    waistLast: waist[waist.length - 1] || null,
    waist,
  };
}

export function totalReps(rec) {
  if (!rec) return 0;
  const r = rec.reps;
  return r.pushups + r.squats + r.pullups + r.core;
}
