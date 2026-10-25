// The local smart coach against a seeded history.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, tsForDayTime } from '../public/js/plan.js';

// store.js persists to localStorage; give it an in-memory one.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
const { emptyDay, getState, todayKey, update } = await import('../public/js/store.js');
const { aiSummary, coach, smartLine, smartSnapshot } = await import('../public/js/coach.js');

const today = todayKey();
const at = (key, time) => tsForDayTime(key, time);

before(() => {
  update((s) => {
    Object.assign(s.settings, { startDate: addDays(today, -19), baseline: 20, onboarded: true, waterTargetL: 3 });
    for (let i = 1; i <= 14; i++) {
      const k = addDays(today, -i);
      const d = emptyDay();
      const snack = i % 2 === 0;
      const sleep = i % 3 === 0 ? 6 : 8;
      // Most pouches between 16:00 and 18:00; more of them on days without the 4 PM snack.
      const times = ['09:30', '12:00', '16:10', '16:40', '17:20', ...(snack ? [] : ['17:45', '18:30', '19:15'])];
      d.pouches = times.map((t) => ({ ts: at(k, t), flags: ['nobuffer'] }));
      d.snack = snack;
      d.saved = 1;
      d.waterMl = 2000;
      d.checkin = { energy: sleep >= 7 ? 4 : 2, focus: sleep >= 7 ? 4 : 2, sleepHrs: sleep };
      d.kegels = 2;
      s.days[k] = d;
    }
    s.vitality = [{ date: addDays(today, -3), sec: 20, ts: 1 }];
  });
});

test('finds the craving peak, snack effect and energy lever from the data', () => {
  const res = coach(at(today, '10:00'), { notifyMode: 'push' });
  const texts = res.patterns.map((p) => p.text).join('\n');
  assert.match(texts, /in the 16:00–18:00 window/);
  assert.match(texts, /On 4 PM-shield days you average .* vs .* without it/);
  assert.match(texts, /Energy averages 4\/5 on days you slept 7\+ hours, vs 2/);
  assert.match(texts, /first pouch comes about \d+ min after waking/i);
  assert.ok(res.wins.some((w) => /fewer pouches than your old 20\/day/.test(w)));
});

test('suggests timely, data-backed actions', () => {
  const res = coach(at(today, '15:30'), { notifyMode: 'off' });
  const ids = res.suggestions.map((x) => x.id);
  assert.equal(ids[0], 'notify', 'reminders first when the user forgets things');
  const shield = res.suggestions.find((x) => x.id === 'shield');
  assert.match(shield.body, /Your data: .* fewer evening pouches/);
  assert.ok(ids.includes('peak'));
  assert.ok(ids.includes('buffer'));
  assert.ok(ids.includes('water'));
  const kegel = res.suggestions.find((x) => x.id === 'kegel');
  assert.equal(kegel.action.action, 'kegel-add');
  for (let i = 1; i < res.suggestions.length; i++) assert.ok(res.suggestions[i - 1].priority >= res.suggestions[i].priority);
});

test('cap pacing kicks in when ahead of pace', () => {
  update(() => {
    const d = getState().days[today] || emptyDay();
    d.wakeAt = at(today, '06:30');
    d.pouches = ['08:10', '08:40', '09:00', '09:20', '09:40', '10:00', '10:15', '10:30'].map((t) => ({ ts: at(today, t), flags: [] }));
    getState().days[today] = d;
  });
  const pace = coach(at(today, '11:00'), { notifyMode: 'push' }).suggestions.find((x) => x.id === 'pace');
  assert.match(pace.title, /Ahead of pace: 8 of 15/);
  assert.match(pace.body, /^7 pouches left for today\. The next one fits at \d\d:\d\d, then at most one every \d+ h \d\d m\./);
});

test('smart reminder lines reflect what was logged', () => {
  update(() => { getState().days[today].snack = true; });
  const snap = smartSnapshot(at(today, '12:00'));
  assert.match(smartLine(snap, 'shield', at(today, '16:00')).title, /Shield done/);
  assert.match(smartLine(snap, 'water2', at(today, '18:00')).body, /behind/);
  assert.match(smartLine(snap, 'wake', at(addDays(today, 1), '06:30')).body, /Yesterday: 8 of 15 pouches ✓/);
  assert.equal(smartLine(snap, 'shield', at(addDays(today, 2), '16:00')), null);
});

test('AI summary leaves private data out unless allowed', () => {
  const plain = aiSummary();
  assert.equal(plain.vitality, undefined);
  assert.ok(!plain.goal.focus_areas.includes('stamina'));
  assert.equal(plain.last_14_days.length, 14);
  assert.equal(plain.today.pelvic_floor_sets, undefined);
  const full = aiSummary({ includePrivate: true });
  assert.equal(full.vitality.stamina_logs[0].seconds, 20);
  assert.ok(JSON.stringify(full).length < 20000);
});

test('learns typical times from taps and timers for the autopilot', async () => {
  const { typicalTimes } = await import('../public/js/coach.js');
  update((s) => {
    for (let i = 1; i <= 4; i++) {
      const k = addDays(today, -i);
      s.days[k].events = [[at(k, '06:40'), 'walk_start'], [at(k, '06:45'), 'walk_start'], [at(k, i % 2 ? '16:20' : '16:40'), 'snack'], [at(k, '07:10'), 'kegel']];
      s.days[k].wakeAt = at(k, '07:00');
      s.opens.push(at(k, '06:55'), at(k, '00:30')); // 00:30 is the late end of that tracking day
    }
    s.opens.sort((a, b) => a - b);
    s.autopilot.pins = { walkTime: Date.now() + 1000, 'rem.kegel': Date.now() + 1000 };
    s.autopilot.log = [
      { id: 'a', at: Date.now(), target: 'rem.water1', label: 'x', from: '11:00', to: '10:40', reason: '', undone: true },
      { id: 'b', at: Date.now(), target: 'rem.kegel', label: 'x', from: '14:00', to: '13:30', reason: '' },
    ];
  });
  const t = typicalTimes();
  assert.deepEqual(t.walk_start, { time: '06:40', days: 4 }); // first event each day
  assert.deepEqual(t.snack, { time: '16:30', days: 4 });
  assert.deepEqual(t.wake_tap, { time: '07:00', days: 5 }); // 4 seeded + today's 06:30 from the pacing test
  assert.deepEqual(typicalTimes({ n: 3 }).last_activity, { time: '00:30', days: 2 }); // yesterday and the day before, past midnight
  assert.equal(t.kegel, undefined); // private unless allowed
  assert.equal(typicalTimes({ includePrivate: true }).kegel.days, 4);

  const sum = aiSummary();
  assert.equal(sum.tunable.walkTime, getState().settings.walkTime);
  assert.ok(!('rem.kegel' in sum.tunable));
  assert.deepEqual(sum.pinned, ['walkTime']);
  assert.deepEqual(sum.recent_plan_changes.map((c) => [c.target, c.undone_by_user]), [['rem.water1', true]]);
  assert.equal(sum.typical_times.snack.time, '16:30');
  assert.deepEqual(aiSummary({ includePrivate: true }).pinned, ['walkTime', 'rem.kegel']);
});
