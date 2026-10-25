import { WEEKDAYS, capSchedule, dinnerCutoff, isValidKey, isValidTime } from '../plan.js';
import { resolveReminders } from '../reminders.js';
import {
  disableNotifications, enableNotifications, getConfig, mode, permission, sendTest, settingsChanged, support, syncPush,
} from '../notify.js';
import { exportJson, getState, importJson, resetAll, update } from '../store.js';
import { confirmDialog, esc, icon, toast } from '../ui.js';
import { cardHead } from './parts.js';

const anchorNote = { wake: 'wake time', microset: 'wake + 20 min', walk: 'walk time', circuit: 'circuit time', dinner: 'cutoff − 30 min', checkin: 'bedtime − 1 h' };

function daysPick(key, selected, label) {
  return `<div class="days-pick" role="group" aria-label="${esc(label)}">${WEEKDAYS.map((d, i) => `<button type="button" data-action="day-toggle" data-key="${key}" data-d="${i}" aria-pressed="${selected.includes(i)}">${d.slice(0, 2)}</button>`).join('')}</div>`;
}

function field(label, inner, hint = '') {
  return `<label class="field"><span>${esc(label)}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function input(key, type, value, extra = '') {
  return `<input class="input" id="set-${key}" type="${type}" data-change="setting" data-key="${key}" value="${esc(value)}" ${extra}>`;
}

function planSection(s) {
  const c = capSchedule(s.baseline);
  return `<section class="card">
    ${cardHead('Plan', 'taper')}
    <div class="form-grid">
      ${field('Start date (day 1)', input('startDate', 'date', s.startDate))}
      ${field('Baseline pouches / day', input('baseline', 'number', s.baseline, 'min="0" max="100" inputmode="numeric"'), 'Your usual daily count before starting')}
    </div>
    <p class="small muted" style="margin-top:10px">Caps: ${c.stabilize} → ${c.cut1} → ${c.cut2} → ${c.final2} → ${c.final1} → 0</p>
  </section>`;
}

function scheduleSection(s) {
  return `<section class="card">
    ${cardHead('Daily schedule', null)}
    <div class="form-grid">
      ${field('Wake time', input('wakeTime', 'time', s.wakeTime))}
      ${field('Bedtime', input('sleepTime', 'time', s.sleepTime), `Kitchen closes ${dinnerCutoff(s.sleepTime)}`)}
      ${field('30-min walk time', input('walkTime', 'time', s.walkTime))}
      ${field('Water target (L)', input('waterTargetL', 'number', s.waterTargetL, 'min="1" max="6" step="0.25" inputmode="decimal"'))}
      <div class="field full"><span>Circuit days</span>${daysPick('circuitDays', s.circuitDays, 'Circuit days')}</div>
      ${field('Circuit time', input('circuitTime', 'time', s.circuitTime))}
      <div class="field full"><span>Waist log day</span>${daysPick('waistDays', s.waistDays, 'Waist log day')}</div>
      <div class="field full"><span>Designated alcohol days</span>${daysPick('alcoholDays', s.alcoholDays, 'Designated alcohol days')}</div>
      ${field('Max drinks on those days', input('alcoholMax', 'number', s.alcoholMax, 'min="0" max="10" inputmode="numeric"'))}
    </div>
  </section>`;
}

function notifySection(s) {
  const cfg = getConfig() || {};
  const m = mode();
  const perm = permission();
  const status = {
    off: ['Off', 'warn', 'No reminders are scheduled.'],
    local: ['On · in-app', 'info', 'Reminders show while Track is open or in the background. Configure server push so they arrive when it is closed.'],
    push: ['On · push', 'good', 'Reminders arrive even when the app is closed.'],
  }[m];
  let server;
  if (cfg.push) server = `<span class="badge good">${icon('check')}Server push ready</span>`;
  else if (cfg.unreachable) server = `<span class="badge">${icon('alert')}Server not reachable (offline or local preview)</span>`;
  else server = `<span class="badge warn">${icon('alert')}Server push not configured</span><p class="tiny muted" style="margin-top:6px">Missing env vars: ${esc((cfg.missing || []).join(', '))}. See the README's “Push notifications” section.</p>`;
  const iosHint = support.ios && !support.standalone
    ? `<div class="banner info" style="margin-top:12px">${icon('share')}<div class="grow"><b>iPhone / iPad</b><span class="small">Tap Share → <b>Add to Home Screen</b>, open Track from the icon, then enable notifications here.</span></div></div>` : '';
  const blocked = perm === 'denied' ? `<p class="small" style="margin-top:8px"><span class="badge bad">${icon('alert')}Blocked in browser settings</span></p>` : '';
  const rems = resolveReminders(s);
  return `<section class="card" id="notifications">
    ${cardHead('Notifications', null, `<span class="badge ${status[1]}">${status[0]}</span>`)}
    <p class="small muted">${status[2]}</p>
    <div style="margin-top:10px">${server}</div>
    ${blocked}${iosHint}
    ${cfg.needsCode ? `<div style="margin-top:12px">${field('Access code', input('pushCode', 'password', s.pushCode, 'autocomplete="off"'), 'Set by PUSH_ACCESS_CODE on the server')}</div>` : ''}
    <div class="btn-row" style="margin-top:12px">
      ${m === 'off' ? `<button class="btn primary" data-action="notify-on" ${!support.notifications ? 'disabled' : ''}>${icon('bell')}Enable notifications</button>`
      : `<button class="btn" data-action="notify-off">${icon('bellOff')}Turn off</button>`}
      <button class="btn" data-action="notify-test" ${perm !== 'granted' ? 'disabled' : ''}>Send test</button>
      ${m === 'local' && cfg.push ? '<button class="btn" data-action="notify-on">Retry push</button>' : ''}
      ${m === 'push' ? '<button class="btn ghost" data-action="notify-resync">Re-sync</button>' : ''}
    </div>
    <h3 class="small" style="margin:16px 0 4px">Reminders</h3>
    <div class="list-rows">
      ${rems.map((r) => `<div class="list-row"><div class="grow"><b>${esc(r.label)}</b>
        <span>${r.days ? (r.days.length ? r.days.map((d) => WEEKDAYS[d]).join(', ') : 'No days selected') : 'Every day'}${r.editable ? '' : ` · ${r.time} (${anchorNote[r.key]})`}</span></div>
        ${r.editable ? `<input class="input" type="time" id="rem-time-${r.key}" data-change="rem-time" data-key="${r.key}" value="${r.time}" aria-label="${esc(r.label)} time">` : ''}
        <label class="switch"><input type="checkbox" id="rem-on-${r.key}" data-change="rem-on" data-key="${r.key}" ${r.on ? 'checked' : ''} aria-label="${esc(r.label)}"><span></span></label></div>`).join('')}
    </div>
    <p class="tiny muted" style="margin-top:8px">Plus automatic one-off alerts: craving buffer done, morning lock over, 2-hour gap over.</p>
  </section>`;
}

