// When the autopilot may run on its own. Pure, so it can be tested without a browser.
import { dayKeyAt } from './plan.js';
import { hasConsent } from './consent.js';

const MIN = 60000;
export const AUTO_RUNS_PER_DAY = 4;
export const AUTO_GAP_MIN = 120; // between runs
export const QUIET_MS = 90000; // wait for a pause in activity before tuning
export const PIN_DAYS = 7; // your own edits and undos are left alone this long

// Why an automatic run may or may not happen now ('go' when it should).
export function autoRunCheck(st, now = Date.now()) {
  const ap = st.autopilot;
  if (!hasConsent('coaching', st)) return { status: 'no-consent' };
  if (!ap.on) return { status: 'off' };
  if (!st.settings.onboarded) return { status: 'onboarding' };
  const today = dayKeyAt(now);
  const runsToday = ap.runs.filter((r) => r.auto && r.day === today).length;
  if (runsToday >= AUTO_RUNS_PER_DAY) return { status: 'daily-limit', runsToday };
  const last = ap.runs.length ? ap.runs[ap.runs.length - 1].at : 0;
  if (!ap.dirtyAt || ap.dirtyAt <= last) return { status: 'no-news', runsToday, last };
  if (now - last < AUTO_GAP_MIN * MIN) return { status: 'too-soon', runsToday, last, next: last + AUTO_GAP_MIN * MIN };
  if (now - ap.dirtyAt < QUIET_MS) return { status: 'settling', runsToday, last, next: ap.dirtyAt + QUIET_MS };
  return { status: 'go', runsToday, last };
}

