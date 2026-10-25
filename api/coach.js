// POST /api/coach — the AI coach. Sends the app's anonymous data summary to a
// model on OpenRouter (default: Google Gemini 3.8 Flash), which writes a plan for
// the next 24 hours and may propose schedule tweaks (reminder times, wake/bed,
// walk time, water target). A second model from a different company (default:
// OpenAI GPT-6 Sol) then double-checks each tweak; only confirmed or adjusted
// tweaks are returned for the app to apply.
// Requires OPENROUTER_API_KEY. OPENROUTER_MODEL and OPENROUTER_REVIEW_MODEL override the models.
import { HttpError, aiModel, aiReviewModel, checkAccess, handle, json, publicBaseUrl, readJson } from '../lib/server.js';
import { MAX_SHIFT_MIN, MAX_TWEAKS, TUNABLE, TUNABLE_KEYS } from '../public/js/reminders.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM = `You are the coach inside "Track", a personal 90-day reset app. The user is quitting Tansen (smokeless tobacco with areca nut) on a step-down taper, and is also rebuilding stamina with a 30-minute walk/run, doing bodyweight strength work, eating a vegetarian Indian diet, and tracking energy, memory/focus and sleep. Some users also privately track bedroom stamina (early ejaculation). The user says they keep forgetting things and have low energy, so make the plan do the remembering for them.

The app's rules: no pouch for 90 minutes after waking; a daily cap that steps down to zero by day 85; from day 31, at least 2 hours between pouches; a 15-minute urge buffer with 200 ml of water before any pouch; a clean snack at 4 PM; dinner finished 2.5 hours before bed; for stamina, 3 pelvic-floor sets a day.

You receive a JSON summary of their data (today, the last 14 days, and patterns the app has already detected) and sometimes a question. Ground every action in their numbers: cite the actual times, counts or litres so they can see why it matters. Prefer actions they can do in the next 24 hours, each with a time of day. Be warm and direct and never shame; a slip is information, not failure. Use plain, simple English; Indian foods and context are welcome. Give 3 to 5 actions, each detail one or two sentences. If data is thin, say what to log next and still give useful actions. If they asked a question, answer it in the headline and actions.

You also tune their schedule so reminders land when they actually do things. "tunable" holds the current settings, "typical_times" the median time they really did each thing over the last 14 days (with how many days), "pinned" settings they changed or undid themselves (never touch these), and "recent_plan_changes" what was changed lately (don't undo a change the user kept, and don't redo one they undid). Propose a tweak only when a pattern holds on at least 3 days and the move is at least 15 minutes. Put a reminder 10 to 20 minutes before the time they usually do the thing, so it prompts them. Keep the Energy Shield between 15:00 and 17:00 because it pre-empts the late-afternoon craving; put the afternoon taper check about 30 minutes before their craving peak; move wake time toward their real wake taps or first app opens, and bedtime toward when their day really ends. Raise the water target only if they hit the current one most days. At most ${MAX_TWEAKS} tweaks; an empty list is often right. Times are 24-hour HH:MM; the water target is litres like "3.25". The taper itself (caps, morning lock, gap rule, buffer) is fixed and not yours to change.

Keep anything about bedroom stamina or pelvic-floor training inside actions with pillar "vitality" and in watch_outs only. The headline, the encouragement and every other action appear on the app's home screen, so they must not mention it.

You are a habit coach, not a doctor: don't diagnose, and don't recommend prescription medicines or doses. Point them to a doctor when it fits: a week or more of low energy or forgetfulness (ask for vitamin B12, vitamin D, iron and thyroid tests); early ejaculation still under about a minute after 6 weeks of training (urologist or sexual-health doctor); a mouth patch, ulcer or stiffness lasting over 2 weeks (dentist or doctor). Nicotine gum or lozenges can be mentioned as something to ask a doctor about. Chest pain, fainting or thoughts of self-harm need urgent care.

