// Render fragments shared by several screens.
import { AUTO_SAVE_MIN, BUFFER_MIN, BUFFER_WATER_ML, MICRO_SET, WALK_PHASES, paceText } from '../plan.js';
import { checklist, cravingState, microSetDone, streak } from '../logic.js';
import { getState } from '../store.js';
import { clock, esc, icon, mmss, plural } from '../ui.js';
import { PILLAR_EMOJI } from '../joy.js';
import { TRIGGERS, triggerById } from '../taper.js';

export function cardHead(title, pillar, meta = '') {
  const dot = pillar ? `<span class="bubble ${pillar}" aria-hidden="true">${PILLAR_EMOJI[pillar] || '✨'}</span>` : '';
  return `<div class="card-head">${dot}<h2>${esc(title)}</h2>${meta ? `<span class="meta">${meta}</span>` : ''}</div>`;
}

export function cravingBlock(now) {
  const c = cravingState(now);
  if (!c) {
    return `<div class="btn-row" style="margin-top:12px">
      <button class="btn primary" data-action="craving-start">${icon('timer')}Urge buffer</button>
      <button class="btn" data-action="pouch-log">${icon('plus')}Log pouch</button></div>`;
  }
  const water = `<button class="check ${c.water ? 'on' : ''}" data-action="craving-water" aria-pressed="${c.water}">
      <span class="box">${icon('check')}</span><span class="txt"><b>Drink ${BUFFER_WATER_ML} ml water</b><span>Required before a log</span></span></button>`;
  const why = getState().settings.why;
  if (!c.done) {
    return `<div class="buffer" role="timer">
      <div class="row"><div><div class="small muted">Urge buffer · ride the wave</div><div class="count" data-countdown="${c.endsAt}" data-rerender>${mmss(c.left)}</div></div>
      <span class="spacer"></span><button class="btn sm ghost" data-action="craving-cancel">Cancel</button></div>
      <div class="breathe" aria-hidden="true"><span class="in">Breathe in</span><span class="out">Breathe out</span></div>
      ${why ? `<p class="remember">Remember why: <b>${esc(why)}</b></p>` : ''}
      ${water}
      <div><div class="small" style="font-weight:800;margin-bottom:6px">What's behind this urge?</div>
      <div class="trigger-chips">${TRIGGERS.map((t) => `<button class="chip-btn" data-action="craving-trigger" data-id="${t.id}" aria-pressed="${c.trigger === t.id}">${t.emoji} ${esc(t.label)}</button>`).join('')}</div></div>
      <div class="small">💡 ${esc(c.trigger ? triggerById(c.trigger).tip : 'Chew elaichi or roasted saunf, walk for 2 minutes, breathe out slowly. Urges peak and pass.')}</div>
      <div class="btn-row"><button class="btn good" data-action="craving-saved">${icon('check')}Urge passed</button>
      <button class="btn" data-action="pouch-log">Log pouch</button></div></div>`;
  }
  return `<div class="buffer done">
    <div><b>You made it through 15 minutes 🎉</b> <span class="muted">Still want it? Be honest; both answers help.</span></div>
    ${c.water ? '' : water}
    <p class="tiny muted">If you don't log a pouch, this counts as beaten automatically at ${clock(c.endsAt + AUTO_SAVE_MIN * 60000)}.</p>
    <div class="btn-row"><button class="btn good" data-action="craving-saved">${icon('check')}Urge passed — saved</button>
    <button class="btn" data-action="pouch-log">Log pouch</button></div></div>`;
}

// The live urge buffer as its own card (Today shows it under the taper hero).
export function bufferCard(now) {
  if (!cravingState(now)) return '';
  return `<section class="card" id="buffer">${cardHead('Urge buffer', 'taper', '15 min')}${cravingBlock(now)}</section>`;
}

export function checklistCard(key, rec) {
  const items = checklist(key, rec);
  const score = items.filter((i) => i.done).length;
  const { current } = streak();
  const meta = `<span class="score ${score === 5 ? 'full' : ''}">${score}/5</span>`;
  return `<section class="card">
    ${cardHead('Daily non-negotiables', null, meta)}
    <div class="checklist">${items.map((i) => `<button class="check ${i.done ? 'on' : ''} ${i.fail ? 'fail' : ''}" data-action="check" data-id="${i.id}" aria-pressed="${i.done}">
      <span class="box">${i.fail ? icon('x') : icon('check')}</span><span class="txt"><b>${esc(i.label)}</b><span>${esc(i.sub)}</span></span></button>`).join('')}</div>
    ${score === 5 ? '<div class="perfect">⭐ Perfect day! All 5 done. Proud of you.</div>' : ''}
    ${current ? `<p class="small muted" style="margin-top:10px">🔥 ${plural(current, 'day')} in a row at 5/5</p>` : ''}
  </section>`;
}

export function waterCard(rec, compact = false) {
  const target = getState().settings.waterTargetL;
  const l = rec.waterMl / 1000;
  const pct = Math.min(100, (l / target) * 100);
  return `<section class="card">
    ${cardHead('Water', 'fuel', `Target ${target} L`)}
    <div class="row" style="align-items:baseline"><span class="big-num">${l.toFixed(2)} <small>/ ${target} L</small></span></div>
    <div class="meter ${pct >= 100 ? 'good' : ''}" style="margin:10px 0 12px" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="btn-row">
      <button class="btn" data-action="water-add" data-ml="250">${icon('drop')}+250 ml</button>
      <button class="btn" data-action="water-add" data-ml="500">${icon('drop')}+500 ml</button>
      ${compact ? '' : '<button class="btn ghost" data-action="water-add" data-ml="-250">−250</button>'}
    </div>
  </section>`;
}

export function microProgress(rec) {
  const plank = rec.planks.length ? Math.max(...rec.planks) : 0;
  const part = (label, v, t, unit = '') => `<div><div class="small muted">${label}</div><b>${v}${unit}</b><span class="muted small"> / ${t}${unit}</span></div>`;
  return `<div class="grid-3">${part('Push-ups', rec.reps.pushups, MICRO_SET.pushups)}${part('Squats', rec.reps.squats, MICRO_SET.squats)}${part('Plank', plank, MICRO_SET.plankSec, 's')}</div>
    ${microSetDone(rec) ? '<span class="badge good" style="margin-top:8px">✓ Micro-set done</span>' : ''}`;
}

export function walkSummary(walk) {
  return `${walk.distanceKm.toFixed(2)} km in ${walk.durationMin} min · ${paceText(walk.durationMin, walk.distanceKm)}`;
}

export function walkPhaseLine(mode) {
  const p = WALK_PHASES[mode];
  const how = mode === 'continuous' ? 'Continuous 30:00' : `${mode} intervals × 6 rounds`;
  return `${p.weeks} · ${p.name} — ${how}`;
}
