// Smart coach: turns what you've logged into specific next actions.
// Pure rules over local data — instant, private and offline. The optional AI
// coach (/api/coach) builds on the same summary.
import {
  GAP_MIN, MORNING_LOCK_MIN, PROGRAM_DAYS, WALK_PHASES, ZERO_DAY, addDays, dailyCap, dayKeyAt, diffDays, dinnerCutoff, pad,
  timeToMin, tsForDayTime,
} from './plan.js';
import { checklist, cutoffTs, microSetDone, morningLockEnd, planFor, streak, totalReps, wakeTs } from './logic.js';
import { TUNABLE, formatTunable, resolveReminders, tunableValues } from './reminders.js';
import { emptyDay, getState, peekDay, todayKey } from './store.js';
import { fmtGap, nextWindow, triggerStats } from './taper.js';

const MIN = 60000;
const HOUR = 3600000;
export const KEGEL_SETS = 3;

export const FOCUS_AREAS = [
  { id: 'quit', label: 'Quit Tansen' },
  { id: 'energy', label: 'Energy' },
  { id: 'focus', label: 'Memory & focus' },
  { id: 'stamina', label: 'Bedroom stamina' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'waist', label: 'Waist / fat loss' },
];

export const STAMINA_CHOICES = [
  { sec: 20, label: '< 30 s' },
  { sec: 45, label: '30–60 s' },
  { sec: 90, label: '1–2 min' },
  { sec: 210, label: '2–5 min' },
  { sec: 420, label: '5+ min' },
];

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const firstTs = (d) => Math.min(...d.pouches.map((p) => p.ts));
const lastTs = (d) => Math.max(...d.pouches.map((p) => p.ts));
const fmt1 = (v) => String(Math.round(v * 10) / 10);
const hhmm = (min) => `${pad(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad((((min % 1440) + 1440) % 1440) % 60)}`;
const clock = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const litres = (ml) => (ml / 1000).toFixed(1);

export function fmtDur(sec) {
  if (sec == null) return '—';
  return sec < 90 ? `${Math.round(sec)} s` : `${fmt1(sec / 60)} min`;
}

// Previous n tracking days that have a record, most recent first.
function history(n) {
  const today = todayKey();
  const out = [];
  for (let i = 1; i <= n; i++) {
    const k = addDays(today, -i);
    const d = peekDay(k);
    if (d) out.push([k, d]);
  }
  return out;
}

// Event kinds whose first time each day says when you usually do that thing.
const EVENT_TIMES = ['water', 'morningWater', 'microset', 'reps', 'sprouts', 'protein', 'snack', 'booster', 'walk_start', 'circuit', 'urge', 'checkin', 'hold', 'kegel'];

// When you actually do things: the median time over the last n days, from your
// taps, timers and logs. Counted from 04:00 so a 00:30 night stays after 23:00.
export function typicalTimes({ includePrivate = false, n = 14 } = {}) {
  const st = getState();
  const today = todayKey();
  const per = {};
  const add = (kind, k, ts) => { (per[kind] ||= []).push((ts - tsForDayTime(k, '04:00')) / MIN); };
  const opensByDay = {};
  for (const ts of st.opens) (opensByDay[dayKeyAt(ts)] ||= []).push(ts);
  const walksByDay = {};
  for (const w of st.walks) if (w.ts) (walksByDay[w.date] ||= []).push(w);
  for (let i = 0; i < n; i++) {
    const k = addDays(today, -i);
    const d = peekDay(k);
    const opens = opensByDay[k] || [];
    if (!d && !opens.length) continue;
    const first = {};
    for (const [ts, kind] of d?.events || []) if (!first[kind] || ts < first[kind]) first[kind] = ts;
    for (const [kind, ts] of Object.entries(first)) if (EVENT_TIMES.includes(kind) && (includePrivate || kind !== 'kegel')) add(kind, k, ts);
    if (!first.walk_start && walksByDay[k]) add('walk_start', k, walksByDay[k][0].ts - walksByDay[k][0].durationMin * MIN);
    if (d?.wakeAt) add('wake_tap', k, d.wakeAt);
    if (opens.length) add('first_open', k, Math.min(...opens));
    const all = [...opens, ...(d?.events || []).map((e) => e[0]), ...(d?.pouches || []).map((p) => p.ts)];
    if (i > 0 && all.length) add('last_activity', k, Math.max(...all)); // finished days only
    if (d?.pouches.length) { add('first_pouch', k, firstTs(d)); add('last_pouch', k, lastTs(d)); }
    if (d?.dinnerAt) add('dinner', k, d.dinnerAt);
  }
  const out = {};
  for (const [kind, mins] of Object.entries(per)) {
    if (mins.length < 2) continue;
    const s = mins.sort((a, b) => a - b);
    const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    out[kind] = { time: hhmm(Math.round(mid) + 240), days: s.length };
  }
  return out;
}

function walkKm(key) {
  const w = getState().walks.filter((x) => x.date === key);
  return w.length ? Math.max(...w.map((x) => x.distanceKm)) : null;
}

