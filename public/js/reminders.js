// Reminder catalogue + notification copy. Shared by the app (local notifications)
// and /api/push/deliver (Web Push), so both always say the same thing.
import {
  BUFFER_MIN, GAP_MIN, MICRO_SET, WEEKDAYS, circuitRounds, dailyCap, dayKeyAt, dinnerCutoff,
  isValidTime, minToTime, phaseFor, programDay, shiftTime, timeToMin, walkModeFor, zonedParts, WALK_PHASES, PROGRAM_DAYS,
} from './plan.js';

// anchor: the time comes from a schedule setting (+ offset minutes); otherwise `time` is user-editable.
// days: a settings field holding weekday numbers (0 = Sun) that limits the reminder to those days.
export const REMINDERS = [
  { key: 'wake', label: 'Wake-up hydration + 90-min lock', anchor: 'wakeTime', offset: 0 },
  { key: 'microset', label: 'Morning micro-set', anchor: 'wakeTime', offset: 20 },
  { key: 'water1', label: 'Hydration check (late morning)', time: '11:00' },
  { key: 'lunch', label: 'Sprouts + protein before lunch', time: '12:45' },
  { key: 'taperCheck', label: 'Afternoon taper check', time: '15:30' },
  { key: 'shield', label: '4:00 PM Energy Shield', time: '16:00' },
  { key: 'water2', label: 'Hydration check (evening)', time: '18:00' },
  { key: 'kegel', label: 'Pelvic-floor set (Bedroom stamina focus)', time: '14:00', focus: 'stamina' },
  { key: 'walk', label: '30-min mileage session', anchor: 'walkTime', offset: 0 },
  { key: 'circuit', label: 'Calisthenics circuit day', anchor: 'circuitTime', offset: 0, days: 'circuitDays' },
  { key: 'alcohol', label: 'Alcohol guardrail (designated days)', time: '19:00', days: 'alcoholDays' },
  { key: 'dinner', label: 'Kitchen closing soon', anchor: 'cutoff', offset: -30 },
  { key: 'waist', label: 'Weekly waist log', time: '08:30', days: 'waistDays' },
  { key: 'checkin', label: 'Evening check-in', anchor: 'sleepTime', offset: -60 },
];

// Schedule settings the AI autopilot may move, with hard limits. Nothing here
// touches the taper itself (caps, morning lock, gap rule, buffer).
export const TUNABLE = {
  wakeTime: { label: 'Wake time', min: '04:30', max: '10:30' },
  sleepTime: { label: 'Bedtime', min: '20:30', max: '01:30' },
  walkTime: { label: '30-min session', min: '05:00', max: '21:00' },
  circuitTime: { label: 'Circuit time', min: '05:00', max: '21:30' },
  waterTargetL: { label: 'Water target', number: true, min: 2.5, max: 4 },
  'rem.water1': { label: 'Late-morning water reminder', min: '09:00', max: '13:00' },
  'rem.lunch': { label: 'Sprouts reminder', min: '11:00', max: '14:30' },
  'rem.taperCheck': { label: 'Afternoon taper check', min: '12:00', max: '19:00' },
  'rem.shield': { label: 'Energy Shield reminder', min: '15:00', max: '17:00' },
  'rem.water2': { label: 'Evening water reminder', min: '16:30', max: '20:00' },
  'rem.kegel': { label: 'Pelvic-floor reminder', min: '08:00', max: '21:00', private: true },
};
export const TUNABLE_KEYS = Object.keys(TUNABLE);
export const MAX_SHIFT_MIN = 60; // per change
export const MIN_SHIFT_MIN = 10; // smaller moves aren't worth a change
export const MAX_TWEAKS = 3; // per run

const inWindow = (m, lo, hi) => (lo <= hi ? m >= lo && m <= hi : m >= lo || m <= hi);

// Current value of a tunable setting.
export function tunableValue(settings, target) {
  if (!target.startsWith('rem.')) return settings[target];
  return resolveReminders(settings).find((r) => r.key === target.slice(4))?.time;
}

// The tunable schedule as the AI sees it.
export function tunableValues(settings, { includePrivate = false } = {}) {
  const out = {};
  for (const [target, t] of Object.entries(TUNABLE)) if (includePrivate || !t.private) out[target] = tunableValue(settings, target);
  return out;
}

export function formatTunable(target, v) {
  return TUNABLE[target]?.number ? `${v} L` : v;
}

