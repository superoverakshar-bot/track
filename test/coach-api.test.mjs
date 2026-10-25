// /api/coach with OpenRouter stubbed at the fetch boundary.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let calls = [];
let respond = null;
const realFetch = globalThis.fetch;

const plan = {
  headline: 'Your cravings peak at 4 PM.',
  actions: [{ title: 'Shield at 15:45', detail: 'Chana before the peak.', when: '15:45', pillar: 'fuel' }],
  watch_outs: [],
  encouragement: 'Under cap 3 days running.',
};
const completion = (content, finish = 'stop') => new Response(JSON.stringify({
  model: 'google/gemini-3.8-flash', choices: [{ finish_reason: finish, message: { role: 'assistant', content } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });
const apiError = (status, message) => new Response(JSON.stringify({ error: { code: status, message } }), { status });

before(() => {
  delete process.env.PUSH_ACCESS_CODE;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://openrouter.ai/')) {
      calls.push({ url: String(url), init, body: JSON.parse(init.body) });
      return respond();
    }
    return realFetch(url, init);
  };
});

beforeEach(() => {
  calls = [];
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  delete process.env.OPENROUTER_MODEL;
  respond = () => completion(JSON.stringify(plan));
});

const post = (body) => new Request('https://track.test/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const summary = { plan_today: { cap: 15 }, last_14_days: [] };

test('reports a missing key as not configured', async () => {
  delete process.env.OPENROUTER_API_KEY;
  const { default: coach } = await import('../api/coach.js');
  assert.equal((await coach.fetch(post({ summary }))).status, 503);
  const { default: config } = await import('../api/push/config.js');
  const cfg = await (await config.fetch(new Request('https://track.test/api/push/config'))).json();
  assert.equal(cfg.ai, false);
  assert.equal(cfg.aiModel, null);
  assert.equal(calls.length, 0);
});

test('asks Gemini 3.8 Flash on OpenRouter for a schema-checked plan', async () => {
  const { default: coach } = await import('../api/coach.js');
  const res = await coach.fetch(post({ summary, question: 'Why am I tired at 3 PM?' }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.result.actions[0].when, '15:45');
  assert.equal(data.model, 'google/gemini-3.8-flash');

  const { url, init, body } = calls[0];
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.headers.Authorization, 'Bearer sk-or-test');
  assert.equal(body.model, 'google/gemini-3.8-flash');
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[1].content, /Why am I tired at 3 PM\?/);
  assert.match(body.messages[1].content, /"cap":15/);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ['headline', 'actions', 'watch_outs', 'encouragement']);
  assert.equal(body.provider.require_parameters, true);
});

test('OPENROUTER_MODEL overrides the model', async () => {
  process.env.OPENROUTER_MODEL = 'google/gemini-flash-latest';
  const { default: coach } = await import('../api/coach.js');
  await coach.fetch(post({ summary }));
  assert.equal(calls[0].body.model, 'google/gemini-flash-latest');
  const { default: config } = await import('../api/push/config.js');
  assert.equal((await (await config.fetch(new Request('https://track.test/api/push/config'))).json()).aiModel, 'google/gemini-flash-latest');
});

test('OpenRouter errors become clear messages', async () => {
  const { default: coach } = await import('../api/coach.js');
  const errorFor = async (make) => { respond = make; const r = await coach.fetch(post({ summary })); return [r.status, (await r.json()).error]; };
  assert.deepEqual(await errorFor(() => apiError(401, 'No auth')), [503, 'OpenRouter key was rejected; check OPENROUTER_API_KEY']);
  assert.match((await errorFor(() => apiError(402, 'Insufficient credits')))[1], /out of credits/);
  assert.equal((await errorFor(() => apiError(429, 'Rate limited')))[0], 429);
  assert.match((await errorFor(() => apiError(404, 'No endpoints')))[1], /OPENROUTER_MODEL/);
  assert.equal((await errorFor(() => completion(JSON.stringify(plan), 'length')))[0], 502);
  assert.equal((await errorFor(() => completion('{"headline": "cut')))[0], 502);
  assert.equal((await errorFor(() => completion(JSON.stringify(plan), 'content_filter')))[0], 422);
});

test('rejects requests without a summary', async () => {
  const { default: coach } = await import('../api/coach.js');
  assert.equal((await coach.fetch(post({ question: 'hi' }))).status, 400);
  assert.equal(calls.length, 0);
});
