// POST /api/push/unsubscribe — remove every daily schedule for this device
// (identified by its push subscription, not a client-chosen id).
import {
  HttpError, checkAccess, deleteAllSchedules, handle, json, ownerOf, qstash, rateLimit, readJson, requirePush, validSubscription,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    rateLimit(request, 'push', 60, 3600000);
    const { subscription } = await readJson(request);
    await deleteAllSchedules(qstash(), ownerOf(validSubscription(subscription)));
    return json({ ok: true });
  }),
};
