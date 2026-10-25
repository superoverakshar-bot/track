import { dinnerCutoff, tsForDayTime } from '../plan.js';
import { cutoffTs } from '../logic.js';
import { dayRecord, emptyDay, getState, peekDay, todayKey, update } from '../store.js';
import { clock, esc, icon, toast } from '../ui.js';
import { cardHead, waterCard } from './parts.js';

function toggleRow(field, on, title, sub) {
  return `<button class="check ${on ? 'on' : ''}" data-action="toggle" data-field="${field}" aria-pressed="${on}">
    <span class="box">${icon('check')}</span><span class="txt"><b>${esc(title)}</b><span>${esc(sub)}</span></span></button>`;
}

function dinnerCard(key, rec) {
  const s = getState().settings;
  const cutoff = dinnerCutoff(s.sleepTime);
  const cts = cutoffTs(key);
  const now = Date.now();
  let status;
  if (rec.dinnerAt) {
    const late = rec.dinnerAt > cts;
    status = `<span class="badge ${late ? 'bad' : 'good'}">${late ? icon('alert') : icon('check')}Dinner done ${clock(rec.dinnerAt)}${late ? ` · ${Math.round((rec.dinnerAt - cts) / 60000)} min past cutoff` : ' · on time'}</span>`;
  } else if (now < cts) {
    status = `<span class="badge info">${icon('timer')}Kitchen closes in <span data-until="${cts}"></span></span>`;
  } else {
    status = `<span class="badge warn">${icon('alert')}Past the ${cutoff} cutoff</span>`;
  }
  return `<section class="card">
    ${cardHead('2.5-hour sunset cutoff', 'fuel', `Bed ${s.sleepTime}`)}
    <div class="row"><span class="big-num">${cutoff}</span><span class="muted small">last bite</span></div>
    <div style="margin:10px 0 12px">${status}</div>
    <div class="row wrap">
      <button class="btn primary" data-action="dinner-now">${icon('check')}Dinner done now</button>
      <label class="field" style="flex:1;min-width:130px"><span class="sr-only">Dinner finished at</span><input class="input" type="time" id="dinner-at" data-change="dinner-at" value="${rec.dinnerAt ? clock(rec.dinnerAt) : ''}" aria-label="Dinner finished at"></label>
      ${rec.dinnerAt ? '<button class="btn ghost" data-action="dinner-clear">Clear</button>' : ''}
    </div>
    <p class="tiny muted" style="margin-top:8px">Lower overnight insulin, less morning belly bloat, deeper sleep.</p>
  </section>`;
}

export function render() {
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  return `<div class="stack">
    <section class="card">
      ${cardHead('Morning hydration', 'fuel')}
      ${toggleRow('morningWater', rec.morningWater, '500 ml warm water on waking', 'Before tea or coffee · adds 500 ml to today')}
    </section>
    ${waterCard(rec)}
    <section class="card">
      ${cardHead('Core fuel', 'fuel', [rec.sprouts, rec.protein, rec.booster, rec.snack].filter(Boolean).length + '/4')}
      <div class="checklist">
        ${toggleRow('sprouts', rec.sprouts, '1 bowl sprouts + raw salad', 'Moong or chana, before/with lunch — flattens the glucose spike')}
        ${toggleRow('protein', rec.protein, '100–150 g clean protein', 'Paneer, dal, curd, soya or tofu at lunch and dinner')}
        ${toggleRow('booster', rec.booster, 'Vascular booster', 'Beetroot, pomegranate, spinach or nimbu pani + pinch of rock salt')}
        ${toggleRow('snack', rec.snack, '4:00 PM Energy Shield', 'Roasted chana, soaked almonds/walnuts or chaas')}
      </div>
      <p class="tiny muted" style="margin-top:10px">The 4 PM snack prevents the 5 PM blood-sugar drop that triggers heavy pouch use.</p>
    </section>
    ${dinnerCard(key, rec)}
  </div>`;
}

export const changes = {
  'dinner-at': (el) => {
    if (!el.value) return;
    const ts = tsForDayTime(todayKey(), el.value);
    update(() => { dayRecord(todayKey()).dinnerAt = ts; });
    toast(`Dinner time set to ${el.value}`);
  },
};
