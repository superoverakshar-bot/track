import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_KEYS, ONCE_KEYS, SCHEDULED_KEYS, buildMessage, cronFor, resolveReminders } from '../public/js/reminders.js';

const settings = {
  startDate: '2026-10-01', baseline: 10, wakeTime: '06:30', sleepTime: '23:00', walkTime: '07:00',
  circuitDays: [1, 3, 5], circuitTime: '18:30', waistDays: [0], alcoholDays: [6], alcoholMax: 2, waterTargetL: 3, reminders: {},
};
const ctx = { tz: 'Asia/Kolkata', startDate: '2026-10-01', baseline: 10, wakeTime: '06:30', sleepTime: '23:00', waterTargetL: 3, alcoholMax: 2 };

test('anchored reminders follow the schedule settings', () => {
  const r = Object.fromEntries(resolveReminders(settings).map((x) => [x.key, x]));
  assert.equal(r.wake.time, '06:30');
  assert.equal(r.microset.time, '06:50');
  assert.equal(r.dinner.time, '20:00');
  assert.equal(r.checkin.time, '22:00');
  assert.equal(r.walk.time, '07:00');
  assert.deepEqual(r.circuit.days, [1, 3, 5]);
  assert.equal(r.shield.time, '16:00');
  assert.equal(r.wake.editable, false);
  assert.equal(r.shield.editable, true);
});

test('user overrides and empty day sets', () => {
  const r = Object.fromEntries(resolveReminders({ ...settings, alcoholDays: [], reminders: { shield: { time: '15:45' }, water1: { on: false } } }).map((x) => [x.key, x]));
  assert.equal(r.shield.time, '15:45');
  assert.equal(r.water1.on, false);
  assert.equal(r.alcohol.on, false);
});

test('cron strings carry the time zone and weekdays', () => {
  assert.equal(cronFor('16:00', null, 'Asia/Kolkata'), 'CRON_TZ=Asia/Kolkata 0 16 * * *');
  assert.equal(cronFor('06:05', [5, 1, 3], 'Europe/London'), 'CRON_TZ=Europe/London 5 6 * * 1,3,5');
  assert.equal(cronFor('06:05', [0, 1, 2, 3, 4, 5, 6], 'UTC'), 'CRON_TZ=UTC 5 6 * * *');
});

test('every key produces copy with a title, body and url', () => {
  const now = Date.UTC(2026, 9, 25, 10, 0); // day 25, cut 1
  for (const key of ALL_KEYS) {
    const m = buildMessage(key, ctx, now, { remaining: 3 });
    assert.ok(m.title && m.body && m.url.startsWith('/#'), key);
    assert.ok(!m.body.includes('undefined') && !m.title.includes('undefined'), key);
  }
  assert.match(buildMessage('wake', ctx, now).title, /Day 25\/90 · Cut 1/);
  assert.match(buildMessage('checkin', ctx, now).body, /Cap today: 7 pouches/);
  assert.match(buildMessage('gap', ctx, now, { remaining: 1 }).body, /1 pouch left/);
  assert.match(buildMessage('pouchOut', ctx, now, { next: '11:40' }).body, /Spit it out.*next one fits at 11:40/);
  assert.match(buildMessage('urgeSoon', ctx, now, { next: '16:10' }).body, /around 16:10/);
  assert.doesNotMatch(buildMessage('pouchOut', ctx, now, { next: '<b>' }).body, /<b>/);
  assert.match(buildMessage('dinner', ctx, now).title, /20:30/);
  assert.ok(SCHEDULED_KEYS.length && ONCE_KEYS.every((k) => ALL_KEYS.includes(k)));
});

test('autopilot tweaks stay inside the limits', async () => {
  const { planTweaks, tunableValues } = await import('../public/js/reminders.js');
  const now = Date.UTC(2026, 9, 25, 10, 0);
  const s = { ...settings, sleepTime: '23:00', walkTime: '07:30', waterTargetL: 3, focusAreas: ['quit'] };
  const { changes, skipped } = planTweaks(s, [
    { target: 'walkTime', value: '06:45', reason: 'walks start 06:43' }, // 45 min earlier: applied as is
    { target: 'rem.shield', value: '18:30', reason: 'snack at 18:40' }, // outside 15:00–17:00: refused
    { target: 'sleepTime', value: '00:30', reason: 'late nights' }, // across midnight, capped at 60 min → 00:00
    { target: 'wakeTime', value: '06:35', reason: 'tiny' }, // 5 min: not worth it
    { target: 'rem.kegel', value: '21:00', reason: 'private' },
    { target: 'baseline', value: '30', reason: 'not allowed' },
  ], { now });
  assert.deepEqual(changes.map((c) => [c.target, c.from, c.to]), [['walkTime', '07:30', '06:45'], ['sleepTime', '23:00', '00:00']]);
  assert.deepEqual(Object.fromEntries(skipped.map((x) => [x.target, x.why])), {
    'rem.shield': 'out of range', wakeTime: 'too small', 'rem.kegel': 'private', baseline: 'unknown',
  });

  // Pinned settings, water capped at +0.5 L per run, and at most 3 changes.
  const r2 = planTweaks(s, [
    { target: 'walkTime', value: '08:00', reason: '' },
    { target: 'waterTargetL', value: '3.75', reason: '' },
    { target: 'waterTargetL', value: '4.5', reason: 'duplicate' },
    { target: 'rem.water1', value: '10:30', reason: '' },
    { target: 'rem.lunch', value: '12:15', reason: '' },
    { target: 'rem.water2', value: '17:30', reason: '' },
  ], { now, pins: { walkTime: now + 1000 } });
  assert.deepEqual(r2.changes.map((c) => [c.target, c.to]), [['waterTargetL', 3.5], ['rem.water1', '10:30'], ['rem.lunch', '12:15']]);
  assert.deepEqual(r2.skipped.map((x) => x.why), ['pinned', 'unknown', 'limit']);
  assert.equal(planTweaks(s, [{ target: 'waterTargetL', value: '4.5' }], { now }).skipped[0].why, 'out of range');
  assert.ok(!('rem.kegel' in tunableValues(s)));
  assert.equal(tunableValues(s, { includePrivate: true })['rem.kegel'], '14:00');
});
