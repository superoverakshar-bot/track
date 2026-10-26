// GET /api/push/config — tells the app which server features are available.
import { accessState, aiConfigured, aiModel, aiReviewModel, json, missingEnv } from '../../lib/server.js';

export default {
  fetch() {
    const missing = missingEnv();
    return json({
      push: missing.length === 0,
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      needsCode: accessState() !== 'open',
      access: accessState(), // 'on' | 'missing' | 'weak' | 'open' (local development)
      ai: aiConfigured(),
      aiModel: aiConfigured() ? aiModel() : null,
      aiReviewModel: aiConfigured() ? aiReviewModel() : null,
      missing,
    });
  },
};
