// POST JSON to our own /api functions, adding the optional access code.
import { getState } from './store.js';

export async function postJson(path, body) {
  const headers = { 'content-type': 'application/json' };
  const code = getState().settings.pushCode;
  if (code) headers['x-access-code'] = code;
  const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