// Mean of a metric on days where test() holds vs. days it doesn't (3+ days each side).
function split(days, test, metric) {
  const yes = [];
  const no = [];
  for (const [k, d] of days) {
    const m = metric(k, d);
    if (m == null) continue;
    (test(k, d) ? yes : no).push(m);
  }
  if (yes.length < 3 || no.length < 3) return null;
  return { yes: avg(yes), no: avg(no) };
}

export function cravingHours(days = 14) {
  const hist = Array(24).fill(0);
  const today = todayKey();
  for (let i = 0; i < days; i++) {
    peekDay(addDays(today, -i))?.pouches.forEach((p) => { hist[new Date(p.ts).getHours()] += 1; });
  }
  return hist;
}

export function peakWindow(hist) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total < 8) return null;
  let best = 0;
  let start = 0;
  for (let h = 0; h < 24; h++) {
    const c = hist[h] + hist[(h + 1) % 24];
    if (c > best) { best = c; start = h; }
  }
  return { start, end: (start + 2) % 24, share: best / total, label: `${hhmm(start * 60)}–${hhmm(((start + 2) % 24) * 60)}` };
}

const DRIVERS = [
  { label: 'slept 7+ hours', short: '7+ h sleep', test: (k, d) => (d.checkin?.sleepHrs ?? 0) >= 7 },
  { label: 'hit your water target', short: 'full water target', test: (k, d) => d.waterMl >= getState().settings.waterTargetL * 1000 },
  { label: 'did the 30-min walk', short: 'the 30-min walk', test: (k) => walkKm(k) != null },
  { label: 'stayed under the pouch cap', short: 'staying under cap', test: (k, d) => d.pouches.length <= planFor(k).cap },
  { label: 'had the 4 PM shield', short: 'the 4 PM shield', test: (k, d) => d.snack },
  { label: 'ate sprouts + protein', short: 'sprouts + protein', test: (k, d) => d.sprouts && d.protein },
];

// Pouches avoided vs. the old baseline across logged program days.
export function avoidedPouches() {
  const s = getState().settings;
  const today = todayKey();
  let n = 0;
  for (const [k, d] of Object.entries(getState().days)) {
    if (k >= s.startDate && k <= today) n += Math.max(0, s.baseline - d.pouches.length);
  }
  return n;
}

