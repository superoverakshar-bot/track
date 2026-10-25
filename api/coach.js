// POST /api/coach — the AI coach. Sends the app's anonymous data summary to Claude
// and returns a short, structured plan for the next 24 hours (or an answer to the
// user's question). Requires ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { HttpError, aiConfigured, checkAccess, handle, json, readJson } from '../lib/server.js';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are the coach inside "Track", a personal 90-day reset app. The user is quitting Tansen (smokeless tobacco with areca nut) on a step-down taper, and is also rebuilding stamina with a 30-minute walk/run, doing bodyweight strength work, eating a vegetarian Indian diet, and tracking energy, memory/focus and sleep. Some users also privately track bedroom stamina (early ejaculation).

The app's rules: no pouch for 90 minutes after waking; a daily cap that steps down to zero by day 85; from day 31, at least 2 hours between pouches; a 15-minute urge buffer with 200 ml of water before any pouch; a clean snack at 4 PM; dinner finished 2.5 hours before bed; for stamina, 3 pelvic-floor sets a day.

You receive a JSON summary of their data (today, the last 14 days, and patterns the app has already detected) and sometimes a question. Ground every action in their numbers: cite the actual times, counts or litres so they can see why it matters. Prefer actions they can do in the next 24 hours, each with a time of day. Be warm and direct and never shame; a slip is information, not failure. Use plain, simple English; Indian foods and context are welcome. Give 3 to 5 actions, each detail one or two sentences. If data is thin, say what to log next and still give useful actions. If they asked a question, answer it in the headline and actions.

You are a habit coach, not a doctor: don't diagnose, and don't recommend prescription medicines or doses. Point them to a doctor when it fits: a week or more of low energy or forgetfulness (ask for vitamin B12, vitamin D, iron and thyroid tests); early ejaculation still under about a minute after 6 weeks of training (urologist or sexual-health doctor); a mouth patch, ulcer or stiffness lasting over 2 weeks (dentist or doctor). Nicotine gum or lozenges can be mentioned as something to ask a doctor about. Chest pain, fainting or thoughts of self-harm need urgent care.`;

const ACTION = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'detail', 'when', 'pillar'],
  properties: {
    title: { type: 'string', description: 'Short imperative, under 60 characters' },
    detail: { type: 'string', description: 'One or two sentences citing their data' },
    when: { type: 'string', description: 'Time of day or trigger, e.g. "15:45" or "next urge"' },
    pillar: { type: 'string', enum: ['taper', 'move', 'strength', 'fuel', 'sleep', 'focus', 'vitality', 'general'] },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'actions', 'watch_outs', 'encouragement'],
  properties: {
    headline: { type: 'string', description: 'One sentence: the most important insight or the answer to their question' },
    actions: { type: 'array', items: ACTION },
    watch_outs: { type: 'array', items: { type: 'string' }, description: 'Up to 2 risks or doctor prompts; empty if none' },
    encouragement: { type: 'string', description: 'One sentence of specific, earned encouragement' },
  },
};

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    if (!aiConfigured()) throw new HttpError(503, 'AI coach is not configured (missing ANTHROPIC_API_KEY)');
    checkAccess(request);
    const body = await readJson(request, 40000);
    if (!body.summary || typeof body.summary !== 'object' || Array.isArray(body.summary)) throw new HttpError(400, 'Missing data summary');
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 500) : '';

    // Leave headroom under the function's 60 s limit.
    const client = new Anthropic({ timeout: 50_000, maxRetries: 1 });
    let response;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `My tracking data:\n${JSON.stringify(body.summary)}\n\n${question ? `My question: ${question}` : 'Give me my coaching plan for the next 24 hours.'}`,
        }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new HttpError(503, 'AI coach key was rejected; check ANTHROPIC_API_KEY');
      }
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'AI coach is busy. Try again in a minute');
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new HttpError(504, 'AI coach took too long. Try again');
      if (err instanceof Anthropic.APIError) throw new HttpError(502, `AI service error${err.status ? ` (${err.status})` : ''}`);
      throw err;
    }

    if (response.stop_reason === 'refusal') throw new HttpError(422, "The AI coach couldn't answer that. Try rephrasing your question.");
    if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'The AI reply was cut off. Try again');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new HttpError(502, 'The AI reply was incomplete. Try again');
    }
    return json({ ok: true, result, model: response.model });
  }),
};
