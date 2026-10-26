// POST /api/push/cancel — drop a pending one-off push (e.g. craving buffer cancelled).
// Only the device that owns the message (by its push subscription) can cancel it.
import {
  HttpError, checkAccess, handle, json, ownerOf, ownsMessage, qstash, rateLimit, readJson, requirePush, validSubscription,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    rateLimit(request, 'push', 60, 3600000);
    const body = await readJson(request);
    const { messageId } = body;
    if (typeof messageId !== 'string' || !/^[\w-]{1,128}$/.test(messageId)) throw new HttpError(400, 'Invalid messageId');
    const owner = ownerOf(validSubscription(body.subscription));
    const client = qstash();
    // Someone else's message, or one already delivered: nothing to cancel.
    if (!(await ownsMessage(client, messageId, owner))) return json({ ok: true, cancelled: false });
    await client.messages.cancel(messageId).catch(() => null);
    return json({ ok: true, cancelled: true });
  }),
};