export function coach(now = Date.now(), { notifyMode = 'off' } = {}) {
  const st = getState();
  const s = st.settings;
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const plan = planFor(key);
  const focus = new Set(s.focusAreas);
  const d0 = new Date(now);
  const hour = d0.getHours() + d0.getMinutes() / 60;
  const days14 = history(14);
  const days7 = days14.slice(0, 7);
  const wake = wakeTs(key, rec);
  const lockEnd = morningLockEnd(key, rec);
  const bed = tsForDayTime(key, s.sleepTime);
  const used = rec.pouches.length;
  const suggestions = [];
  const patterns = [];
  const wins = [];
  const add = (priority, id, pillar, title, body, action = null, extra = {}) => suggestions.push({ priority, id, pillar, title, body, action, ...extra });

  // ---- memory: let the app carry the to-do list ----
  if (notifyMode === 'off') {
    add(focus.has('focus') ? 94 : 70, 'notify', 'general', 'Let the app remember for you',
      'Turn on reminders: water, the 4 PM shield, kitchen cutoff, craving timer and check-ins arrive on their own, so nothing depends on memory.',
      { label: 'Turn on', action: 'nav', data: { to: '#settings' } });
  }
  if (!rec.checkin && now > wake) {
    add(hour < 12 ? 80 : 68, 'checkin', 'general', 'Rate today: energy, focus, sleep',
      'Takes 10 seconds. After a few days the coach shows what actually lifts your energy and focus.',
      { label: 'Check in', action: 'nav', data: { to: '#coach' } });
  }

  if (plan.day < 1) {
    add(60, 'pre', 'taper', `Your 90 days start ${plan.day === 0 ? 'tomorrow' : `in ${plural(1 - plan.day, 'day')}`}`,
      'Until then, log pouches as usual. The coach learns your craving times so day 1 starts with a plan.');
  }

  // ---- morning ----
  if (!rec.wakeAt && !used && now >= wake - 2 * HOUR && now <= wake + 4 * HOUR) {
    add(88, 'wake', 'taper', 'Log your wake-up',
      `Starts the ${MORNING_LOCK_MIN}-minute oxygen window. 500 ml water before anything else.`, { label: "I'm awake", action: 'wake' });
  }
  if (!rec.morningWater && hour < 11 && now > wake) {
    add(76, 'morning-water', 'fuel', 'Drink 500 ml water now', 'Before tea or coffee. It sets up energy and focus for the morning.',
      { label: 'Done', action: 'toggle', data: { field: 'morningWater' } });
  }
  if (plan.day >= 1 && now < lockEnd && now > wake - HOUR) {
    add(70, 'lock', 'taper', `Morning lock: no pouch until ${clock(lockEnd)}`,
      'Do the micro-set and get daylight. Urges in the first hour are habit, not need, and they fade.');
  }
  if (!microSetDone(rec) && hour < 12 && now > wake) {
    add(58, 'microset', 'move', 'Morning micro-set (3 minutes)', '10–15 push-ups, 15–20 squats, a 30–45 s plank before your shower. It wakes you up better than a pouch.',
      { label: 'Log reps', action: 'nav', data: { to: '#move' } });
  }

  // ---- taper: today's pace ----
  if (plan.day >= 1 && now > lockEnd && now < bed) {
    const left = plan.cap - used;
    if (left <= 0) {
      add(90, 'cap', 'taper', used > plan.cap ? `Over cap by ${used - plan.cap}. Reset now` : 'Cap reached for today',
        'Every urge from here: start the 15-minute buffer, drink 200 ml, chew elaichi or saunf. Each one you beat counts as a saved pouch.',
        { label: 'Start buffer', action: 'craving-start' });
    } else {
      const expected = plan.cap * clamp01((now - lockEnd) / (bed - lockEnd));
      if (used > expected + 1.5) {
        const w = nextWindow(key, rec, now);
        const when = w.next
          ? `The next one fits at ${clock(w.next)}${left > 1 ? `, then at most one every ${fmtGap(w.spacingMin)}` : ''}.`
          : `Last call was ${clock(w.lastCall)}.`;
        add(84, 'pace', 'taper', `Ahead of pace: ${used} of ${plan.cap} by ${clock(now)}`,
          `${left} ${left === 1 ? 'pouch' : 'pouches'} left for today. ${when} Next urge, buffer first.`,
          { label: 'Start buffer', action: 'craving-start' });
      } else if (used > 0 && used + 1 < expected) {
        wins.push(`Under pace: ${used} of ${plan.cap} by ${clock(now)}`);
      }
    }
  }

  // ---- taper: patterns from history ----
  const peak = peakWindow(cravingHours(14));
  if (peak) {
    patterns.push({ id: 'peak', pillar: 'taper', text: `${Math.round(peak.share * 100)}% of your pouches in the last 2 weeks landed in the ${peak.label} window.` });
    const start = new Date(now);
    start.setHours(peak.start, 0, 0, 0);
    const until = (start.getTime() - now) / MIN;
    if (plan.day >= 1 && until > -60 && until <= 90) {
      add(79, 'peak', 'taper', `Craving peak ${until > 0 ? `in ${Math.round(until)} min` : 'now'} (${peak.label})`,
        'Get ahead of it: 300 ml water, a clean snack, elaichi in your pocket. When the urge hits, start the buffer before reaching for a pouch.',
        { label: 'Start buffer', action: 'craving-start' });
    }
  }

  const p7 = days7.flatMap(([, d]) => d.pouches);
  const saved7 = days7.reduce((a, [, d]) => a + d.saved, 0);
  if (p7.length >= 5) {
    const skipped = p7.filter((p) => p.flags.includes('nobuffer')).length;
    const buffered = p7.length - skipped;
    if (saved7 + buffered >= 3) {
      patterns.push({ id: 'buffer', pillar: 'taper', text: `When you ran the 15-minute buffer, ${Math.round((saved7 / (saved7 + buffered)) * 100)}% of urges passed (${saved7} of ${saved7 + buffered}).` });
    }
    if (skipped / p7.length >= 0.5) {
      add(66, 'buffer', 'taper', `${Math.round((skipped / p7.length) * 100)}% of pouches skipped the buffer this week`,
        saved7 ? `The buffer works for you: ${saved7} urges passed this week when you used it. Make it automatic: urge, then buffer, then water.`
          : 'Urges peak and fade within 10–15 minutes. Run the buffer before every pouch this week and watch the saved count grow.',
        { label: 'Start buffer', action: 'craving-start' });
    }
  }

  const delays = days7.map(([k, d]) => (d.pouches.length ? (firstTs(d) - wakeTs(k, d)) / MIN : null)).filter((v) => v != null);
  if (delays.length >= 3) {
    const a = Math.round(avg(delays));
    patterns.push({ id: 'first', pillar: 'taper', text: `Your first pouch comes about ${a} min after waking (7-day average).` });
    if (a < MORNING_LOCK_MIN) {
      add(62, 'first', 'taper', `First pouch ~${a} min after waking`,
        'The rule is 90+. Tomorrow: 500 ml water, micro-set, walk, then decide. Every extra 15 minutes weakens the habit loop.');
    }
  }

  const over7 = days7.filter(([k, d]) => d.pouches.length > planFor(k).cap).length;
  if (over7 >= 3) {
    add(72, 'over', 'taper', `Over cap on ${over7} of the last ${days7.length} days`,
      'The cap only works if urges meet friction. Keep pouches out of your pocket (another room or the car) and buffer every urge.');
  }

  if (plan.day >= 1 && plan.day < ZERO_DAY) {
    for (let i = 1; i <= 3; i++) {
      const next = dailyCap(s.baseline, plan.day + i);
      if (next < plan.cap) {
        add(73, 'drop', 'taper', `Cap drops ${plan.cap} → ${next} in ${plural(i, 'day')}`,
          'Rehearse now: delay every pouch by 10 extra minutes and stock elaichi or saunf. Pick the pouch you will drop first (usually the one you enjoy least).');
        break;
      }
    }
  }

  if (plan.day >= 24 && plan.day <= 60) {
    const lockMin = timeToMin(s.wakeTime) + MORNING_LOCK_MIN;
    let bedMin = timeToMin(s.sleepTime);
    if (bedMin <= lockMin) bedMin += 1440;
    const fit = Math.floor((bedMin - lockMin) / GAP_MIN) + 1;
    const cap31 = dailyCap(s.baseline, 31);
    if (fit < cap31) {
      patterns.push({ id: 'gapfit', pillar: 'taper', text: `With the 2-hour gap rule (day 31+), only ${fit} pouches fit between ${hhmm(lockMin)} and ${s.sleepTime}, so your real ceiling is ${fit}, not ${cap31}.` });
    }
  }

  if (plan.day >= 1 && plan.day <= ZERO_DAY + 3) {
    const zeroDate = addDays(s.startDate, ZERO_DAY - 1);
    const left = diffDays(key, zeroDate);
    if (left > 0 && left <= 7) {
      add(68, 'zero', 'taper', `Zero day in ${plural(left, 'day')}`,
        'Plan the hardest moments now (after meals, 4–6 PM, with friends) and pick a replacement for each: elaichi, saunf, a 2-minute walk.');
    }
  }

  // ---- taper: triggers ----
  const trig = triggerStats(14);
  if (trig.total >= 5) {
    const top = trig.list[0];
    const beatRate = top.total ? top.beaten / top.total : 0;
    patterns.push({ id: 'trigger', pillar: 'taper', text: `${top.emoji} ${top.label} sets off ${Math.round(top.share * 100)}% of your urges; you beat ${Math.round(beatRate * 100)}% of those.` });
    const best = trig.list.filter((t) => t.total >= 3).sort((a, b) => b.beaten / b.total - a.beaten / a.total)[0];
    if (best && best.id !== top.id && best.beaten / best.total >= 0.5) {
      patterns.push({ id: 'trigger-best', pillar: 'taper', text: `You beat ${best.emoji} ${best.label.toLowerCase()} urges ${Math.round((best.beaten / best.total) * 100)}% of the time. Use the same moves on ${top.label.toLowerCase()}.` });
    }
    add(67, 'trigger', 'taper', `Your #1 trigger: ${top.emoji} ${top.label}`, top.tip);
  }
  const untagged = days7.slice(0, 3).flatMap(([, d]) => d.pouches).filter((p) => !p.trigger).length;
  if (untagged >= 5) {
    add(45, 'tag', 'taper', 'Tag what triggers each pouch', 'When you log a pouch or beat an urge, tap its trigger. After a few days the coach builds a plan around your top trigger.');
  }

  // ---- fuel ----
  const evening = (d) => d.pouches.filter((p) => { const h = new Date(p.ts).getHours(); return h >= 15 && h < 20; }).length;
  const snackFx = split(days14, (k, d) => d.snack, (k, d) => evening(d));
  const snackHelps = snackFx && snackFx.no - snackFx.yes >= 0.5;
  if (snackHelps) {
    patterns.push({ id: 'snack', pillar: 'fuel', text: `On 4 PM-shield days you average ${fmt1(snackFx.yes)} pouches between 15:00 and 20:00, vs ${fmt1(snackFx.no)} without it.` });
  }
  if (!rec.snack && hour >= 15 && hour < 17.5) {
    add(snackHelps ? 81 : 71, 'shield', 'fuel', '4:00 PM Energy Shield',
      snackHelps ? `Your data: ${fmt1(snackFx.no - snackFx.yes)} fewer evening pouches on shield days. Roasted chana, soaked almonds or chaas, now.`
        : 'Roasted chana, soaked almonds/walnuts or chaas now. It blunts the 5 PM energy crash that drives cravings.',
      { label: 'Done', action: 'toggle', data: { field: 'snack' } });
  }

  const target = s.waterTargetL * 1000;
  if (now > wake && now < bed) {
    const expected = target * clamp01((now - wake) / Math.max(HOUR, bed - wake - 2 * HOUR));
    if (rec.waterMl < expected - 500) {
      add(focus.has('energy') || focus.has('focus') ? 74 : 64, 'water', 'fuel', `${litres(expected - rec.waterMl)} L behind on water`,
        `You're at ${litres(rec.waterMl)} L. Even mild dehydration dulls focus and energy, so drink 500 ml now.`,
        { label: '+500 ml', action: 'water-add', data: { ml: 500 } });
    }
  }

  const cut = cutoffTs(key);
  if (!rec.dinnerAt && now >= cut - 90 * MIN && now < cut) {
    add(77, 'dinner', 'fuel', `Kitchen closes at ${clock(cut)}`,
      'Eat now: dal or paneer with vegetables, then close the kitchen. Brush and chew elaichi to mark the day as done.',
      { label: 'Dinner done', action: 'dinner-now' });
  }

  // ---- energy, focus, sleep ----
  for (const [metric, label, area] of [['energy', 'Energy', 'energy'], ['focus', 'Focus', 'focus']]) {
    const m = (k, d) => d.checkin?.[metric] ?? null;
    let best = null;
    for (const dr of DRIVERS) {
      const r = split(days14, dr.test, m);
      if (r && r.yes - r.no >= 0.5 && (!best || r.yes - r.no > best.diff)) best = { ...dr, ...r, diff: r.yes - r.no };
    }
    if (best) {
      patterns.push({ id: `driver-${metric}`, pillar: area, text: `${label} averages ${fmt1(best.yes)}/5 on days you ${best.label}, vs ${fmt1(best.no)} when you don't.` });
      if (focus.has(area)) {
        add(61, `driver-${metric}`, area, `Your ${label.toLowerCase()} lever: ${best.short}`,
          `${label} runs ${fmt1(best.diff)} points higher on days you ${best.label}. Make today one of those days.`);
      }
    }
  }

  const checks = days7.map(([, d]) => d.checkin).filter(Boolean);
  const eAvg = avg(checks.map((c) => c.energy).filter(Boolean));
  const fAvg = avg(checks.map((c) => c.focus).filter(Boolean));
  const sAvg = avg(checks.map((c) => c.sleepHrs).filter((v) => v > 0));
  if (checks.length >= 3 && sAvg != null && sAvg < 7) {
    add(focus.has('sleep') || focus.has('energy') || focus.has('focus') ? 67 : 55, 'sleep', 'sleep', `Averaging ${fmt1(sAvg)} h of sleep`,
      `7–8 h is when energy and memory recover. Tonight: kitchen closes at ${dinnerCutoff(s.sleepTime)}, no tea or coffee after 4 PM, screens down 30 min before ${s.sleepTime}.`);
  }
  if (checks.length >= 3 && ((eAvg != null && eAvg <= 2.5) || (fAvg != null && fAvg <= 2.5))) {
    add(63, 'labs', 'general', 'A week of low energy or memory: get blood tests',
      'Ask a doctor for vitamin B12, vitamin D, haemoglobin/iron and thyroid (TSH) tests. B12 deficiency is common on vegetarian diets and causes fatigue and forgetfulness.');
  }
  if (plan.day >= 1 && plan.day <= 28 && checks.length >= 2 && ((eAvg ?? 5) <= 3 || (fAvg ?? 5) <= 3)) {
    add(46, 'fog', 'focus', 'Fog is part of the first weeks',
      'Cutting nicotine often brings 2–4 weeks of brain fog and low energy. It passes as your brain adjusts. Get morning daylight, keep up the water, and let reminders carry your to-do list.');
  }
  const lateGaps = days7.map(([k, d]) => (d.pouches.length ? (tsForDayTime(k, s.sleepTime) - lastTs(d)) / MIN : null)).filter((v) => v != null);
  if (lateGaps.length >= 3 && avg(lateGaps) < 90) {
    add(focus.has('sleep') || focus.has('energy') ? 60 : 50, 'late', 'sleep', `Last pouch ~${Math.round(avg(lateGaps))} min before bed`,
      `Nicotine is a stimulant and fragments sleep. Make ${hhmm(timeToMin(s.sleepTime) - 120)} your last-pouch time, with elaichi after that.`);
  }

  // ---- movement ----
  const walkTime = tsForDayTime(key, s.walkTime);
  if (plan.day >= 1 && walkKm(key) == null && now >= walkTime - 30 * MIN && hour < 21 && !st.walkTimer) {
    const p = WALK_PHASES[plan.walkMode];
    add(65, 'walk', 'move', `30-min session · ${p.name}`,
      `${plan.walkMode === 'continuous' ? 'Continuous high tempo for 30:00' : `${plan.walkMode} intervals × 6 rounds`}. A brisk walk also cuts cravings for up to an hour.`,
      { label: 'Start timer', action: 'walk-start', data: { mode: plan.walkMode } });
  }
  const walks = st.walks.slice().sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  const walks7 = walks.filter((w) => { const d = diffDays(w.date, key); return d >= 1 && d <= 7; }).length;
  if (plan.day > 7 && walks7 < 3) {
    add(52, 'walk-few', 'move', `${plural(walks7, 'walk')} in the last 7 days`,
      'Stamina comes from frequency. Aim for 5 sessions a week at the same time, so the habit runs on autopilot.');
  }
  if (walks.length >= 6 && plan.walkMode !== '4:1') {
    const last3 = Math.max(...walks.slice(-3).map((w) => w.distanceKm));
    const prev3 = Math.max(...walks.slice(-6, -3).map((w) => w.distanceKm));
    if (last3 <= prev3) {
      add(42, 'plateau', 'move', 'Distance has plateaued',
        plan.walkMode === '3:2' ? 'Turn the last minute of each walk block into a jog. Small surges add the next 100 m.'
          : 'Add two 1-minute surges at minutes 10 and 20, then hold the faster pace a little longer each week.');
    }
  }
  const walkPouch = split(days14, (k) => walkKm(k) != null, (k, d) => d.pouches.length);
  if (walkPouch && walkPouch.no - walkPouch.yes >= 1) {
    patterns.push({ id: 'walkpouch', pillar: 'move', text: `On walk days you average ${fmt1(walkPouch.yes)} pouches, vs ${fmt1(walkPouch.no)} on rest days.` });
  }
  if (plan.isCircuitDay && rec.rounds < plan.rounds && now >= tsForDayTime(key, s.circuitTime) - HOUR && hour < 22) {
    add(57, 'circuit', 'strength', `Circuit day: ${rec.rounds} of ${plan.rounds} rounds`,
      'Push-ups, squats/lunges, pull-ups or a hang, then plank + core. About 20 minutes.', { label: 'Open', action: 'nav', data: { to: '#move' } });
  }
  if (plan.isWaistDay && !st.waist.some((w) => { const d = diffDays(w.date, key); return d >= 0 && d < 6; })) {
    add(focus.has('waist') ? 56 : 48, 'waist', 'strength', 'Weekly waist check', 'Measure at the navel, after a relaxed exhale, then log it.',
      { label: 'Log waist', action: 'nav', data: { to: '#move' } });
  }

  // ---- alcohol ----
  if (rec.drinks > rec.drinkWater) {
    add(69, 'alcohol-water', 'taper', `Water ${rec.drinkWater}:${rec.drinks}: match your drinks`, 'One glass of water per drink protects sleep, energy and your liver.',
      { label: '+1 water', action: 'drink-water' });
  }
  if (rec.drinks && !plan.isAlcoholDay) {
    add(62, 'alcohol-day', 'taper', 'Not a designated alcohol day', 'Logged honestly, which is good. Alcohol also weakens pouch control and sleep. Switch to soda with nimbu.');
  } else if (plan.isAlcoholDay && hour >= 18 && rec.drinks < s.alcoholMax) {
    add(47, 'alcohol-plan', 'taper', `Guardrail night: max ${plural(s.alcoholMax, 'drink')}`, 'Eat first, water between drinks, and decide your stop time before the first drink.');
  }

  // ---- vitality (pelvic floor + stamina) ----
  if (focus.has('stamina')) {
    if (rec.kegels < KEGEL_SETS && hour >= 9 && hour < 23) {
      add(hour >= 13 ? 64 : 53, 'kegel', 'vitality', `Pelvic-floor set ${rec.kegels + 1} of ${KEGEL_SETS}`,
        '10 slow squeezes (hold 3 s, relax 3 s), then 10 quick ones. About 2 minutes. Breathe normally and keep your glutes and thighs relaxed.',
        { label: 'Set done', action: 'kegel-add' });
    }
    const k7 = days7.map(([, d]) => d.kegels || 0);
    if (k7.length >= 4) {
      const full = k7.filter((v) => v >= KEGEL_SETS).length;
      patterns.push({ id: 'kegel', pillar: 'vitality', text: `Pelvic-floor training: all ${KEGEL_SETS} sets on ${full} of the last ${k7.length} days.`, private: true });
    }
    const logs = st.vitality.slice().sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    if (logs.length >= 4) {
      const first = avg(logs.slice(0, 3).map((v) => v.sec));
      const recent = avg(logs.slice(-3).map((v) => v.sec));
      if (logs.length >= 6) patterns.push({ id: 'stamina', pillar: 'vitality', text: `Stamina: your last 3 logs average ${fmtDur(recent)}, vs ${fmtDur(first)} at the start.`, private: true });
      const withDrink = logs.filter((v) => peekDay(v.date)?.drinks > 0).map((v) => v.sec);
      const sober = logs.filter((v) => !peekDay(v.date)?.drinks).map((v) => v.sec);
      if (withDrink.length >= 2 && sober.length >= 2 && avg(sober) > avg(withDrink) * 1.2) {
        patterns.push({ id: 'stamina-alcohol', pillar: 'vitality', text: `Stamina is longer on alcohol-free days (${fmtDur(avg(sober))} vs ${fmtDur(avg(withDrink))}).`, private: true });
      }
      if (recent < 60 && diffDays(logs[0].date, key) >= 42) {
        add(54, 'doctor', 'vitality', 'Talk to a doctor about early ejaculation',
          'It is very common and treatable. After 6+ weeks of training you are still under a minute. A urologist or sexual-health doctor can add proven treatments alongside the exercises.',
          null, { private: true });
      }
    }
  }

  // ---- evening wrap-up ----
  if (hour >= 19 && hour < 24) {
    const open = checklist(key, rec).filter((i) => !i.done && !i.fail);
    if (open.length && open.length < 5) {
      add(55, 'open', 'general', `${plural(open.length, 'non-negotiable')} left today`, open.map((i) => i.label).join(' · '));
    }
  }

  // ---- wins ----
  const sk = streak();
  if (sk.current >= 2) wins.push(`${sk.current}-day 5/5 streak`);
  if (rec.saved) wins.push(`${plural(rec.saved, 'urge')} beaten today`);
  const avoided = avoidedPouches();
  if (avoided > 0) wins.push(`${avoided} fewer pouches than your old ${s.baseline}/day so far`);
  const y = peekDay(addDays(key, -1));
  if (y && y.pouches.length <= planFor(addDays(key, -1)).cap && plan.day > 1) wins.push(`Yesterday: ${y.pouches.length} of ${planFor(addDays(key, -1)).cap}, under cap`);
  if (walks.length >= 2) {
    const last = walks[walks.length - 1];
    if (diffDays(last.date, key) <= 3 && last.distanceKm >= Math.max(...walks.map((w) => w.distanceKm))) wins.push(`Distance PB: ${last.distanceKm.toFixed(2)} km`);
  }

  // Quitting Tansen comes first.
  for (const x of suggestions) if (x.pillar === 'taper') x.priority += 6;
  suggestions.sort((a, b) => b.priority - a.priority);
  return { suggestions, patterns, wins, peak, plan };
}

