import { MORNING_LOCK_MIN, tsForDayTime } from '../plan.js';
import { planFor } from '../logic.js';
import { mode as notifyMode } from '../notify.js';
import { emptyDay, getState, peekDay, todayKey } from '../store.js';
import { esc, icon } from '../ui.js';
import { cardHead, checklistCard, microProgress, taperCard, walkPhaseLine, walkSummary, waterCard } from './parts.js';

function wakeBanner(key, rec, now) {
  if (rec.wakeAt || rec.pouches.length) return '';
  const planned = tsForDayTime(key, getState().settings.wakeTime);
  if (now < planned - 3 * 3600000 || now > planned + 5 * 3600000) return '';
  return `<div class="banner info">${icon('sun')}<div class="grow"><b>Log your wake-up</b><span class="small">Starts the ${MORNING_LOCK_MIN}-min oxygen window. 500 ml water first.</span></div>
    <button class="btn sm primary" data-action="wake">I'm awake</button></div>`;
}

function notifyBanner() {
  const s = getState();
  if (notifyMode() !== 'off' || s.settings.hideNotifyBanner) return '';
  return `<div class="banner">${icon('bell')}<div class="grow"><b>Turn on reminders</b><span class="small">Water, 4 PM shield, kitchen cutoff, craving timer…</span></div>
    <button class="btn sm primary" data-action="nav" data-to="#settings">Set up</button>
    <button class="icon-btn" style="width:32px;height:32px;border:0;background:transparent" data-action="hide-notify-banner" aria-label="Dismiss">${icon('x')}</button></div>`;
}

function moveCard(key, rec) {
  const plan = planFor(key);
  const walk = getState().walks.filter((w) => w.date === key).pop();
  return `<section class="card">
    ${cardHead('Move', 'move', plan.isCircuitDay ? 'Circuit day' : '')}
    <p class="small muted">${esc(walkPhaseLine(plan.walkMode))}</p>
    ${walk ? `<p style="margin-top:6px"><span class="badge good">✓ ${esc(walkSummary(walk))}</span></p>` : ''}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn primary" data-action="walk-start" data-mode="${plan.walkMode}">${icon('play')}30-min timer</button>
      <button class="btn" data-action="nav" data-to="#move">Log walk</button>
    </div>
    <hr class="divider">
    <div class="row" style="margin-bottom:8px"><b class="small">Morning micro-set</b><span class="spacer"></span><button class="btn sm ghost" data-action="nav" data-to="#move">Log reps →</button></div>
    ${microProgress(rec)}
    ${plan.isCircuitDay ? `<hr class="divider"><div class="row"><span class="badge info">${icon('dumbbell')}Circuit · ${rec.rounds}/${plan.rounds} rounds</span><span class="spacer"></span><button class="btn sm" data-action="nav" data-to="#move">Open</button></div>` : ''}
  </section>`;
}

function alcoholCard(key, rec) {
  const plan = planFor(key);
  if (!plan.isAlcoholDay && !rec.drinks) return '';
  const max = getState().settings.alcoholMax;
  const ratioOk = rec.drinkWater >= rec.drinks;
  return `<section class="card">
    ${cardHead('Alcohol guardrail', 'taper', plan.isAlcoholDay ? 'Designated day' : 'Not a designated day')}
    <div class="row"><span class="big-num">${rec.drinks} <small>/ ${max} drinks</small></span><span class="spacer"></span>
    <span class="badge ${ratioOk ? 'good' : 'warn'}">${icon('glass')}Water ${rec.drinkWater}:${rec.drinks}</span></div>
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-action="drink-add">+1 drink</button><button class="btn" data-action="drink-water">${icon('drop')}Water</button></div>
  </section>`;
}

export function render() {
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const now = Date.now();
  return `<div class="stack">
    ${notifyBanner()}
    ${wakeBanner(key, rec, now)}
    ${taperCard(key, rec, now)}
    ${checklistCard(key, rec)}
    ${waterCard(rec, true)}
    ${moveCard(key, rec)}
    ${alcoholCard(key, rec)}
  </div>`;
}
