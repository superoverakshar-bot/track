// What you've agreed to share with AI services, per category. Nothing leaves the
// device for AI processing without a current, unrevoked consent for its category.
// Bump CONSENT_VERSION when what is sent, or who receives it, changes: everyone
// is asked again.
import { getState } from './store.js';
import { CONSENT_VERSION } from './privacy-rules.js';

export { CONSENT_VERSION };

export const SCOPES = {
  coaching: {
    label: 'AI coaching',
    what: 'Tansen counts, times, triggers and urges; water, food habits, walks, reps and waist; energy, focus and sleep ratings; your schedule and typical times. No name, email or contact details.',
    active: true,
  },
  sexualWellness: {
    label: 'Private stamina data',
    what: 'Pelvic-floor sets and private stamina logs. Only sent while AI coaching is also on.',
    active: true,
  },
  medical: { label: 'Medical records', what: 'Track does not collect these yet. You will be asked separately if it ever does.', active: false },
  photos: { label: 'Photos', what: 'Track does not collect these yet. You will be asked separately if it ever does.', active: false },
  voice: { label: 'Voice recordings', what: 'Track does not collect these yet. You will be asked separately if it ever does.', active: false },
};

export function hasConsent(scope, st = getState()) {
  const c = st.consents?.[scope];
  return Boolean(c && c.granted && c.version === CONSENT_VERSION && !c.revokedAt);
}

// Private stamina data goes to the AI only with both consents and the focus area on.
export function privateAllowed(st = getState()) {
  return hasConsent('coaching', st) && hasConsent('sexualWellness', st) && st.settings.focusAreas.includes('stamina');
}

// Call inside update(). Keeps an append-only history of every change.
export function setConsent(s, scope, granted, now = Date.now()) {
  if (!SCOPES[scope]) throw new Error(`Unknown consent scope: ${scope}`);
  const prev = s.consents[scope];
  s.consents[scope] = granted
    ? { granted: true, version: CONSENT_VERSION, at: now, revokedAt: null }
    : { granted: false, version: CONSENT_VERSION, at: prev?.at ?? null, revokedAt: now };
  s.consentLog.push({ scope, granted, version: CONSENT_VERSION, at: now });
  if (s.consentLog.length > 200) s.consentLog.splice(0, s.consentLog.length - 200);
  // Without AI coaching nothing is sent, so the autopilot stops too.
  if (scope === 'coaching' && !granted) s.autopilot.on = false;
}

// What the server is told: the consent version and the categories allowed now.
export function consentClaim(st = getState()) {
  return { version: CONSENT_VERSION, scopes: Object.keys(SCOPES).filter((k) => hasConsent(k, st)) };
}
