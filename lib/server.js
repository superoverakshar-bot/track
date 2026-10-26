// Helpers shared by the /api/* functions.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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

// ---- access ----
// Until accounts arrive (Track 2.0 phase 1), every protected call must carry the
// shared PUSH_ACCESS_CODE. A deployed copy fails closed when it isn't set, so the
// paid AI and push endpoints are never open to anyone who finds the URL. Local
// development (no VERCEL env var) stays open.
export const MIN_CODE_LENGTH = 12;

export function accessState() {
  const code = process.env.PUSH_ACCESS_CODE || '';
  if (code.length >= MIN_CODE_LENGTH) return 'on';
  if (code) return 'weak';
  return process.env.VERCEL ? 'missing' : 'open';
}

const digest = (s) => createHash('sha256').update(String(s)).digest();

export function checkAccess(request) {
  const state = accessState();
  if (state === 'open') return;
  if (state === 'weak') throw new HttpError(503, `Access protection is misconfigured: PUSH_ACCESS_CODE must be at least ${MIN_CODE_LENGTH} characters`);
  if (state === 'missing') throw new HttpError(503, 'Access protection is not configured on the server (set PUSH_ACCESS_CODE)');
  if (!timingSafeEqual(digest(request.headers.get('x-access-code') || ''), digest(process.env.PUSH_ACCESS_CODE))) {
    throw new HttpError(401, 'Wrong access code');
  }
}

// ---- limits ----
// Best effort: counters live in this server instance's memory, and Vercel may run
// several instances. The hard ceiling on AI spend is the limit set on the
// OpenRouter key itself; a durable limiter needs the phase 1 database.
const hits = new Map();

export function clientIp(request) {
  return (request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'local').trim();
}

export function rateLimit(request, name, max, windowMs, now = Date.now()) {
  const key = `${name}:${clientIp(request)}`;
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    throw new HttpError(429, 'Too many requests. Try again later');
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear(); // bounded memory
}

const aiDay = { day: '', usd: 0, calls: 0 };
const today = () => new Date().toISOString().slice(0, 10);

// Daily AI ceiling per instance: AI_DAILY_USD (default 1.00) and AI_DAILY_CALLS (default 60).
export function checkAiBudget() {
  if (aiDay.day !== today()) Object.assign(aiDay, { day: today(), usd: 0, calls: 0 });
  const usd = Number(process.env.AI_DAILY_USD) || 1;
  const calls = Number(process.env.AI_DAILY_CALLS) || 60;
  if (aiDay.usd >= usd || aiDay.calls >= calls) throw new HttpError(429, 'Daily AI limit reached. Try again tomorrow');
  aiDay.calls++;
}

export function addAiSpend(usd) {
  if (aiDay.day !== today()) Object.assign(aiDay, { day: today(), usd: 0, calls: 0 });
  aiDay.usd += Number(usd) || 0;
}

export const resetLimitsForTests = () => { hits.clear(); Object.assign(aiDay, { day: '', usd: 0, calls: 0 }); };

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

// A device owns its schedules through its push subscription: the endpoint URL is
// known only to that browser and the push service. The schedule owner ID is a
// keyed hash of it, so a caller can only touch schedules for a subscription it
// actually holds (a client-chosen uid proves nothing).
export function ownerOf(sub) {
  const secret = process.env.PUSH_OWNER_SECRET || process.env.VAPID_PRIVATE_KEY;
  if (!secret) throw new HttpError(503, 'Push is not configured');
  return createHmac('sha256', secret).update(sub.endpoint).digest('hex').slice(0, 24);
}

export const scheduleId = (owner, key) => `ht-${owner}-${key}`;

// Does this pending one-off message belong to this owner? Unknown or delivered → no.
export async function ownsMessage(client, messageId, owner) {
  try {
    const m = await client.messages.get(messageId);
    const raw = m?.body ?? '';
    let body;
    try { body = JSON.parse(raw); } catch { body = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
    return body?.owner === owner;
  } catch {
    return false;
  }
}

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

export async function deleteAllSchedules(client, owner) {
  await Promise.allSettled(SCHEDULED_KEYS.map((k) => client.schedules.delete(scheduleId(owner, k))));
}