function appearanceSection(s) {
  return `<section class="card">
    ${cardHead('Appearance', null)}
    <div class="seg" role="group" aria-label="Theme">${['system', 'light', 'dark'].map((t) => `<button type="button" data-action="theme" data-v="${t}" aria-pressed="${s.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
  </section>`;
}

function dataSection() {
  return `<section class="card">
    ${cardHead('Your data', null, 'Stored on this device')}
    <p class="small muted">Everything stays in this browser. Export a backup now and then — and to move to a new phone.</p>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn" data-action="export">${icon('download')}Export</button>
      <label class="btn">${icon('upload')}Import<input type="file" accept="application/json,.json" data-change="import" hidden></label>
      <button class="btn danger" data-action="reset">${icon('trash')}Reset</button>
    </div>
  </section>`;
}

export function render() {
  const s = getState().settings;
  return `<div class="stack">
    ${notifySection(s)}
    ${planSection(s)}
    ${scheduleSection(s)}
    ${appearanceSection(s)}
    ${dataSection()}
    <p class="tiny muted" style="padding:0 4px">Track is a personal habit tool, not medical advice. If you have heart, liver or blood-pressure conditions, or severe withdrawal symptoms, talk to a doctor before changing your routine.</p>
  </div>`;
}

const NUM = { baseline: [0, 100, 1], waterTargetL: [1, 6, 0.25], alcoholMax: [0, 10, 1] };

function changed() {
  settingsChanged();
}

export const changes = {
  setting: (el) => {
    const key = el.dataset.key;
    let v = el.value;
    if (NUM[key]) {
      const [min, max, step] = NUM[key];
      v = Number(v);
      if (!Number.isFinite(v)) return;
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
    } else if (el.type === 'time' && !isValidTime(v)) return;
    else if (el.type === 'date' && !isValidKey(v)) return;
    update((s) => { s.settings[key] = v; });
    changed();
  },
  'rem-on': (el) => {
    update((s) => { s.settings.reminders[el.dataset.key] = { ...s.settings.reminders[el.dataset.key], on: el.checked }; });
    changed();
  },
  'rem-time': (el) => {
    if (!isValidTime(el.value)) return;
    update((s) => { s.settings.reminders[el.dataset.key] = { ...s.settings.reminders[el.dataset.key], time: el.value }; });
    changed();
  },
  import: async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      importJson(await file.text());
      changed();
      toast('Backup restored');
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
  },
};

export const settingsActions = {
  'day-toggle': (el) => {
    const key = el.dataset.key;
    const d = Number(el.dataset.d);
    update((s) => {
      const cur = new Set(s.settings[key]);
      if (key === 'waistDays') s.settings[key] = cur.has(d) ? [] : [d];
      else {
        cur.has(d) ? cur.delete(d) : cur.add(d);
        s.settings[key] = [...cur].sort();
      }
    });
    changed();
  },
  theme: (el) => update((s) => { s.settings.theme = el.dataset.v; }),
  'notify-on': async (el) => {
    el.disabled = true;
    try {
      const res = await enableNotifications();
      if (res.push) toast('Push reminders scheduled ✓');
      else if (res.pushError) toast(`Local reminders on. Push failed: ${res.pushError}`);
      else toast('Reminders on (in-app mode)');
    } catch (err) {
      toast(err.message);
    }
    update(() => {});
  },
  'notify-off': async () => {
    await disableNotifications();
    toast('Notifications off');
  },
  'notify-test': async () => {
    try {
      const how = await sendTest();
      toast(how === 'push' ? 'Test push sent — check your notifications' : 'Test notification shown');
    } catch (err) {
      toast(err.message);
    }
  },
  'notify-resync': () => syncPush({ force: true }).then(() => toast('Schedules synced')).catch((e) => toast(e.message)),
  export: () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `track-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  reset: async () => {
    const ok = await confirmDialog('Reset everything?', '<p class="muted">This deletes all logs and settings on this device. Export a backup first if you might want them.</p>', 'Delete all', 'danger');
    if (!ok) return;
    if (mode() !== 'off') await disableNotifications();
    resetAll();
    toast('All data cleared');
  },
};