// Reminder text that reflects what you've already logged. Written to Cache
// Storage so the service worker can use it for pushes too.
export function smartSnapshot(now = Date.now()) {
  const st = getState();
  const s = st.settings;
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const plan = planFor(key);
  const at = Object.fromEntries(resolveReminders(s).map((r) => [r.key, tsForDayTime(key, r.time)]));
  const wake = wakeTs(key, rec);
  const bed = tsForDayTime(key, s.sleepTime);
  const target = s.waterTargetL * 1000;
  const lines = {};

  const waterLine = (t) => {
    const expected = target * clamp01((t - wake) / Math.max(HOUR, bed - wake - 2 * HOUR));
    const gap = expected - rec.waterMl;
    return gap > 300
      ? `You're at ${litres(rec.waterMl)} L, about ${litres(gap)} L behind. Drink 500 ml now.`
      : `On track: ${litres(rec.waterMl)} L so far. Keep sipping toward ${s.waterTargetL} L.`;
  };
  lines.water1 = { body: waterLine(at.water1) };
  lines.water2 = { body: waterLine(at.water2) };

  const peak = peakWindow(cravingHours(14));
  if (rec.snack) {
    lines.shield = { title: '🛡️ Shield done ✓', body: peak ? `Your cravings usually peak ${peak.label}. Keep elaichi handy and buffer every urge.` : 'Nice. Keep water and elaichi close through the evening.' };
  } else if (peak && peak.start >= 14 && peak.start <= 19) {
    lines.shield = { body: `Your cravings peak ${peak.label}. Have roasted chana, soaked almonds or chaas now to get ahead of it.` };
  }
  if (rec.sprouts && rec.protein) lines.lunch = { title: '🥗 Sprouts + protein done ✓', body: 'Add a vascular booster today: beetroot, pomegranate, spinach or nimbu pani.' };
  if (microSetDone(rec)) lines.microset = { title: '💪 Micro-set done ✓', body: 'Already logged. Water and some daylight next.' };
  const km = walkKm(key);
  if (km != null) lines.walk = { title: '🏃 Session done ✓', body: `${km.toFixed(2)} km logged today. Stretch calves and hips for 2 minutes.` };
  if (rec.rounds >= plan.rounds) lines.circuit = { title: '🔥 Circuit done ✓', body: `${plan.rounds} rounds logged. Protein within the next hour helps recovery.` };
  else if (rec.rounds) lines.circuit = { body: `${rec.rounds} of ${plan.rounds} rounds done. Finish the rest.` };
  if (rec.dinnerAt) lines.dinner = { title: '🍽️ Dinner logged ✓', body: 'Kitchen closed. Brush and chew elaichi to mark the day as done.' };
  if (rec.kegels >= KEGEL_SETS) lines.kegel = { title: '🧘 Pelvic-floor sets done ✓', body: `All ${KEGEL_SETS} done today. Same time tomorrow.` };
  else if (rec.kegels) lines.kegel = { body: `Set ${rec.kegels + 1} of ${KEGEL_SETS}: 10 slow squeezes (3 s hold), then 10 quick ones.` };
  const done = checklist(key, rec).filter((i) => i.done).length;
  const w = nextWindow(key, rec, at.taperCheck || now);
  lines.taperCheck = {
    body: w.reason === 'cap'
      ? `${rec.pouches.length} of ${plan.cap} used: cap reached. Every urge from here gets the 15-minute buffer.`
      : `${rec.pouches.length} of ${plan.cap} used, ${w.remaining} left. At most one every ${w.spacingMin} min, last call ${clock(w.lastCall)}.${peak ? ` Your peak is ${peak.label}.` : ''}`,
  };
  lines.checkin = { body: `Today so far: ${rec.pouches.length} of ${plan.cap} pouches, ${litres(rec.waterMl)} L water, ${done}/5 non-negotiables.${rec.checkin ? '' : ' Rate your energy and focus too.'}` };

  // Tomorrow's wake-up message recaps today.
  const tomorrow = addDays(key, 1);
  const recap = `Yesterday: ${rec.pouches.length} of ${plan.cap} pouches${rec.pouches.length <= plan.cap ? ' ✓' : ''}${rec.saved ? `, ${plural(rec.saved, 'urge')} beaten` : ''}.`;
  const tCap = planFor(tomorrow).cap;
  const startOfToday = tsForDayTime(key, '04:00');
  const startOfTomorrow = tsForDayTime(tomorrow, '04:00');
  return {
    blocks: [
      { from: startOfToday, until: startOfTomorrow, lines },
      { from: startOfTomorrow, until: tsForDayTime(addDays(key, 2), '04:00'), lines: { wake: { body: `500 ml water first, no pouch for 90 min. ${recap} Today's cap: ${tCap}.` } } },
    ],
    at: now,
  };
}

