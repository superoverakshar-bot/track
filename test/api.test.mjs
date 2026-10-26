import { test, before } from 'node:test';
import assert from 'node:assert/strict';

before(() => {
  for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'PUSH_ACCESS_CODE']) delete process.env[k];
});

const post = (body, headers = {}) => new Request('https://track.test/api/push/x', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('config reports missing env vars', async () => {
  const { default: config } = await import('../api/push/config.js');
  const res = await config.fetch(new Request('https://track.test/api/push/config'));
  const data = await res.json();
  assert.equal(data.push, false);
  assert.ok(data.missing.includes('QSTASH_TOKEN'));
});

test('push endpoints refuse to run unconfigured', async () => {
  const { default: sync } = await import('../api/push/sync.js');
  const res = await sync.fetch(post({}));
  assert.equal(res.status, 503);
});

test('validation and access code', async () => {
  Object.assign(process.env, {
    VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'x', QSTASH_TOKEN: 'x', QSTASH_CURRENT_SIGNING_KEY: 'x', QSTASH_NEXT_SIGNING_KEY: 'x', PUSH_ACCESS_CODE: 'correct-horse-42',
  });
  const { default: sync } = await import('../api/push/sync.js');
  assert.equal((await sync.fetch(post({}))).status, 401);
  const bad = await sync.fetch(post({ subscription: null }, { 'x-access-code': 'correct-horse-42' }));
  assert.equal(bad.status, 400);
  const badSub = await sync.fetch(post({ subscription: { endpoint: 'http://insecure' } }, { 'x-access-code': 'correct-horse-42' }));
  assert.equal((await badSub.json()).error, 'Invalid push subscription');

  const { default: deliver } = await import('../api/push/deliver.js');
  const unsigned = await deliver.fetch(post({ key: 'test' }));
  assert.equal(unsigned.status, 401);
  const forged = await deliver.fetch(post({ key: 'test' }, { 'upstash-signature': 'nope' }));
  assert.equal(forged.status, 401);
});

test('a deployed server fails closed without a strong access code', async () => {
  const { resetLimitsForTests } = await import('../lib/server.js');
  const { default: sync } = await import('../api/push/sync.js');
  const { default: coach } = await import('../api/coach.js');
  const { default: config } = await import('../api/push/config.js');
  process.env.VERCEL = '1';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  try {
    delete process.env.PUSH_ACCESS_CODE;
    resetLimitsForTests();
    assert.equal((await sync.fetch(post({}))).status, 503);
    const c = await coach.fetch(post({ summary: {} }));
    assert.equal(c.status, 503);
    assert.match((await c.json()).error, /PUSH_ACCESS_CODE/);
    const cfg = await (await config.fetch(new Request('https://track.test/api/push/config'))).json();
    assert.equal(cfg.access, 'missing');
    assert.equal(cfg.needsCode, true);
    process.env.PUSH_ACCESS_CODE = 'short';
    assert.match((await (await coach.fetch(post({ summary: {} }))).json()).error, /at least 12/);
    process.env.PUSH_ACCESS_CODE = 'correct-horse-42';
    assert.equal((await coach.fetch(post({ summary: {} }, { 'x-access-code': 'correct-horse-41' }))).status, 401);
    assert.equal((await coach.fetch(post({ summary: {} }))).status, 401);
  } finally {
    delete process.env.VERCEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.PUSH_ACCESS_CODE;
  }
});

test('rate limits stop unbounded calls per client', async () => {
  const { rateLimit, resetLimitsForTests, HttpError } = await import('../lib/server.js');
  resetLimitsForTests();
  const req = new Request('https://track.test/x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
  const other = new Request('https://track.test/x', { headers: { 'x-forwarded-for': '198.51.100.7' } });
  for (let i = 0; i < 3; i++) rateLimit(req, 't', 3, 60000, 1000);
  assert.throws(() => rateLimit(req, 't', 3, 60000, 1000), (e) => e instanceof HttpError && e.status === 429);
  rateLimit(other, 't', 3, 60000, 1000); // other clients unaffected
  rateLimit(req, 't', 3, 60000, 62000); // window passed
});
