// SEC-001: nothing private reaches an AI service without consent, on the app
// side (summary, autopilot policy) and on the server side (/api/coach).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, tsForDayTime } from '../public/js/plan.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
const { emptyDay, getState, todayKey, update } = await import('../public/js/store.js');
const { aiSummary } = await import('../public/js/coach.js');
const { CONSENT_VERSION, consentClaim, hasConsent, privateAllowed, setConsent } = await import('../public/js/consent.js');
const { autoRunCheck } = await import('../public/js/autopilot-policy.js');
const { stripPrivate } = await import('../public/js/privacy-rules.js');

const today = todayKey();
const PRIVATE = /pelvic|kegel|vitality|stamina_logs|ejaculation|rem\.kegel/i;

before(() => {
  update((s) => {
    Object.assign(s.settings, { startDate: addDays(today, -10), onboarded: true, focusAreas: ['quit', 'energy', 'focus', 'stamina'] });
    for (let i = 1; i <= 5; i++) {
      const k = addDays(today, -i);
      s.days[k] = { ...emptyDay(), kegels: 3, pouches: [{ ts: tsForDayTime(k, '10:00'), flags: [] }], events: [[tsForDayTime(k, '14:00'), 'kegel']] };
    }
    s.vitality = [{ date: addDays(today, -2), sec: 40, ts: 1 }];
  });
});

test('a new user has no AI consent and the autopilot is off', () => {
  const s = getState();
  assert.equal(hasConsent('coaching'), false);
  assert.equal(hasConsent('sexualWellness'), false);
  assert.equal(s.autopilot.on, false);
  assert.equal(privateAllowed(), false);
  assert.equal(autoRunCheck(s).status, 'no-consent');
  assert.deepEqual(consentClaim().scopes, []);
});

test('without private consent the summary carries no private wellness data', () => {
  update((s) => { s.autopilot.on = true; s.autopilot.dirtyAt = Date.now() - 10 * 60000; setConsent(s, 'coaching', true); });
  assert.equal(privateAllowed(), false);
  const text = JSON.stringify(aiSummary({ includePrivate: privateAllowed() }));
  assert.doesNotMatch(text, PRIVATE);
  assert.equal(autoRunCheck(getState()).status, 'go');
});

test('private data is sent only with both consents, and revoking stops it at once', () => {
  update((s) => setConsent(s, 'sexualWellness', true));
  assert.equal(privateAllowed(), true);
  assert.match(JSON.stringify(aiSummary({ includePrivate: privateAllowed() })), /pelvic_floor_sets/);
  update((s) => setConsent(s, 'sexualWellness', false));
  assert.equal(privateAllowed(), false);
  assert.doesNotMatch(JSON.stringify(aiSummary({ includePrivate: privateAllowed() })), PRIVATE);
  // The data itself stays on the device.
  assert.equal(getState().vitality.length, 1);
  assert.equal(getState().days[addDays(today, -1)].kegels, 3);
  const log = getState().consentLog.map((c) => [c.scope, c.granted, c.version]);
  assert.deepEqual(log.slice(-2), [['sexualWellness', true, CONSENT_VERSION], ['sexualWellness', false, CONSENT_VERSION]]);
  assert.ok(getState().consents.sexualWellness.revokedAt > 0);
});

test('revoking AI coaching turns the autopilot off and blocks automatic runs', () => {
  update((s) => setConsent(s, 'coaching', false));
  assert.equal(getState().autopilot.on, false);
  assert.equal(autoRunCheck(getState()).status, 'no-consent');
  assert.deepEqual(consentClaim().scopes, []);
});

test('an outdated consent version counts as no consent', () => {
  update((s) => { s.consents.coaching = { granted: true, version: CONSENT_VERSION - 1, at: 1, revokedAt: null }; });
  assert.equal(hasConsent('coaching'), false);
});

test('saves from before consent existed are asked again', async () => {
  const { importJson } = await import('../public/js/store.js');
  importJson(JSON.stringify({ settings: { aiPrivate: true, onboarded: true }, autopilot: { on: true }, days: {} }));
  assert.equal(hasConsent('coaching'), false);
  assert.equal('aiPrivate' in getState().settings, false);
  assert.equal(autoRunCheck(getState()).status, 'no-consent');
});

test('stripPrivate removes every private field and keeps the rest', () => {
  const sum = {
    vitality: { stamina_logs: [1] }, today: { pouches: 2, pelvic_floor_sets: 3 }, last_14_days: [{ pouches: 1, pelvic_floor_sets: 2 }],
    typical_times: { kegel: { time: '14:00' }, water: { time: '08:00' } }, tunable: { 'rem.kegel': '14:00', walkTime: '07:00' },
    pinned: ['rem.kegel', 'walkTime'], recent_plan_changes: [{ target: 'rem.kegel' }, { target: 'walkTime' }],
    goal: { focus_areas: ['quit', 'stamina'] }, app_patterns: ['Pelvic-floor sets on 5 days', 'Peak 16:00'], app_wins: [],
  };
  const out = stripPrivate(sum);
  assert.doesNotMatch(JSON.stringify(out), PRIVATE);
  assert.equal(out.today.pouches, 2);
  assert.equal(out.tunable.walkTime, '07:00');
  assert.deepEqual(out.app_patterns, ['Peak 16:00']);
  assert.ok(sum.vitality, 'original untouched');
});

// ---- server ----

let sent = [];
beforeEach(async () => {
  (await import('../lib/server.js')).resetLimitsForTests();
  sent = [];
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  delete process.env.OPENROUTER_REVIEW_MODEL;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ headline: 'h', actions: [], watch_outs: [], encouragement: 'e', tweaks: [] }) } }], usage: { cost: 0.001 } }), { status: 200 });
  };
});
const call = async (body) => {
  const { default: coach } = await import('../api/coach.js');
  return coach.fetch(new Request('https://track.test/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
};
const privateSummary = { today: { pouches: 1, pelvic_floor_sets: 3 }, vitality: { concern: 'early ejaculation' } };

test('server refuses AI calls without current coaching consent', async () => {
  assert.equal((await call({ summary: privateSummary })).status, 403);
  assert.equal((await call({ summary: privateSummary, consent: { version: CONSENT_VERSION, scopes: [] } })).status, 403);
  assert.equal((await call({ summary: privateSummary, consent: { version: CONSENT_VERSION - 1, scopes: ['coaching'] } })).status, 403);
  assert.equal(sent.length, 0); // nothing left the server
});

test('server strips private fields unless that category is consented', async () => {
  assert.equal((await call({ summary: privateSummary, consent: { version: CONSENT_VERSION, scopes: ['coaching'] } })).status, 200);
  assert.doesNotMatch(sent[0].messages[1].content, PRIVATE);
  await call({ summary: privateSummary, consent: { version: CONSENT_VERSION, scopes: ['coaching', 'sexualWellness'] } });
  assert.match(sent[1].messages[1].content, /pelvic_floor_sets/);
});
