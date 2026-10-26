// Consent screens: the first-time prompt on the Coach tab and the Privacy
// section in Settings. See consent.js for the rules.
import { CONSENT_VERSION, SCOPES, hasConsent, setConsent } from '../consent.js';
import { setOn } from '../autopilot.js';
import { getConfig } from '../notify.js';
import { getState, update } from '../store.js';
import { esc, toast } from '../ui.js';
import { cardHead } from './parts.js';

// "google/gemini-3.8-flash" → "Gemini 3.8 Flash", "openai/gpt-6-sol" → "GPT-6 Sol"
export function modelName(id) {
  if (!id) return 'AI';
  const words = id.split('/').pop().split(':')[0].split('-');
  if (words[0].toLowerCase() === 'gpt' && words.length > 1) words.splice(0, 2, `GPT-${words[1]}`);
  return words.map((w) => (/^(\d|GPT-)/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

const day = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function recipients() {
  const cfg = getConfig() || {};
  const planner = modelName(cfg.aiModel || 'google/gemini-3.8-flash');
  const reviewer = cfg.aiReviewModel ? modelName(cfg.aiReviewModel) : null;
  return `your Track server on Vercel → OpenRouter → ${esc(planner)} (writes the plan)${reviewer ? ` and ${esc(reviewer)} (double-checks schedule changes)` : ''}. OpenRouter routes each request to a provider that runs that model, under that provider's data policy.`;
}

// Shown on the Coach tab until AI coaching is agreed to.
export function consentPrompt() {
  const st = getState();
  const stamina = st.settings.focusAreas.includes('stamina');
  const asked = st.consentLog.some((c) => c.scope === 'coaching');
  return `<section class="card" id="ai">
    ${cardHead('AI coach & autopilot', null, '<span class="badge">Off</span>')}
    <p class="small">The AI coach can plan your day and move reminders to fit your real routine. <b>Nothing is sent until you agree</b>, and everything else in Track works without it.</p>
    <div class="note" style="margin-top:10px"><b>What would be sent</b><br>${esc(SCOPES.coaching.what)}</div>
    <p class="small" style="margin-top:10px"><b>Who receives it:</b> ${recipients()}</p>
    <div class="consent-checks">
      <label><input type="checkbox" id="c-coaching"> I agree to send this to AI services for coaching</label>
      ${stamina ? '<label><input type="checkbox" id="c-private"> Also include private stamina data (pelvic-floor sets and stamina logs)</label>' : ''}
      <label><input type="checkbox" id="c-auto"> Let the autopilot change reminder times by itself (each change can be undone)</label>
    </div>
    <button class="btn primary block" style="margin-top:12px" data-action="consent-save">Save my choices</button>
    <p class="tiny muted" style="margin-top:8px">${asked ? 'You turned AI coaching off earlier. ' : ''}Consent version ${CONSENT_VERSION}. Medical records, photos and voice are not collected. Change any of this later in Settings → Privacy.</p>
  </section>`;
}

export function privacySection() {
  const st = getState();
  const rows = Object.entries(SCOPES).map(([scope, sc]) => {
    const c = st.consents[scope];
    const on = hasConsent(scope, st);
    const status = !sc.active ? 'Not collected' : on ? `Allowed since ${day(c.at)}` : c?.revokedAt ? `Turned off ${day(c.revokedAt)}` : 'Not allowed';
    return `<div class="list-row"><div class="grow"><b>${esc(sc.label)}</b><span>${esc(sc.what)}</span><span class="tiny muted">${esc(status)}</span></div>
      ${sc.active ? `<label class="switch"><input type="checkbox" data-change="consent" data-scope="${scope}" ${on ? 'checked' : ''} aria-label="${esc(sc.label)}"><span></span></label>` : ''}</div>`;
  }).join('');
  const history = st.consentLog.slice(-5).reverse()
    .map((h) => `<li>${esc(day(h.at))} ${new Date(h.at).toTimeString().slice(0, 5)}: ${esc(SCOPES[h.scope]?.label || h.scope)} ${h.granted ? 'allowed' : 'turned off'} (v${h.version})</li>`).join('');
  return `<section class="card" id="privacy">
    ${cardHead('Privacy & AI consent', null)}
    <p class="small muted">Your logs are stored on this device. Only the categories you allow here are sent to AI services: ${recipients()}</p>
    <div class="list-rows" style="margin-top:10px">${rows}</div>
    ${history ? `<details style="margin-top:10px"><summary class="small">Consent history</summary><ul class="bullets tiny">${history}</ul></details>` : ''}
  </section>`;
}

export const privacyActions = {
  'consent-save': () => {
    const coaching = document.getElementById('c-coaching')?.checked;
    const priv = document.getElementById('c-private')?.checked;
    const auto = document.getElementById('c-auto')?.checked;
    update((s) => {
      setConsent(s, 'coaching', Boolean(coaching));
      if (coaching && priv) setConsent(s, 'sexualWellness', true);
      else if (hasConsent('sexualWellness', s)) setConsent(s, 'sexualWellness', false);
    });
    if (coaching) setOn(Boolean(auto));
    toast(coaching ? 'AI coaching is on. Change it any time in Settings → Privacy.' : 'AI coaching stays off. Everything else works as before.');
  },
};

export const privacyChanges = {
  consent: (el) => {
    const scope = el.dataset.scope;
    update((s) => setConsent(s, scope, el.checked));
    if (scope === 'sexualWellness' && el.checked && !hasConsent('coaching')) toast('Saved. Nothing is sent until AI coaching is also on.');
    else toast(el.checked ? `${SCOPES[scope].label} allowed` : `${SCOPES[scope].label} turned off: nothing more is sent`);
  },
};
