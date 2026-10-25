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
    VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'x', QSTASH_TOKEN: 'x', QSTASH_CURRENT_SIGNING_KEY: 'x', QSTASH_NEXT_SIGNING_KEY: 'x', PUSH_ACCESS_CODE: 'secret',
  });
  const { default: sync } = await import('../api/push/sync.js');
  assert.equal((await sync.fetch(post({}))).status, 401);
  const bad = await sync.fetch(post({ uid: 'short' }, { 'x-access-code': 'secret' }));
  assert.equal(bad.status, 400);
  const badSub = await sync.fetch(post({ uid: 'abcdef123456', subscription: { endpoint: 'http://insecure' } }, { 'x-access-code': 'secret' }));
  assert.equal((await badSub.json()).error, 'Invalid push subscription');

  const { default: deliver } = await import('../api/push/deliver.js');
  const unsigned = await deliver.fetch(post({ key: 'test' }));
  assert.equal(unsigned.status, 401);
  const forged = await deliver.fetch(post({ key: 'test' }, { 'upstash-signature': 'nope' }));
  assert.equal(forged.status, 401);
});
