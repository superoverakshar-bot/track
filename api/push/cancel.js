// POST /api/push/cancel — drop a pending one-off push (e.g. craving buffer cancelled).
import { HttpError, checkAccess, handle, json, qstash, readJson, requirePush } from '../../lib/server.js';

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    requirePush();
    checkAccess(request);
    const { messageId } = await readJson(request);
    if (typeof messageId !== 'string' || !/^[\w-]{1,128}$/.test(messageId)) throw new HttpError(400, 'Invalid messageId');
    await qstash().messages.cancel(messageId).catch(() => null);
    return json({ ok: true });
  }),
};
