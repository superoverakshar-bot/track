// Browser journeys against the local dev server: core tracking still works, the
// AI consent boundary holds, and no screen breaks the Content Security Policy.
// Run with `npm run e2e` (starts its own server). Needs Playwright's Chromium.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(import.meta.dirname, '../..');
const PORT = 3000 + Math.floor(Math.random() * 1000) + 1000;
const URL = `http://localhost:${PORT}`;
const failures = [];

async function startServer() {
  const proc = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL)).ok) return proc; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('dev server did not start');
}

async function journey(browser, name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await fn(page, ctx);
    const real = errors.filter((e) => !/Failed to load resource/.test(e));
    if (real.length) throw new Error(`console errors: ${real.join(' | ')}`);
    console.log(`✓ ${name}`);
  } catch (err) {
    console.log(`✗ ${name}: ${err.message.split('\n')[0]}`);
    failures.push(name);
  } finally {
    await ctx.close();
  }
}

const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('track.v1')));

async function onboard(page) {
  await page.goto(URL);
  await page.fill('[name="baseline"]', '20');
  await page.getByRole('button', { name: 'Start my 90 days' }).click();
  await page.locator('.hero').waitFor();
}

// The AI endpoint as seen by the app: configured, and recording what it's sent.
async function fakeAi(page, sent) {
  await page.route('**/api/push/config', (r) => r.fulfill({ json: { push: false, publicKey: null, needsCode: false, access: 'open', missing: [], ai: true, aiModel: 'google/gemini-3.8-flash', aiReviewModel: 'openai/gpt-6-sol' } }));
  await page.route('**/api/coach', async (r) => {
    sent.push(JSON.parse(r.request().postData()));
    await r.fulfill({ json: { ok: true, model: 'google/gemini-3.8-flash', cost: 0.01, result: { headline: 'Plan', actions: [], watch_outs: [], encouragement: 'Nice', tweaks: [], review: null } } });
  });
}

const server = await startServer();
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || 'chromium' });
try {
  await journey(browser, 'core tracking: urge buffer, pouch with trigger, water', async (page) => {
    await onboard(page);
    await page.getByRole('button', { name: /I have an urge/ }).click();
    await page.locator('#buffer').waitFor();
    await page.getByRole('button', { name: 'Urge passed' }).click();
    await page.locator('[data-action="pouch-log"]').first().click();
    await page.getByRole('button', { name: /Tea \/ coffee/ }).click();
    await page.getByText(/Pouch logged/).waitFor();
    await page.locator('[data-action="water-add"][data-ml="500"]').first().click();
    const s = await state(page);
    const d = Object.values(s.days)[0];
    if (d.saved !== 1 || d.pouches[0]?.trigger !== 'chai' || d.waterMl < 500) throw new Error(JSON.stringify({ saved: d.saved, pouches: d.pouches, water: d.waterMl }));
  });

  await journey(browser, 'new user: AI off, autopilot off, nothing sent until consent', async (page) => {
    const sent = [];
    await fakeAi(page, sent);
    await onboard(page);
    await page.locator('[data-action="water-add"][data-ml="500"]').first().click();
    await page.click('a[href="#coach"]');
    await page.getByText('Nothing is sent until you agree').waitFor();
    await page.getByText(/OpenRouter → Gemini 3\.8 Flash/).first().waitFor();
    const s = await state(page);
    if (s.autopilot.on || Object.keys(s.consents).length) throw new Error('defaults not private');
    // Decline: tracking keeps working and nothing is sent.
    await page.locator('[data-action="consent-save"]').click();
    await page.getByText('AI coaching stays off').waitFor();
    await page.click('a[href="#today"]');
    await page.locator('[data-action="pouch-log"]').first().click();
    await page.getByRole('button', { name: /Stress/ }).click();
    await page.getByText(/Pouch logged/).waitFor();
    if (sent.length) throw new Error(`AI was called ${sent.length}× without consent`);
    const after = await state(page);
    if (Object.values(after.days).flatMap((d) => d.pouches).length !== 1) throw new Error('tracking broke after declining');
  });

  await journey(browser, 'consent without private data: summary excludes it, revoking stops sending', async (page) => {
    const sent = [];
    await fakeAi(page, sent);
    await onboard(page);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('track.v1'));
      s.settings.focusAreas = ['quit', 'energy', 'focus', 'stamina'];
      s.vitality = [{ date: s.settings.startDate, sec: 30, ts: 1 }];
      localStorage.setItem('track.v1', JSON.stringify(s));
    });
    await page.reload();
    await page.click('a[href="#coach"]');
    await page.locator('#c-coaching').check();
    await page.locator('[data-action="consent-save"]').click(); // private and autopilot left unticked
    await page.locator('[data-action="ai-ask"]').click();
    await page.locator('.ai-headline').waitFor();
    const body = sent[0];
    if (!body || body.consent.scopes.join() !== 'coaching') throw new Error('consent claim ' + JSON.stringify(body?.consent));
    if (/vitality|pelvic|kegel|stamina_logs/i.test(JSON.stringify(body.summary))) throw new Error('private data in summary');
    const s = await state(page);
    if (s.autopilot.on) throw new Error('autopilot turned on without being ticked');
    // Revoke in Settings → Privacy: the next ask is refused before any request.
    await page.click('a[href="#settings"]').catch(() => page.evaluate(() => { location.hash = 'settings'; }));
    await page.locator('[data-change="consent"][data-scope="coaching"]').uncheck({ force: true });
    await page.evaluate(() => { location.hash = 'coach'; });
    await page.getByText('Nothing is sent until you agree').waitFor();
    if (sent.length !== 1) throw new Error('sent after revoking');
    if (!(await state(page)).consentLog.some((c) => c.scope === 'coaching' && !c.granted)) throw new Error('revocation not recorded');
  });

  await journey(browser, 'every screen renders under the Content Security Policy', async (page) => {
    const csp = (await (await fetch(URL)).headers.get('content-security-policy')) || '';
    if (!/script-src 'self'/.test(csp)) throw new Error('CSP header missing');
    await onboard(page);
    for (const r of ['today', 'taper', 'coach', 'move', 'fuel', 'progress', 'settings']) {
      await page.evaluate((h) => { location.hash = h; }, r);
      await page.waitForTimeout(250);
    }
    await page.locator('#privacy').waitFor();
    await page.getByText('Only in this browser').waitFor();
  });
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.log(`\n${failures.length} journey(s) failed`);
  process.exit(1);
}
console.log('\nall journeys passed');
