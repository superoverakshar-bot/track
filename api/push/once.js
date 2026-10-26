// POST /api/push/once — a one-off push at an exact time (craving buffer end,
// morning lock end, 2-hour gap end, time to take a pouch out). Optionally cancels the message it replaces.
import { ONCE_KEYS } from '../../public/js/reminders.js';
import {
  HttpError, checkAccess, deliverUrl, handle, json, ownerOf, ownsMessage, qstash, rateLimit, readJson, requirePush,
  validContext, validKey, validSubscription, validTz,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    rateLimit(request, 'push', 60, 3600000);
    const body = await readJson(request);
    const key = validKey(body.key, ONCE_KEYS);
    const sub = validSubscription(body.subscription);
    const owner = ownerOf(sub);
    const tz = validTz(body.tz);
    const ctx = validContext(body.ctx, tz);
    const at = Number(body.at);
    const now = Date.now();
    if (!Number.isFinite(at) || at < now - 60000 || at > now + 24 * 3600000) throw new HttpError(400, 'Invalid time');
    const data = {};
    if (Number.isInteger(body.data?.remaining)) data.remaining = body.data.remaining;
    if (/^\d\d:\d\d$/.test(body.data?.next || '')) data.next = body.data.next;

    const client = qstash();
    // Replace only a message this device owns.
    if (typeof body.replace === 'string' && /^[\w-]{1,128}$/.test(body.replace) && await ownsMessage(client, body.replace, owner)) {
      await client.messages.cancel(body.replace).catch(() => null);
    }
    const res = await client.publishJSON({
      url: deliverUrl(request),
      body: { v: 2, owner, key, sub, ctx, data },
      notBefore: Math.floor(Math.max(at, now) / 1000),
      retries: 2,
    });
    return json({ ok: true, messageId: res.messageId });
  }),
};
