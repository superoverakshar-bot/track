// Taper engine: pacing windows, triggers and weekly progress.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, tsForDayTime } from '../public/js/plan.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
const { emptyDay, getState, todayKey, update } = await import('../public/js/store.js');
const { fmtGap, nextWindow, taperProgress, triggerStats, lastPouchEver, withdrawalFor, TRIGGERS } = await import('../public/js/taper.js');

const today = todayKey();
const at = (key, t) => tsForDayTime(key, t);
const setStart = (daysAgo) => update((s) => { Object.assign(s.settings, { startDate: addDays(today, -daysAgo), baseline: 20, wakeTime: '06:30', sleepTime: '23:00', onboarded: true }); });

before(() => setStart(0)); // day 1: cap 18

test('fresh day: first window at lock end, cap spread to an hour before bed', () => {
  const w = nextWindow(today, emptyDay(), at(today, '07:00'));
  assert.equal(w.remaining, 18);
  assert.equal(w.next, at(today, '08:00'));
  assert.equal(w.reason, 'lock');
  assert.equal(w.spacingMin, Math.round(840 / 17)); // 08:00 → 22:00 over 17 gaps
});

test('after a pouch the rest of the cap is spread evenly', () => {
  const rec = emptyDay();
  rec.pouches = [{ ts: at(today, '08:10'), flags: [] }];
  const w = nextWindow(today, rec, at(today, '08:30'));
  assert.equal(w.remaining, 17);
  assert.equal(w.spacingMin, Math.round(830 / 17));
  assert.equal(w.next, at(today, '08:10') + w.spacingMin * 60000);
  assert.equal(w.open, false);
});

test('cap reached, bedtime and gap rule', () => {
  const rec = emptyDay();
  rec.pouches = Array.from({ length: 18 }, (_, i) => ({ ts: at(today, '09:00') + i * 60000, flags: [] }));
  assert.equal(nextWindow(today, rec, at(today, '12:00')).reason, 'cap');
  const late = emptyDay();
  late.pouches = [{ ts: at(today, '21:50'), flags: [] }];
  assert.equal(nextWindow(today, late, at(today, '21:55')).reason, 'bedtime');
  setStart(35); // day 36: cap 10, 2-hour gaps
  const gap = emptyDay();
  gap.pouches = [{ ts: at(today, '20:30'), flags: [] }];
  assert.equal(nextWindow(today, gap, at(today, '20:40')).reason, 'bedtime');
  const mid = emptyDay();
  mid.pouches = [{ ts: at(today, '09:00'), flags: [] }];
  const w = nextWindow(today, mid, at(today, '09:30'));
  assert.ok(w.spacingMin >= 120);
  setStart(0);
});

test('weekly progress, cap streak and trigger stats', () => {
  setStart(20);
  update((s) => {
    for (let i = 1; i <= 14; i++) {
      const d = emptyDay();
      const n = i <= 7 ? 12 : 16; // this week 12/day, last week 16/day
      d.pouches = Array.from({ length: n }, (_, j) => ({ ts: at(addDays(today, -i), '09:00') + j * 3600000, flags: [], trigger: j % 3 === 0 ? 'meal' : j % 3 === 1 ? 'chai' : undefined }));
      d.urges = [{ ts: at(addDays(today, -i), '16:00'), trigger: 'stress' }];
      d.saved = 1;
      s.days[addDays(today, -i)] = d;
    }
  });
  const p = taperProgress();
  assert.equal(p.weekAvg, 12);
  assert.equal(p.prevAvg, 16);
  assert.equal(p.weekChange, -0.25);
  assert.equal(p.reduction, 0.4);
  assert.equal(p.capStreak, 14); // days 14–20 (cap 18/15) at 12/day and days 7–13 (cap 18) at 16/day are all under cap
  const t = triggerStats(14);
  assert.equal(t.list[0].id, 'meal');
  assert.equal(t.list.find((x) => x.id === 'stress').beaten, 13); // window = today + 13 previous days
  assert.ok(Math.abs(t.list.reduce((a, x) => a + x.share, 0) - 1) < 1e-9);
  assert.equal(lastPouchEver(), Math.max(...Object.values(getState().days).flatMap((d) => d.pouches.map((x) => x.ts))));
  assert.ok(TRIGGERS.every((x) => x.tip && x.emoji));
  assert.match(withdrawalFor(2).title, /Days 1–3/);
  assert.deepEqual([45, 125, 480].map(fmtGap), ['45 min', '2 h 05 m', '8 h']);
});

test('coach turns triggers into a plan; taper badges and afternoon line', async () => {
  const { coach, smartLine, smartSnapshot } = await import('../public/js/coach.js');
  const { badgeStats } = await import('../public/js/achievements.js');
  const res = coach(at(today, '15:30'));
  const s = res.suggestions.find((x) => x.id === 'trigger');
  assert.match(s.title, /#1 trigger: .*After a meal/);
  assert.ok(res.patterns.some((p) => p.id === 'trigger'));
  const c = badgeStats();
  assert.ok(c.tagged >= 10);
  assert.equal(c.weekDown, true);
  assert.equal(c.lockDays, 14); // seeded pouches start at 09:00, after the 08:00 lock end
  const { pouchFreeHours } = await import('../public/js/taper.js');
  const last = lastPouchEver();
  assert.equal(pouchFreeHours(last + 30 * 3600000).hours, 30);
  const saved = getState().days;
  const d3 = addDays(today, -3);
  update((s) => { s.days = { [d3]: { ...emptyDay(), pouches: [{ ts: at(d3, '20:00'), flags: [] }] } }; });
  assert.equal(pouchFreeHours(), null); // two days with no log at all don't count as pouch-free
  update((s) => { for (const i of [1, 2]) s.days[addDays(today, -i)] = { ...emptyDay(), waterMl: 2000 }; });
  assert.ok(pouchFreeHours().hours > 48);
  update((s) => { s.days = saved; });
  const snap = smartSnapshot(at(today, '15:30'));
  assert.match(smartLine(snap, 'taperCheck', at(today, '15:30')).body, /0 of 15 used, 15 left\. At most one every \d+ min, last call 22:00/);
});
