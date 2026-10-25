import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, capSchedule, capSteps, dailyCap, dayKeyAt, diffDays, distanceTarget, gapRuleActive, minToTime, paceText,
  phaseFor, programDay, shiftTime, walkModeFor, walkSegments, dinnerCutoff,
} from '../public/js/plan.js';

test('date math crosses months and DST-free', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(diffDays('2026-02-27', '2026-03-01'), 2);
  assert.equal(programDay('2026-10-25', '2026-10-25'), 1);
  assert.equal(programDay('2026-10-25', addDays('2026-10-25', 89)), 90);
});

test('20/day tapers weekly with no cliff after day 60', () => {
  assert.deepEqual(capSteps(20), [18, 15, 10, 6, 4, 2, 1, 0]);
  const caps = [1, 14, 15, 30, 31, 60, 61, 66, 67, 72, 73, 78, 79, 84, 85, 90, 91].map((d) => dailyCap(20, d));
  assert.deepEqual(caps, [18, 18, 15, 15, 10, 10, 6, 6, 4, 4, 2, 2, 1, 1, 0, 0, 0]);
  assert.equal(dailyCap(20, 0), 20);
});

test('baseline 10 and small baselines still taper every block', () => {
  assert.deepEqual(capSteps(10), [8, 7, 5, 3, 2, 1, 0]);
  assert.deepEqual(capSchedule(10).final, [{ from: 61, to: 68, cap: 3 }, { from: 69, to: 76, cap: 2 }, { from: 77, to: 84, cap: 1 }]);
  assert.deepEqual(capSteps(6), [4, 3, 2, 2, 1, 0]);
  assert.deepEqual(capSteps(2), [2, 1, 0, 0]);
  for (const b of [0, 1, 2, 3, 5, 8, 12, 20, 30, 40]) {
    const s = capSchedule(b);
    // final steps tile days 61–84 exactly
    if (s.final.length) {
      assert.equal(s.final[0].from, 61);
      assert.equal(s.final[s.final.length - 1].to, 84);
      s.final.slice(1).forEach((f, i) => assert.equal(f.from, s.final[i].to + 1));
    }
    let prevStep = Infinity;
    for (const f of s.final) {
      assert.ok(f.cap < prevStep || prevStep === Infinity);
      prevStep = f.cap;
    }
    let prev = Infinity;
    for (let d = 1; d <= 91; d++) {
      const c = dailyCap(b, d);
      assert.ok(c <= prev, `cap rose on day ${d} for baseline ${b}`);
      assert.ok(c >= 0);
      prev = c;
    }
    assert.equal(dailyCap(b, 90), 0);
  }
});

test('phases, gap rule and walk modes follow the blueprint', () => {
  assert.equal(phaseFor(1).id, 'stabilize');
  assert.equal(phaseFor(15).id, 'cut1');
  assert.equal(phaseFor(31).id, 'cut2');
  assert.equal(phaseFor(61).id, 'final');
  assert.equal(phaseFor(91).id, 'free');
  assert.equal(phaseFor(0).id, 'pre');
  assert.equal(gapRuleActive(30), false);
  assert.equal(gapRuleActive(31), true);
  assert.equal(walkModeFor(14), '4:1');
  assert.equal(walkModeFor(15), '3:2');
  assert.equal(walkModeFor(29), 'continuous');
});

test('interval segments always add up to 30 minutes', () => {
  for (const m of ['4:1', '3:2', 'continuous']) {
    assert.equal(walkSegments(m).reduce((a, s) => a + s.min, 0), 30);
  }
  assert.equal(walkSegments('4:1').length, 12);
});

test('clock helpers wrap around midnight', () => {
  assert.equal(minToTime(-30), '23:30');
  assert.equal(shiftTime('23:50', 20), '00:10');
  assert.equal(dinnerCutoff('23:00'), '20:30');
  assert.equal(dinnerCutoff('01:00'), '22:30');
});

test('tracking day rolls over at 04:00 in the given zone', () => {
  // 2026-10-25 21:30 UTC = 2026-10-26 03:00 IST → still the 25th
  assert.equal(dayKeyAt(Date.UTC(2026, 9, 25, 21, 30), 'Asia/Kolkata'), '2026-10-25');
  // 2026-10-25 23:00 UTC = 2026-10-26 04:30 IST → the 26th
  assert.equal(dayKeyAt(Date.UTC(2026, 9, 25, 23, 0), 'Asia/Kolkata'), '2026-10-26');
});

test('pace and distance targets', () => {
  assert.equal(paceText(30, 3), '10:00 /km');
  assert.equal(paceText(30, 0), '—');
  assert.deepEqual(distanceTarget([{ distanceKm: 2.5 }, { distanceKm: 2.7 }, { distanceKm: 2.6 }]), { from: 2.7, low: 2.8, high: 2.85 });
  assert.equal(distanceTarget([]), null);
});