// Check the AI's proposed tweaks against the limits. Out-of-range requests are
// refused; in-range moves are capped at MAX_SHIFT_MIN (0.5 L for water) per run.
// Returns the changes to make and the ones skipped, with why.
export function planTweaks(settings, tweaks, { pins = {}, now = Date.now(), includePrivate = false } = {}) {
  const changes = [];
  const skipped = [];
  const seen = new Set();
  for (const tw of Array.isArray(tweaks) ? tweaks : []) {
    const target = tw?.target;
    const t = TUNABLE[target];
    const skip = (why) => skipped.push({ target, why });
    if (!t || seen.has(target)) { skip('unknown'); continue; }
    seen.add(target);
    if (t.private && !includePrivate) { skip('private'); continue; }
    if ((pins[target] || 0) > now) { skip('pinned'); continue; }
    if (changes.length >= MAX_TWEAKS) { skip('limit'); continue; }
    const from = tunableValue(settings, target);
    const reason = String(tw.reason || '').slice(0, 200);
    if (t.number) {
      const want = Number.parseFloat(tw.value);
      if (!Number.isFinite(want)) { skip('invalid'); continue; }
      if (want < t.min || want > t.max) { skip('out of range'); continue; }
      const to = Math.round(Math.min(from + 0.5, Math.max(from - 0.5, want)) * 4) / 4;
      if (Math.abs(to - from) < 0.25) { skip('too small'); continue; }
      changes.push({ target, label: t.label, from, to, reason });
      continue;
    }
    if (!isValidTime(tw.value) || !isValidTime(from)) { skip('invalid'); continue; }
    const [lo, hi] = [timeToMin(t.min), timeToMin(t.max)];
    if (!inWindow(timeToMin(tw.value), lo, hi)) { skip('out of range'); continue; }
    const a = timeToMin(from);
    const diff = ((timeToMin(tw.value) - a + 720 + 1440) % 1440) - 720; // shortest way round the clock
    if (Math.abs(diff) < MIN_SHIFT_MIN) { skip('too small'); continue; }
    const to = minToTime(a + Math.sign(diff) * Math.min(Math.abs(diff), MAX_SHIFT_MIN));
    if (!inWindow(timeToMin(to), lo, hi)) { skip('out of range'); continue; }
    changes.push({ target, label: t.label, from, to, reason });
  }
  return { changes, skipped };
}

// Write one change into settings (mutates).
export function setTunable(settings, target, value) {
  if (!target.startsWith('rem.')) settings[target] = value;
  else {
    const key = target.slice(4);
    settings.reminders = { ...settings.reminders, [key]: { ...settings.reminders?.[key], time: value } };
  }
}

export const SCHEDULED_KEYS = REMINDERS.map((r) => r.key);
export const ONCE_KEYS = ['craving', 'lockEnd', 'gap'];
export const ALL_KEYS = [...SCHEDULED_KEYS, ...ONCE_KEYS, 'test'];

function anchorTime(anchor, s) {
  if (anchor === 'cutoff') return dinnerCutoff(s.sleepTime);
  return s[anchor];
}

