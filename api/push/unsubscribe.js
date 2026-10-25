// POST /api/push/unsubscribe — remove every daily schedule for this device.
import {
  HttpError, checkAccess, deleteAllSchedules, handle, json, qstash, readJson, requirePush, validUid,
} from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    const { uid } = await readJson(request);
    await deleteAllSchedules(qstash(), validUid(uid));
    return json({ ok: true });
  }),
};
