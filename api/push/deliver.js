// POST /api/push/deliver — called by QStash (signature-verified) when a schedule
// or one-off message is due. Builds the copy and sends the Web Push.
import { buildMessage, ALL_KEYS } from '../../public/js/reminders.js';
import {
  HttpError, deleteAllSchedules, handle, isGone, json, qstash, receiver, requirePush, sendPush,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    const raw = await request.text();
    const signature = request.headers.get('upstash-signature');
    if (!signature) throw new HttpError(401, 'Missing signature');
    try {
      await receiver().verify({ signature, body: raw, upstashRegion: request.headers.get('upstash-region') || undefined });
    } catch {
      throw new HttpError(401, 'Bad signature');
    }

    const { owner, uid, key, sub, ctx, data } = JSON.parse(raw); // v1 bodies carried uid, v2 carry owner
    if (!ALL_KEYS.includes(key)) return json({ ok: false, skipped: 'unknown key' });

    try {
      await sendPush(sub, buildMessage(key, ctx, Date.now(), data || {}));
    } catch (err) {
      if (isGone(err)) {
        // Device unsubscribed or reinstalled: stop the schedules instead of retrying forever.
        await deleteAllSchedules(qstash(), owner || uid);
        return json({ ok: false, gone: true });
      }
      throw err; // 500 → QStash retries
    }
    return json({ ok: true });
  }),
};
