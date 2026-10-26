// Consent rules shared by the app and the server (no browser APIs here).
export const CONSENT_VERSION = 1;
export const SCOPE_KEYS = ['coaching', 'sexualWellness', 'medical', 'photos', 'voice'];

const PRIVATE_TEXT = /pelvic|kegel|ejaculat|bedroom|sexual|stamina log|vitality/i;

// A copy of an AI summary with every private-wellness field removed. The app
// already leaves them out without consent; the server applies this again.
export function stripPrivate(summary) {
  const s = structuredClone(summary || {});
  delete s.vitality;
  const row = (r) => { if (r && typeof r === 'object') delete r.pelvic_floor_sets; };
  row(s.today);
  if (Array.isArray(s.last_14_days)) s.last_14_days.forEach(row);
  if (s.typical_times) delete s.typical_times.kegel;
  if (s.tunable) delete s.tunable['rem.kegel'];
  if (Array.isArray(s.pinned)) s.pinned = s.pinned.filter((t) => t !== 'rem.kegel');
  if (Array.isArray(s.recent_plan_changes)) s.recent_plan_changes = s.recent_plan_changes.filter((c) => c?.target !== 'rem.kegel');
  if (Array.isArray(s.goal?.focus_areas)) s.goal.focus_areas = s.goal.focus_areas.filter((f) => f !== 'stamina');
  for (const k of ['app_patterns', 'app_wins']) if (Array.isArray(s[k])) s[k] = s[k].filter((t) => !PRIVATE_TEXT.test(String(t)));
  return s;
}

// Is this consent claim current and does it cover AI coaching?
export function coachingAllowed(claim) {
  return Boolean(claim && claim.version === CONSENT_VERSION && Array.isArray(claim.scopes) && claim.scopes.includes('coaching'));
}
