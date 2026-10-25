// /api/coach with the Anthropic client stubbed at the SDK boundary.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';

let calls = [];
let reply = null;
let failWith = null;

before(() => {
  delete process.env.PUSH_ACCESS_CODE;
  const messages = Object.getPrototypeOf(new Anthropic({ apiKey: 'x' }).beta.messages);
  messages.create = async (params) => {
    calls.push(params);
    if (failWith) throw failWith;
    return reply;
  };
});

beforeEach(() => {
  calls = [];
  failWith = null;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  reply = {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify({ headline: 'Your cravings peak at 4 PM.', actions: [{ title: 'Shield at 15:45', detail: 'Chana before the peak.', when: '15:45', pillar: 'fuel' }], watch_outs: [], encouragement: 'Under cap 3 days running.' }) },
    ],
  };
});

const post = (body) => new Request('https://track.test/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const summary = { plan_today: { cap: 15 }, last_14_days: [] };

test('reports missing key as not configured', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { default: coach } = await import('../api/coach.js');
  assert.equal((await coach.fetch(post({ summary }))).status, 503);
  const { default: config } = await import('../api/push/config.js');
  assert.equal((await (await config.fetch(new Request('https://track.test/api/push/config'))).json()).ai, false);
});

test('asks Claude for a structured plan and returns it', async () => {
  const { default: coach } = await import('../api/coach.js');
  const res = await coach.fetch(post({ summary, question: 'Why am I tired at 3 PM?' }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.result.actions[0].when, '15:45');
  const p = calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.fallbacks, 'default');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.effort, 'medium');
  assert.equal(p.temperature, undefined);
  assert.match(p.messages[0].content, /Why am I tired at 3 PM\?/);
  assert.match(p.messages[0].content, /"cap":15/);
});

test('refusals and API errors become clear messages', async () => {
  const { default: coach } = await import('../api/coach.js');
  reply = { ...reply, stop_reason: 'refusal', content: [] };
  assert.equal((await coach.fetch(post({ summary }))).status, 422);
  failWith = new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers());
  const limited = await coach.fetch(post({ summary }));
  assert.equal(limited.status, 429);
  failWith = new Anthropic.AuthenticationError(401, { type: 'error' }, 'bad key', new Headers());
  assert.match((await (await coach.fetch(post({ summary }))).json()).error, /ANTHROPIC_API_KEY/);
});

test('rejects requests without a summary', async () => {
  const { default: coach } = await import('../api/coach.js');
  assert.equal((await coach.fetch(post({ question: 'hi' }))).status, 400);
});
