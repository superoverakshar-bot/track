// Autopilot: after you use the app, the AI coach looks at what you actually did
// and when, and retunes your schedule (reminder times, wake/bed, walk time, water
// target). One model proposes changes, a second model from another company
// double-checks them on the server (api/coach.js), and the app applies only what
// passes both and the limits in reminders.js. It never touches the taper.
// Runs are throttled because each one costs money on OpenRouter.
import { formatTunable, planTweaks, setTunable, tunableValue } from './reminders.js';
import { aiSummary } from './coach.js';
import { postJson } from './api.js';
import { getConfig, settingsChanged } from './notify.js';
import { getState, todayKey, update } from './store.js';
import { CONSENT_VERSION, consentClaim, hasConsent, privateAllowed } from './consent.js';
import { PIN_DAYS, QUIET_MS, autoRunCheck } from './autopilot-policy.js';
import { toast } from './ui.js';

export { AUTO_GAP_MIN, AUTO_RUNS_PER_DAY, PIN_DAYS, QUIET_MS, autoRunCheck } from './autopilot-policy.js';

// ---- running ----

let busy = false;
let timer = null;
export const isBusy = () => busy;

// Something happened: check again once things go quiet.
export function poke(delay = QUIET_MS + 1000) {
  clearTimeout(timer);
  timer = setTimeout(tryAuto, delay);
}

async function tryAuto() {
  if (busy || !getConfig()?.ai || document.visibilityState !== 'visible' || navigator.onLine === false) return;
  const c = autoRunCheck(getState());
  if (c.status === 'go') {
    await runCoach({ auto: true }).catch(() => {});
  } else if (c.next) {
    poke(Math.max(1000, c.next - Date.now() + 1000)); // fires only while the app stays open
  }
}

// One AI run: a fresh 24-hour plan plus checked schedule tweaks, applied right away.
export async function runCoach({ auto = false, question = '' } = {}) {
  if (busy) return null;
  busy = true;
  update(() => {});
  const started = Date.now();
  const day = todayKey();
  try {
    const st = getState();
    if (!hasConsent('coaching', st)) throw new Error('AI coaching is off. Turn it on in Coach → AI coach first.');
    const priv = privateAllowed(st);
    const data = await postJson('/api/coach', { summary: aiSummary({ includePrivate: priv }), question, mode: auto ? 'auto' : 'ask', consent: consentClaim(st) });
    const { changes } = planTweaks(st.settings, data.result.tweaks, { pins: st.autopilot.pins, includePrivate: priv });
    update((s) => {
      s.ai = { at: Date.now(), day, question, result: data.result, auto, model: data.model, reviewModel: data.reviewModel || null };
      for (const ch of changes) {
        setTunable(s.settings, ch.target, ch.to);
        s.autopilot.log.push({ id: `${started}-${ch.target}`, at: Date.now(), auto, ...ch });
      }
      s.autopilot.log = s.autopilot.log.slice(-40);
      s.autopilot.runs = [...s.autopilot.runs, { at: started, day, auto, ok: true, cost: data.cost ?? null, changes: changes.length, model: data.model, consentVersion: CONSENT_VERSION, private: priv }].slice(-60);
      s.autopilot.spend = Math.round(((s.autopilot.spend || 0) + (data.cost || 0)) * 1e6) / 1e6;
    });
    if (changes.length) {
      settingsChanged();
      const first = changes[0];
      toast(`🤖 Plan tuned: ${first.label} ${formatTunable(first.target, first.from)} → ${formatTunable(first.target, first.to)}${changes.length > 1 ? ` (+${changes.length - 1} more)` : ''}`);
    } else if (auto) {
      toast('🤖 Autopilot refreshed your plan');
    }
    return { changes };
  } catch (err) {
    update((s) => { s.autopilot.runs = [...s.autopilot.runs, { at: started, day, auto, ok: false, error: String(err.message).slice(0, 160) }].slice(-60); });
    if (!auto) throw err;
    return null;
  } finally {
    busy = false;
    update(() => {});
  }
}

// ---- your say ----

export function pin(s, target, now = Date.now()) {
  s.autopilot.pins = { ...s.autopilot.pins, [target]: now + PIN_DAYS * 86400000 };
}

// Put a change back and keep the autopilot off that setting for a week.
export function undoChange(id) {
  let reverted = false;
  update((s) => {
    const c = s.autopilot.log.find((x) => x.id === id);
    if (!c || c.undone) return;
    if (tunableValue(s.settings, c.target) === c.to) {
      setTunable(s.settings, c.target, c.from);
      reverted = true;
    }
    c.undone = true;
    pin(s, c.target);
  });
  if (reverted) settingsChanged();
  return reverted;
}

export function setOn(on) {
  if (on && !hasConsent('coaching')) return;
  update((s) => { s.autopilot.on = on; });
  if (on) poke(2000);
}

// Status line for the Coach card.
export function statusText(now = Date.now()) {
  const st = getState();
  const c = autoRunCheck(st, now);
  const at = (ts) => new Date(ts).toTimeString().slice(0, 5);
  switch (c.status) {
    case 'no-consent': return 'Off until you agree to AI coaching.';
    case 'off': return 'Autopilot is off. Turn it on to let the AI move reminder times by itself.';
    case 'onboarding': return 'Starts after setup.';
    case 'daily-limit': return `Tuned ${c.runsToday} times today, the daily limit. Resumes tomorrow.`;
    case 'too-soon': return `New activity logged. Next tune after ${at(c.next)}.`;
    case 'settling':
    case 'go': return 'Tuning shortly…';
    default: return c.last ? 'Up to date. Next tune after your next log or timer.' : 'Waiting for your first log or timer today.';
  }
}
