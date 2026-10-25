// GET /api/push/config — tells the app whether server push is available.
import { json, missingEnv } from '../../lib/server.js';

export default {
  fetch() {
    const missing = missingEnv();
    return json({
      push: missing.length === 0,
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      needsCode: Boolean(process.env.PUSH_ACCESS_CODE),
      missing,
    });
  },
};
