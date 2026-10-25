// GET /api/push/config — tells the app which server features are available.
import { aiConfigured, aiModel, aiReviewModel, json, missingEnv } from '../../lib/server.js';

export default {
  fetch() {
    const missing = missingEnv();
    return json({
      push: missing.length === 0,
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      needsCode: Boolean(process.env.PUSH_ACCESS_CODE),
      ai: aiConfigured(),
      aiModel: aiConfigured() ? aiModel() : null,
      aiReviewModel: aiConfigured() ? aiReviewModel() : null,
      missing,
    });
  },
};
