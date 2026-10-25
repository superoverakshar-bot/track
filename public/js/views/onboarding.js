import { capSteps, isValidKey, isValidTime } from '../plan.js';
import { getState, update } from '../store.js';
import { esc } from '../ui.js';

export function render() {
  const s = getState().settings;
  return `<main class="onboard">
    <img class="logo" src="/icons/icon-192.png" alt="">
    <div><h1>Your 90-day reset</h1>
    <p class="muted" style="margin-top:6px">Taper Tansen, rebuild stamina, tighten the waist and steady your energy — one day at a time.</p></div>
    <div class="pillars">
      <div><b><span class="pillar-dot" style="background:var(--p-taper)"></span>Taper</b>Daily cap, 90-min morning lock, 15-min urge buffer</div>
      <div><b><span class="pillar-dot" style="background:var(--p-move)"></span>Mileage</b>Max distance in a fixed 30 minutes</div>
      <div><b><span class="pillar-dot" style="background:var(--p-strength)"></span>Strength</b>Micro-sets, M/W/F circuits, waist log</div>
      <div><b><span class="pillar-dot" style="background:var(--p-fuel)"></span>Fuel</b>Sprouts, paneer, 4 PM shield, 2.5-h cutoff</div>
    </div>
    <form class="card form-grid" data-submit="onboard">
      <label class="field"><span>Start date</span><input class="input" name="startDate" type="date" value="${esc(s.startDate)}" required></label>
      <label class="field"><span>Pouches / day now</span><input class="input" name="baseline" type="number" min="0" max="100" inputmode="numeric" value="${s.baseline}" required></label>
      <label class="field"><span>Usual wake time</span><input class="input" name="wakeTime" type="time" value="${s.wakeTime}" required></label>
      <label class="field"><span>Usual bedtime</span><input class="input" name="sleepTime" type="time" value="${s.sleepTime}" required></label>
      <label class="field full"><span>Daily 30-min walk at</span><input class="input" name="walkTime" type="time" value="${s.walkTime}" required></label>
      <p class="full small muted" id="cap-preview">Your caps: ${capSteps(s.baseline).join(' → ')} over 90 days.</p>
      <button class="btn primary block full" type="submit">Start my 90 days</button>
    </form>
    <p class="tiny muted">Data stays on this device. Not medical advice — check with a doctor if you have heart, liver or blood-pressure concerns.</p>
  </main>`;
}

export function mount(root) {
  const input = root.querySelector('[name="baseline"]');
  const preview = root.querySelector('#cap-preview');
  input?.addEventListener('input', () => {
    preview.textContent = `Your caps: ${capSteps(Number(input.value) || 0).join(' → ')} over 90 days.`;
  });
}

export const submits = {
  onboard: (form) => {
    const f = form.elements;
    if (!isValidKey(f.startDate.value) || !isValidTime(f.wakeTime.value) || !isValidTime(f.sleepTime.value) || !isValidTime(f.walkTime.value)) return;
    update((s) => {
      Object.assign(s.settings, {
        startDate: f.startDate.value,
        baseline: Math.max(0, Math.min(100, Math.round(Number(f.baseline.value) || 0))),
        wakeTime: f.wakeTime.value,
        sleepTime: f.sleepTime.value,
        walkTime: f.walkTime.value,
        onboarded: true,
      });
    });
    location.hash = '#today';
  },
};
