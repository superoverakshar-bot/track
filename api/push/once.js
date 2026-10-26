// POST /api/push/once — a one-off push at an exact time (craving buffer end,
// morning lock end, 2-hour gap end, time to take a pouch out). Optionally cancels the message it replaces.
import { ONCE_KEYS } from '../../public/js/reminders.js';
import {
  HttpError, checkAccess, deliverUrl, handle, json, qstash, readJson, requirePush,
  validContext, validKey, validSubscription, validTz, validUid,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    const body = await readJson(request);
    const uid = validUid(body.uid);
    const key = validKey(body.key, ONCE_KEYS);
    const sub = validSubscription(body.subscription);
    const tz = validTz(body.tz);
    const ctx = validContext(body.ctx, tz);
    const at = Number(body.at);
    const now = Date.now();
    if (!Number.isFinite(at) || at < now - 60000 || at > now + 24 * 3600000) throw new HttpError(400, 'Invalid time');
    const data = {};
    if (Number.isInteger(body.data?.remaining)) data.remaining = body.data.remaining;
    if (/^\d\d:\d\d$/.test(body.data?.next || '')) data.next = body.data.next;

    const client = qstash();
    if (typeof body.replace === 'string' && body.replace) {
      await client.messages.cancel(body.replace).catch(() => null);
    }
    const res = await client.publishJSON({
      url: deliverUrl(request),
      body: { v: 1, uid, key, sub, ctx, data },
      notBefore: Math.floor(Math.max(at, now) / 1000),
      retries: 2,
    });
    return json({ ok: true, messageId: res.messageId });
  }),
};
