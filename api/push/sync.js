// POST /api/push/sync — upsert one QStash cron schedule per enabled daily reminder
// and delete the rest. The schedule body carries everything /deliver needs, so no
// database is required.
import { cronFor, SCHEDULED_KEYS } from '../../public/js/reminders.js';
import { isValidTime } from '../../public/js/plan.js';
import {
  HttpError, checkAccess, deliverUrl, handle, json, qstash, readJson, requirePush, scheduleId,
  validContext, validSubscription, validTz, validUid,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    const body = await readJson(request);
    const uid = validUid(body.uid);
    const sub = validSubscription(body.subscription);
    const tz = validTz(body.tz);
    const ctx = validContext(body.ctx, tz);

    const wanted = new Map();
    for (const r of Array.isArray(body.reminders) ? body.reminders : []) {
      if (!SCHEDULED_KEYS.includes(r?.key) || !isValidTime(r.time)) throw new HttpError(400, 'Invalid reminder');
      const days = Array.isArray(r.days) ? r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : null;
      if (days && !days.length) continue;
      wanted.set(r.key, { time: r.time, days });
    }

    const client = qstash();
    const destination = deliverUrl(request);
    const jobs = SCHEDULED_KEYS.map((key) => {
      const id = scheduleId(uid, key);
      const r = wanted.get(key);
      if (!r) return client.schedules.delete(id).catch(() => null);
      return client.schedules.create({
        scheduleId: id,
        destination,
        cron: cronFor(r.time, r.days, tz),
        body: JSON.stringify({ v: 1, uid, key, sub, ctx }),
        headers: { 'Content-Type': 'application/json' },
        retries: 2,
      });
    });
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((x) => x.status === 'rejected');
    if (failed.length) {
      console.error('schedule sync failures', failed.map((f) => String(f.reason)));
      throw new HttpError(502, `QStash rejected ${failed.length} schedule(s): ${String(failed[0].reason?.message || failed[0].reason)}`);
    }
    return json({ ok: true, scheduled: wanted.size, destination });
  }),
};