Reply only with JSON matching the schema.`;

const REVIEW_SYSTEM = `You double-check schedule changes that another AI coach proposed for a user of "Track", a habit app for quitting Tansen (smokeless tobacco), walking, strength and diet. The app will apply only the changes you confirm or adjust, so be careful but not timid.

For each proposed tweak decide:
- "confirm": the data supports it as proposed.
- "adjust": the idea is right but a different value fits the data better; give that value.
- "reject": the data doesn't support it, it would undo a change the user kept or redo one they undid, it targets a pinned setting, or it works against quitting (for example pushing the taper check after the craving peak, or the Energy Shield away from 15:00–17:00).

Check each against "typical_times" (median real times over 14 days, with day counts; fewer than 3 days is weak evidence), "tunable" (current values), "pinned", "recent_plan_changes" and "limits" (allowed ranges; moves are capped at ${MAX_SHIFT_MIN} minutes per change). Reminders work best 10 to 20 minutes before the time the user usually does the thing. Times are 24-hour HH:MM; the water target is litres like "3.25". Give a verdict for every proposed tweak, with a one-sentence reason citing the data. Reply only with JSON matching the schema.`;

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

const TWEAK = {
  type: 'object',
  additionalProperties: false,
  required: ['target', 'value', 'reason'],
  properties: {
    target: { type: 'string', enum: TUNABLE_KEYS },
    value: { type: 'string', description: 'New value: HH:MM, or litres for waterTargetL' },
    reason: { type: 'string', description: 'One sentence citing their typical times' },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'actions', 'watch_outs', 'encouragement', 'tweaks'],
  properties: {
    headline: { type: 'string', description: 'One sentence: the most important insight or the answer to their question' },
    actions: { type: 'array', items: ACTION },
    watch_outs: { type: 'array', items: { type: 'string' }, description: 'Up to 2 risks or doctor prompts; empty if none' },
    encouragement: { type: 'string', description: 'One sentence of specific, earned encouragement' },
    tweaks: { type: 'array', items: TWEAK, description: `Schedule changes, at most ${MAX_TWEAKS}; often empty` },
  },
};

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'decision', 'value', 'reason'],
        properties: {
          target: { type: 'string', enum: TUNABLE_KEYS },
          decision: { type: 'string', enum: ['confirm', 'adjust', 'reject'] },
          value: { type: 'string', description: 'The value to apply (the proposed one when confirming)' },
          reason: { type: 'string', description: 'One sentence citing the data' },
        },
      },
    },
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

const validValue = (target, v) => (TUNABLE[target]?.number ? /^\d(\.\d{1,2})?$/.test(v) : /^([01]\d|2[0-3]):[0-5]\d$/.test(v));

// One structured-output call. Returns { result, cost, model }.
async function ask(request, { model, system, user, name, schema, timeoutMs }) {
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
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
        // Only route to providers that honour the JSON schema.
        provider: { require_parameters: true },
        usage: { include: true }, // report the cost of each call
        max_tokens: 8000,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new HttpError(504, 'AI coach took too long. Try again');
    throw new HttpError(502, 'Could not reach OpenRouter');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const code = res.ok ? Number(data?.error?.code) : res.status;
    console.error('OpenRouter error', model, code, data?.error?.message);
    const [status, message] = ERRORS[code] || [502, `AI service error (${code || 'unknown'})`];
    throw new HttpError(status, message);
  }

  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new HttpError(502, 'The AI reply was cut off. Try again');
  if (choice?.finish_reason === 'content_filter') throw new HttpError(422, "The AI coach couldn't answer that. Try rephrasing your question.");
  try {
    return { result: JSON.parse(choice?.message?.content ?? ''), cost: Number(data.usage?.cost) || 0, model: data.model || model };
  } catch {
    throw new HttpError(502, 'The AI reply was incomplete. Try again');
  }
}

// Ask the second model about each proposed tweak; keep only what it confirms or adjusts.
async function review(request, model, summary, proposed, deadline) {
  const input = {
    local_time: summary.local_time,
    plan_today: summary.plan_today,
    tunable: summary.tunable,
    pinned: summary.pinned || [],
    typical_times: summary.typical_times || {},
    recent_plan_changes: summary.recent_plan_changes || [],
    limits: Object.fromEntries(TUNABLE_KEYS.map((k) => [k, { min: TUNABLE[k].min, max: TUNABLE[k].max }])),
    proposed,
  };
  const { result, cost, model: used } = await ask(request, {
    model,
    system: REVIEW_SYSTEM,
    user: `Check these proposed schedule changes:\n${JSON.stringify(input)}`,
    name: 'tweak_review',
    schema: REVIEW_SCHEMA,
    timeoutMs: Math.max(5000, deadline - Date.now()),
  });
  const verdicts = Array.isArray(result?.verdicts) ? result.verdicts : [];
  const kept = [];
  const rejected = [];
  let confirmed = 0;
  let adjusted = 0;
  for (const tw of proposed) {
    const v = verdicts.find((x) => x?.target === tw.target);
    if (v?.decision === 'confirm') {
      kept.push(tw);
      confirmed++;
    } else if (v?.decision === 'adjust' && validValue(tw.target, v.value)) {
      kept.push({ target: tw.target, value: v.value, reason: v.reason || tw.reason });
      adjusted++;
    } else {
      rejected.push({ target: tw.target, value: tw.value, reason: v?.reason || 'Not confirmed by the second check' });
    }
  }
  return { tweaks: kept, review: { model: used, confirmed, adjusted, rejected }, cost };
}

export default {
  fetch: handle(async (request) => {
    const started = Date.now();
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    if (!process.env.OPENROUTER_API_KEY) throw new HttpError(503, 'AI coach is not configured (missing OPENROUTER_API_KEY)');
    checkAccess(request);
    const body = await readJson(request, 60000);
    const summary = body.summary;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new HttpError(400, 'Missing data summary');
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 500) : '';
    const auto = body.mode === 'auto';
    const ask24h = auto
      ? 'Autopilot check-in: I have just been using the app. Retune my schedule if my real times call for it, and refresh my plan for the next 24 hours.'
      : 'Give me my coaching plan for the next 24 hours.';

    const plan = await ask(request, {
      model: aiModel(),
      system: SYSTEM,
      user: `My tracking data:\n${JSON.stringify(summary)}\n\n${question ? `My question: ${question}` : ask24h}`,
      name: 'coach_plan',
      schema: SCHEMA,
      timeoutMs: 32_000,
    });
    const result = plan.result;
    if (typeof result?.headline !== 'string' || !Array.isArray(result?.actions)) throw new HttpError(502, 'The AI reply was incomplete. Try again');

    const proposed = (Array.isArray(result.tweaks) ? result.tweaks : [])
      .filter((t) => TUNABLE[t?.target] && validValue(t.target, t.value))
      .slice(0, MAX_TWEAKS);
    let cost = plan.cost;
    const reviewer = aiReviewModel();
    result.tweaks = proposed;
    result.review = null;
    if (proposed.length && reviewer) {
      try {
        const r = await review(request, reviewer, summary, proposed, started + 52_000); // headroom under the 60 s limit
        result.tweaks = r.tweaks;
        result.review = r.review;
        cost += r.cost;
      } catch (err) {
        // No second opinion, no changes: the plan still comes back.
        console.error('Review failed', err.message);
        result.tweaks = [];
        result.review = { model: reviewer, error: 'The second check was unavailable, so no schedule changes were made.', rejected: proposed.map((t) => ({ ...t, reason: 'Not checked' })) };
      }
    }
    return json({ ok: true, result, model: plan.model, reviewModel: reviewer, cost: Math.round(cost * 1e6) / 1e6 });
  }),
};
