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
  assert.match(buildMessage('dinner', ctx, now).title, /20:30/);
  assert.ok(SCHEDULED_KEYS.length && ONCE_KEYS.every((k) => ALL_KEYS.includes(k)));
});
