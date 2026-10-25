import { PROGRAM_DAYS } from '../plan.js';
import { avoidedPouches, coach } from '../coach.js';
import { headline, lineOfTheDay, partOfDay } from '../joy.js';
import { planFor, streak } from '../logic.js';
import { mode as notifyMode } from '../notify.js';
import { emptyDay, getState, peekDay, todayKey } from '../store.js';
import { esc, icon } from '../ui.js';
import { suggestionRow, visibleSuggestions } from './coach.js';
import { cardHead, checklistCard, microProgress, taperCard, walkPhaseLine, walkSummary, waterCard } from './parts.js';

function heroCard(key) {
  const st = getState();
  const s = st.settings;
  const plan = planFor(key);
  const pod = partOfDay();
  const avoided = avoidedPouches();
  const rupees = s.pricePerPouch > 0 ? Math.round(avoided * s.pricePerPouch) : null;
  const beaten = Object.values(st.days).reduce((a, d) => a + d.saved, 0);
  const day = Math.min(Math.max(plan.day, 0), PROGRAM_DAYS);
  const r = 27;
  const c = 2 * Math.PI * r;
  return `<section class="hero ${pod.key}">
    <div class="hero-ring" role="img" aria-label="Day ${day} of ${PROGRAM_DAYS}">
      <svg viewBox="0 0 66 66"><circle cx="33" cy="33" r="${r}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="7"/>
      <circle cx="33" cy="33" r="${r}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - day / PROGRAM_DAYS)}"/></svg>
      <span><b>${day}</b>of ${PROGRAM_DAYS}</span></div>
    <p class="hello">${pod.hello} ${pod.emoji}</p>
    <h2>${esc(headline(plan.phase.id))}</h2>
    <p class="quote">“${esc(lineOfTheDay(key))}”</p>
    ${s.why ? `<p class="why">💜 <b>My why:</b> ${esc(s.why)}</p>` : '<p class="why">💜 <a href="#settings">Add your “why”</a>. It keeps you going when an urge hits.</p>'}
    <div class="hero-stats">
      <div><b>${avoided}</b><span>pouches avoided</span></div>
      <div>${rupees != null ? `<b>₹${rupees.toLocaleString('en-IN')}</b><span>money saved</span>` : `<b>${beaten}</b><span>urges beaten</span>`}</div>
      <div><b>${streak().current}${streak().current ? '🔥' : ''}</b><span>day streak</span></div>
    </div>
  </section>`;
}

function smartCard() {
  const res = coach(Date.now(), { notifyMode: notifyMode() });
  const list = visibleSuggestions(res).filter((x) => !x.private).slice(0, 3);
  const wins = res.wins.filter((w) => !/fewer pouches/.test(w)); // the hero already shows pouches avoided
  return `<section class="card smart">
    ${cardHead('Smart actions', null, '<a class="small" href="#coach">Coach →</a>')}
    ${list.length ? `<div class="tips">${list.map((x) => suggestionRow(x, { dismissable: true })).join('')}</div>` : '<div class="empty">All caught up. Nice work.</div>'}
    ${wins.length ? `<div class="chips" style="margin-top:10px">${wins.slice(0, 2).map((w) => `<span class="chip win">${icon('check', 'inline')} ${esc(w)}</span>`).join('')}</div>` : ''}
  </section>`;
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
    ${heroCard(key)}
    ${smartCard()}
    ${taperCard(key, rec, now)}
    ${checklistCard(key, rec)}
    ${waterCard(rec, true)}
    ${moveCard(key, rec)}
    ${alcoholCard(key, rec)}
  </div>`;
}
