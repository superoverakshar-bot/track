// End-to-end handler tests with the network edges stubbed: QStash schedule calls
// are captured, web-push sends are faked, and deliver gets a genuinely signed JWT.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import webpush from 'web-push';
import { Client } from '@upstash/qstash';
import { SCHEDULED_KEYS } from '../public/js/reminders.js';

const SIGNING_KEY = 'sig_test_current_key';
const calls = { create: [], delete: [], publish: [], push: [] };
let pushError = null;

before(() => {
  Object.assign(process.env, {
    VAPID_PUBLIC_KEY: 'BPub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:test@example.com',
    QSTASH_TOKEN: 'tok', QSTASH_CURRENT_SIGNING_KEY: SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY: 'sig_test_next_key',
    VERCEL_PROJECT_PRODUCTION_URL: 'track.example.app',
  });
  delete process.env.PUSH_ACCESS_CODE;
  delete process.env.APP_URL;
  const schedules = Object.getPrototypeOf(new Client({ token: 'x' }).schedules);
  schedules.create = async (req) => { calls.create.push(req); return { scheduleId: req.scheduleId }; };
  schedules.delete = async (id) => { calls.delete.push(id); };
  Client.prototype.publishJSON = async (req) => { calls.publish.push(req); return { messageId: 'msg_1' }; };
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async (sub, payload) => {
    if (pushError) throw pushError;
    calls.push.push({ sub, payload: JSON.parse(payload) });
    return { statusCode: 201 };
  };
});

beforeEach(() => {
  for (const k of Object.keys(calls)) calls[k] = [];
  pushError = null;
});

const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BKey', auth: 'auth' } };
const ctx = { startDate: '2026-10-01', baseline: 10, wakeTime: '06:30', sleepTime: '23:00', waterTargetL: 3, alcoholMax: 2 };
const post = (body, headers = {}) => new Request('https://track.example.app/api/push/x', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

async function signed(body) {
  const raw = JSON.stringify(body);
  const hash = createHash('sha256').update(raw).digest('base64url');
  const jwt = await new SignJWT({ body: hash })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('Upstash').setSubject('https://track.example.app/api/push/deliver')
    .setIssuedAt().setNotBefore('0s').setExpirationTime('5m')
    .sign(new TextEncoder().encode(SIGNING_KEY));
  return post(raw, { 'upstash-signature': jwt });
}

test('sync upserts enabled reminders and deletes the rest', async () => {
  const { default: sync } = await import('../api/push/sync.js');
  const res = await sync.fetch(post({
    uid: 'device-1234', subscription: sub, tz: 'Asia/Kolkata', ctx,
    reminders: [{ key: 'shield', time: '16:00', days: null }, { key: 'circuit', time: '18:30', days: [1, 3, 5] }],
  }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.destination, 'https://track.example.app/api/push/deliver');
  const byId = Object.fromEntries(calls.create.map((c) => [c.scheduleId, c]));
  assert.equal(byId['ht-device-1234-shield'].cron, 'CRON_TZ=Asia/Kolkata 0 16 * * *');
  assert.equal(byId['ht-device-1234-circuit'].cron, 'CRON_TZ=Asia/Kolkata 30 18 * * 1,3,5');
  assert.equal(JSON.parse(byId['ht-device-1234-shield'].body).sub.endpoint, sub.endpoint);
  assert.ok(calls.delete.includes('ht-device-1234-wake'));
  assert.equal(calls.create.length + calls.delete.length, SCHEDULED_KEYS.length);
});

test('once publishes at the requested time', async () => {
  const { default: once } = await import('../api/push/once.js');
  const at = Date.now() + 15 * 60000;
  const res = await once.fetch(post({ uid: 'device-1234', subscription: sub, tz: 'UTC', ctx, key: 'craving', at }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).messageId, 'msg_1');
  assert.equal(calls.publish[0].notBefore, Math.floor(at / 1000));
  const bad = await once.fetch(post({ uid: 'device-1234', subscription: sub, tz: 'UTC', ctx, key: 'wake', at }));
  assert.equal(bad.status, 400);
});

test('deliver verifies the QStash signature and sends the push', async () => {
  const { default: deliver } = await import('../api/push/deliver.js');
  const res = await deliver.fetch(await signed({ v: 1, uid: 'device-1234', key: 'shield', sub, ctx: { ...ctx, tz: 'Asia/Kolkata' } }));
  assert.equal(res.status, 200);
  assert.equal(calls.push.length, 1);
  assert.match(calls.push[0].payload.title, /Energy Shield/);
  assert.equal(calls.push[0].payload.url, '/#fuel');
});

test('deliver rejects a tampered body', async () => {
  const { default: deliver } = await import('../api/push/deliver.js');
  const req = await signed({ v: 1, uid: 'device-1234', key: 'shield', sub, ctx });
  const tampered = post(JSON.stringify({ v: 1, uid: 'device-1234', key: 'wake', sub, ctx }), { 'upstash-signature': req.headers.get('upstash-signature') });
  assert.equal((await deliver.fetch(tampered)).status, 401);
  assert.equal(calls.push.length, 0);
});

test('expired subscriptions stop their schedules instead of retrying', async () => {
  const { default: deliver } = await import('../api/push/deliver.js');
  pushError = Object.assign(new Error('Gone'), { statusCode: 410 });
  const res = await deliver.fetch(await signed({ v: 1, uid: 'device-1234', key: 'checkin', sub, ctx: { ...ctx, tz: 'UTC' } }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).gone, true);
  assert.equal(calls.delete.length, SCHEDULED_KEYS.length);
});

test('transient push failures return 500 so QStash retries', async () => {
  const { default: deliver } = await import('../api/push/deliver.js');
  pushError = Object.assign(new Error('Server error'), { statusCode: 503 });
  const res = await deliver.fetch(await signed({ v: 1, uid: 'device-1234', key: 'checkin', sub, ctx: { ...ctx, tz: 'UTC' } }));
  assert.equal(res.status, 500);
});
