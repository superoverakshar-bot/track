// POST /api/push/test — send a push right now to confirm VAPID + subscription work.
import { buildMessage } from '../../public/js/reminders.js';
import {
  HttpError, checkAccess, handle, isGone, json, rateLimit, readJson, requirePush, sendPush,
  validContext, validSubscription, validTz,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    rateLimit(request, 'push-test', 10, 3600000);
    const body = await readJson(request);
    const sub = validSubscription(body.subscription);
    const tz = validTz(body.tz);
    const ctx = validContext(body.ctx, tz);
    try {
      await sendPush(sub, buildMessage('test', ctx));
    } catch (err) {
      if (isGone(err)) throw new HttpError(410, 'Subscription expired — turn notifications off and on again');
      throw new HttpError(502, `Push service error ${err.statusCode || ''}`.trim());
    }
    return json({ ok: true });
  }),
};