// Turn settings into concrete reminders: [{ key, label, time, days|null, on }]
export function resolveReminders(settings) {
  const prefs = settings.reminders || {};
  return REMINDERS.map((def) => {
    const pref = prefs[def.key] || {};
    const time = def.anchor
      ? shiftTime(anchorTime(def.anchor, settings), def.offset)
      : (isValidTime(pref.time) ? pref.time : def.time);
    let days = null;
    if (def.days) {
      const v = settings[def.days];
      days = (Array.isArray(v) ? v : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    }
    const focusOk = !def.focus || (settings.focusAreas || []).includes(def.focus);
    const on = pref.on !== false && focusOk && (days === null || days.length > 0);
    return { key: def.key, label: def.label, time, days, on, editable: !def.anchor };
  });
}

export function cronFor(time, days, tz) {
  const [h, m] = time.split(':').map(Number);
  const dow = days && days.length && days.length < 7 ? [...new Set(days)].sort().join(',') : '*';
  return `CRON_TZ=${tz} ${m} ${h} * * ${dow}`;
}

// The subset of settings the server needs to write good copy at delivery time.
export function messageContext(settings, tz) {
  return {
    tz,
    startDate: settings.startDate,
    baseline: settings.baseline,
    wakeTime: settings.wakeTime,
    sleepTime: settings.sleepTime,
    waterTargetL: settings.waterTargetL,
    alcoholMax: settings.alcoholMax,
  };
}

function dayInfo(ctx, now) {
  const key = dayKeyAt(now, ctx.tz);
  const day = programDay(ctx.startDate, key);
  const phase = phaseFor(day);
  const cap = dailyCap(ctx.baseline, day);
  const label = day >= 1 && day <= PROGRAM_DAYS ? `Day ${day}/${PROGRAM_DAYS} · ${phase.name}` : phase.name;
  return { key, day, phase, cap, label };
}

const plural = (n, w, ws = w.endsWith('h') ? `${w}es` : `${w}s`) => `${n} ${n === 1 ? w : ws}`;

// data: optional per-message details from the app (one-off timers).
export function buildMessage(key, ctx, now = Date.now(), data = {}) {
  const info = dayInfo(ctx, now);
  const capText = info.cap === 0 ? 'Zero-pouch day' : `Cap today: ${plural(info.cap, 'pouch')}`;
  const water = ctx.waterTargetL || 3;
  const msg = (title, body, url = '/#today') => ({ title, body, tag: key, url });

  switch (key) {
    case 'wake':
      return msg(`☀️ ${info.label}`, `500 ml water first. No pouch for 90 min. Tap “I'm awake” and rate your sleep. ${capText}.`);
    case 'microset':
      return msg('💪 Morning micro-set', `Before your shower: ${MICRO_SET.pushups}–15 push-ups · ${MICRO_SET.squats}–20 squats · ${MICRO_SET.plankSec}–45 s plank.`, '/#move');
    case 'water1':
    case 'water2':
      return msg('💧 Hydration check', `Target ${water} L today. Drink a full glass now and log it.`, '/#fuel');
    case 'lunch':
      return msg('🥗 Sprouts before lunch', '1 bowl moong/chana sprouts + raw salad, then 100–150 g paneer, dal, curd or soya.', '/#fuel');
    case 'taperCheck':
      return msg('🌿 Taper check', `${capText}. Urge coming? Start the 15-minute buffer before reaching for a pouch.`);
    case 'shield':
      return msg('🛡️ 4:00 PM Energy Shield', 'Roasted chana, soaked almonds/walnuts or chaas — now. Beat the 5 PM crash that drives cravings.', '/#fuel');
    case 'walk': {
      const p = WALK_PHASES[walkModeFor(info.day)];
      const how = p.mode === 'continuous' ? 'Continuous high tempo for 30:00' : `${p.mode} intervals × 6 rounds`;
      return msg(`🏃 30-min session · ${p.name}`, `${how}. Start the timer in the app and log your distance.`, '/#move');
    }
    case 'circuit':
      return msg(`🔥 Circuit day (${WEEKDAYS[zonedParts(now, ctx.tz).wd]})`, `${circuitRounds(info.day)} rounds: push-ups 12–20 · squats/lunges 20 · pull-ups or 30–45 s hang · 45–60 s plank + 12 core.`, '/#move');
    case 'alcohol':
      return msg('🍺 Guardrail night', `Max ${plural(ctx.alcoholMax || 2, 'drink')}, 1 glass of water per drink. Log every one.`, '/#taper');
    case 'dinner': {
      const cutoff = dinnerCutoff(ctx.sleepTime);
      return msg(`🍽️ Kitchen closes at ${cutoff}`, `Finish dinner 2.5 h before sleep (${ctx.sleepTime}) for deeper sleep and less morning bloat.`, '/#fuel');
    }
    case 'kegel':
      return msg('🧘 Pelvic-floor set', '10 slow squeezes (hold 3 s, relax 3 s), then 10 quick ones. About 2 minutes.', '/#coach');
    case 'waist':
      return msg('📏 Weekly waist check', 'Measure at the navel after a relaxed exhale and log it.', '/#move');
    case 'checkin':
      return msg('📝 Evening check-in', `Log today's pouches, water and reps. ${capText}.`);
    case 'craving':
      return msg(`⏱️ ${BUFFER_MIN}-minute buffer done`, 'Urge gone? Log it as a saved pouch 💪 Still there? Log honestly — the data helps.');
    case 'lockEnd':
      return msg('🔓 Morning oxygen window complete', `90 minutes done. ${capText} — stay under it.`);
    case 'gap': {
      const left = Number.isInteger(data.remaining) ? ` ${plural(data.remaining, 'pouch')} left today.` : '';
      return msg(`⏳ ${GAP_MIN / 60}-hour gap complete`, `Window open.${left} Try elaichi or roasted saunf first.`);
    }
    case 'test':
      return msg('✅ Notifications are working', `${info.label}. Reminders will arrive even when the app is closed.`);
    default:
      return msg('Track', 'Open the app to check in.');
  }
}