export function smartLine(snapshot, key, now = Date.now()) {
  return snapshot?.blocks?.find((b) => now >= b.from && now < b.until)?.lines?.[key] || null;
}

// Compact, anonymous summary for the AI coach. Private vitality data only when allowed.
export function aiSummary({ includePrivate = false, now = Date.now() } = {}) {
  const st = getState();
  const s = st.settings;
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const plan = planFor(key);
  const result = coach(now);
  const dayRow = (k, d) => {
    const p = planFor(k);
    const row = {
      date: k,
      program_day: p.day,
      pouches: d.pouches.length,
      cap: p.cap,
      rule_breaks: d.pouches.reduce((a, x) => { x.flags.forEach((f) => { a[f] = (a[f] || 0) + 1; }); return a; }, {}),
      urges_beaten: d.saved,
      first_pouch_min_after_wake: d.pouches.length ? Math.round((firstTs(d) - wakeTs(k, d)) / MIN) : null,
      pouch_hours: d.pouches.map((x) => new Date(x.ts).getHours()),
      water_l: +(d.waterMl / 1000).toFixed(2),
      non_negotiables: checklist(k, d).filter((c) => c.done).map((c) => c.id),
      energy: d.checkin?.energy ?? null,
      focus: d.checkin?.focus ?? null,
      sleep_h: d.checkin?.sleepHrs ?? null,
      walk_km: walkKm(k),
      reps: totalReps(d),
      plank_best_s: d.planks.length ? Math.max(...d.planks) : null,
      drinks: d.drinks,
    };
    if (includePrivate) row.pelvic_floor_sets = d.kegels || 0;
    return row;
  };
  const summary = {
    local_time: `${clock(now)} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(now).getDay()]}`,
    goal: {
      quit: `Tansen (smokeless tobacco/areca) from ${s.baseline}/day to zero`,
      zero_day: addDays(s.startDate, ZERO_DAY - 1),
      focus_areas: s.focusAreas.filter((f) => includePrivate || f !== 'stamina'),
      diet: 'vegetarian (Indian)',
    },
    plan_today: {
      program_day: plan.day, of: PROGRAM_DAYS, phase: plan.phase.name, cap: plan.cap, gap_rule_2h: plan.gapRule,
      walk_mode: plan.walkMode, circuit_day: plan.isCircuitDay, alcohol_day: plan.isAlcoholDay,
    },
    schedule: { wake: s.wakeTime, bed: s.sleepTime, kitchen_closes: dinnerCutoff(s.sleepTime), walk: s.walkTime, water_target_l: s.waterTargetL },
    tunable: tunableValues(s, { includePrivate }),
    pinned: Object.entries(st.autopilot.pins).filter(([t, until]) => until > now && (includePrivate || !TUNABLE[t]?.private)).map(([t]) => t),
    typical_times: typicalTimes({ includePrivate }),
    recent_plan_changes: st.autopilot.log.filter((c) => includePrivate || !TUNABLE[c.target]?.private).slice(-6)
      .map((c) => ({ when: clock(c.at), date: dayKeyAt(c.at), target: c.target, from: formatTunable(c.target, c.from), to: formatTunable(c.target, c.to), undone_by_user: !!c.undone })),
    today: dayRow(key, rec),
    last_14_days: history(14).map(([k, d]) => dayRow(k, d)),
    walks_recent: st.walks.slice(-8).map((w) => ({ date: w.date, km: w.distanceKm, min: w.durationMin, mode: w.mode, energy: w.energy })),
    waist_in: st.waist.slice(-6).map((w) => ({ date: w.date, inches: w.inches })),
    app_patterns: result.patterns.filter((p) => includePrivate || !p.private).map((p) => p.text),
    app_wins: result.wins,
  };
  if (includePrivate) {
    summary.vitality = {
      concern: 'early ejaculation',
      stamina_logs: st.vitality.slice(-12).map((v) => ({ date: v.date, seconds: v.sec })),
    };
  }
  return summary;
}
