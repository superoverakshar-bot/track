// POST /api/coach — the AI coach. Sends the app's anonymous data summary to a
// model on OpenRouter (default: Google Gemini 3.8 Flash) and returns a short,
// structured plan for the next 24 hours, or an answer to the user's question.
// Requires OPENROUTER_API_KEY; OPENROUTER_MODEL overrides the model.
import { HttpError, aiModel, checkAccess, handle, json, publicBaseUrl, readJson } from '../lib/server.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM = `You are the coach inside "Track", a personal 90-day reset app. The user is quitting Tansen (smokeless tobacco with areca nut) on a step-down taper, and is also rebuilding stamina with a 30-minute walk/run, doing bodyweight strength work, eating a vegetarian Indian diet, and tracking energy, memory/focus and sleep. Some users also privately track bedroom stamina (early ejaculation).

The app's rules: no pouch for 90 minutes after waking; a daily cap that steps down to zero by day 85; from day 31, at least 2 hours between pouches; a 15-minute urge buffer with 200 ml of water before any pouch; a clean snack at 4 PM; dinner finished 2.5 hours before bed; for stamina, 3 pelvic-floor sets a day.

You receive a JSON summary of their data (today, the last 14 days, and patterns the app has already detected) and sometimes a question. Ground every action in their numbers: cite the actual times, counts or litres so they can see why it matters. Prefer actions they can do in the next 24 hours, each with a time of day. Be warm and direct and never shame; a slip is information, not failure. Use plain, simple English; Indian foods and context are welcome. Give 3 to 5 actions, each detail one or two sentences. If data is thin, say what to log next and still give useful actions. If they asked a question, answer it in the headline and actions.

You are a habit coach, not a doctor: don't diagnose, and don't recommend prescription medicines or doses. Point them to a doctor when it fits: a week or more of low energy or forgetfulness (ask for vitamin B12, vitamin D, iron and thyroid tests); early ejaculation still under about a minute after 6 weeks of training (urologist or sexual-health doctor); a mouth patch, ulcer or stiffness lasting over 2 weeks (dentist or doctor). Nicotine gum or lozenges can be mentioned as something to ask a doctor about. Chest pain, fainting or thoughts of self-harm need urgent care.

Reply only with JSON matching the schema.`;

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

const ERRORS = {
  400: [502, 'The AI service rejected the request'],
  401: [503, 'OpenRouter key was rejected; check OPENROUTER_API_KEY'],
  402: [503, 'OpenRouter account is out of credits; add credits at openrouter.ai'],
  403: [422, "The AI coach couldn't answer that. Try rephrasing your question."],
  404: [503, 'The AI model was not found; check OPENROUTER_MODEL'],
  408: [504, 'AI coach took too long. Try again'],
  429: [429, 'AI coach is busy. Try again in a minute'],
};

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    if (!process.env.OPENROUTER_API_KEY) throw new HttpError(503, 'AI coach is not configured (missing OPENROUTER_API_KEY)');
    checkAccess(request);
    const body = await readJson(request, 40000);
    if (!body.summary || typeof body.summary !== 'object' || Array.isArray(body.summary)) throw new HttpError(400, 'Missing data summary');
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 500) : '';

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': publicBaseUrl(request),
          'X-Title': 'Track',
        },
        body: JSON.stringify({
          model: aiModel(),
          messages: [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: `My tracking data:\n${JSON.stringify(body.summary)}\n\n${question ? `My question: ${question}` : 'Give me my coaching plan for the next 24 hours.'}`,
            },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'coach_plan', strict: true, schema: SCHEMA } },
          // Only route to providers that honour the JSON schema.
          provider: { require_parameters: true },
          max_tokens: 8000,
        }),
        signal: AbortSignal.timeout(50_000), // headroom under the function's 60 s limit
      });
    } catch (err) {
      if (err?.name === 'TimeoutError') throw new HttpError(504, 'AI coach took too long. Try again');
      throw new HttpError(502, 'Could not reach OpenRouter');
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
      const code = res.ok ? Number(data?.error?.code) : res.status;
      console.error('OpenRouter error', code, data?.error?.message);
      const [status, message] = ERRORS[code] || [502, `AI service error (${code || 'unknown'})`];
      throw new HttpError(status, message);
    }

    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new HttpError(502, 'The AI reply was cut off. Try again');
    if (choice?.finish_reason === 'content_filter') throw new HttpError(422, "The AI coach couldn't answer that. Try rephrasing your question.");
    let result;
    try {
      result = JSON.parse(choice?.message?.content ?? '');
    } catch {
      throw new HttpError(502, 'The AI reply was incomplete. Try again');
    }
    if (typeof result?.headline !== 'string' || !Array.isArray(result?.actions)) throw new HttpError(502, 'The AI reply was incomplete. Try again');
    return json({ ok: true, result, model: data.model || aiModel() });
  }),
};
