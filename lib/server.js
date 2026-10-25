// Helpers shared by the /api/push/* functions.
import webpush from 'web-push';
import { Client, Receiver } from '@upstash/qstash';
import { ALL_KEYS, SCHEDULED_KEYS } from '../public/js/reminders.js';
import { isValidKey, isValidTime } from '../public/js/plan.js';

const VAPID_ENV = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

// QStash vars may also come region-prefixed (QSTASH_REGION=US_EAST_1 → US_EAST_1_QSTASH_TOKEN).
export function missingEnv() {
  const env = process.env;
  const region = env.QSTASH_REGION?.replaceAll('-', '_').toUpperCase();
  const hasQ = (k) => env[k] || (region && env[`${region}_${k}`]);
  return [...VAPID_ENV.filter((k) => !env[k]), ...QSTASH_ENV.filter((k) => !hasQ(k))];
}

export const DEFAULT_AI_MODEL = 'google/gemini-3.8-flash';

export function aiConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function aiModel() {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_AI_MODEL;
}

// A second model, from a different company, double-checks schedule changes
// before the app applies them. OPENROUTER_REVIEW_MODEL=off applies them unchecked.
export const DEFAULT_REVIEW_MODEL = 'openai/gpt-6-sol';

export function aiReviewModel() {
  const v = process.env.OPENROUTER_REVIEW_MODEL?.trim();
  if (v && /^(off|none|false|0)$/i.test(v)) return null;
  return v || DEFAULT_REVIEW_MODEL;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap a handler so thrown HttpErrors become JSON responses.
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  };
}

export function requirePush() {
  const missing = missingEnv();
  if (missing.length) throw new HttpError(503, `Push is not configured (missing ${missing.join(', ')})`);
}

// Optional shared secret so strangers can't use your QStash quota.
export function checkAccess(request) {
  const code = process.env.PUSH_ACCESS_CODE;
  if (code && request.headers.get('x-access-code') !== code) throw new HttpError(401, 'Wrong access code');
}

export async function readJson(request, maxBytes = 16384) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Body too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

// Public origin QStash calls back to. Production URL first: preview deployments
// sit behind Vercel Authentication, which QStash can't pass.
export function publicBaseUrl(request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return new URL(request.url).origin;
}

export function deliverUrl(request) {
  return `${publicBaseUrl(request)}/api/push/deliver`;
}

// ---- validation ----

export function validUid(uid) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(uid)) throw new HttpError(400, 'Invalid uid');
  return uid;
}

export function validSubscription(sub) {
  const ok = sub && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://') && sub.endpoint.length < 1024
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
    && sub.keys.p256dh.length < 256 && sub.keys.auth.length < 64;
  if (!ok) throw new HttpError(400, 'Invalid push subscription');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

export function validTz(tz) {
  try {
    if (typeof tz !== 'string' || tz.length > 64) throw new Error();
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new HttpError(400, 'Invalid time zone');
  }
}

export function validContext(ctx, tz) {
  const c = ctx || {};
  const baseline = Number(c.baseline);
  if (!isValidKey(c.startDate) || !isValidTime(c.wakeTime) || !isValidTime(c.sleepTime)
    || !Number.isFinite(baseline) || baseline < 0 || baseline > 200) {
    throw new HttpError(400, 'Invalid plan context');
  }
  return {
    tz,
    startDate: c.startDate,
    baseline,
    wakeTime: c.wakeTime,
    sleepTime: c.sleepTime,
    waterTargetL: Math.min(10, Math.max(0.5, Number(c.waterTargetL) || 3)),
    alcoholMax: Math.min(20, Math.max(0, Math.round(Number(c.alcoholMax) || 0))),
  };
}

export function validKey(key, allowed = ALL_KEYS) {
  if (!allowed.includes(key)) throw new HttpError(400, 'Unknown reminder');
  return key;
}

export const scheduleId = (uid, key) => `ht-${uid}-${key}`;

// ---- services ----

let vapidReady = false;
export async function sendPush(subscription, message) {
  if (!vapidReady) {
    const subject = process.env.VAPID_SUBJECT || `${process.env.APP_URL || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'example.com'}`}`;
    webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    vapidReady = true;
  }
  return webpush.sendNotification(subscription, JSON.stringify(message), { TTL: 60 * 60, urgency: 'high' });
}

export const isGone = (err) => err && (err.statusCode === 404 || err.statusCode === 410);

// Both read QSTASH_* (or region-prefixed) env vars themselves.
export const qstash = () => new Client();
export const receiver = () => new Receiver();

export async function deleteAllSchedules(client, uid) {
  await Promise.allSettled(SCHEDULED_KEYS.map((k) => client.schedules.delete(scheduleId(uid, k))));
}
