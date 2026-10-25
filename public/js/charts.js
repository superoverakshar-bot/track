// Hand-rolled SVG charts: thin marks, hairline grid, one y-axis, crosshair tooltip,
// legend for 2+ series and a data table behind every chart.
import { esc, shortDate } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => n <= s + 1e-9);
  return step * pow;
}

function ticks(min, max, count = 4, integer = false) {
  const span = max - min;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw;
  if (integer) step = Math.max(1, Math.ceil(step));
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// Column with a 4px rounded data end, square at the baseline.
function columnPath(x, y0, w, y1) {
  const h = y0 - y1;
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
}

function observe(host, draw) {
  host._draw = draw;
  if (!host._ro) {
    let w = host.clientWidth;
    host._ro = new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - w) > 4) {
        w = host.clientWidth;
        host._draw?.();
      }
    });
    host._ro.observe(host);
  }
  draw();
}

function legendHtml(series) {
  if (series.length < 2) return '';
  return `<div class="legend">${series.map((s) => `<span><i class="${s.kind === 'column' ? '' : 'line'}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

function tableHtml(cfg) {
  const rows = cfg.keys.filter((k) => cfg.series.some((s) => s.values[k] != null));
  if (!rows.length) return '';
  const head = `<tr><th>${esc(cfg.xName || 'Date')}</th>${cfg.series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr>`;
  const body = rows.slice().reverse().map((k) => `<tr><td>${esc(cfg.xLabel(k, true))}</td>${cfg.series.map((s) => `<td>${s.values[k] == null ? '—' : esc(s.fmt(s.values[k]))}</td>`).join('')}</tr>`).join('');
  return `<details class="chart-table"><summary>Show data table</summary><div class="scroll"><table>${head}${body}</table></div></details>`;
}

/**
 * keys: ordered day keys for the x axis
 * series: [{ name, kind: 'column'|'line'|'step', color, values: { key: number }, fmt, colorFor?, connect? }]
 */
export function timeChart(host, opts) {
  const cfg = {
    height: 180,
    yMaxMin: 1,
    xLabel: (k) => shortDate(k),
    endLabel: true,
    ...opts,
  };
  cfg.series = cfg.series.map((s) => ({ fmt: (v) => String(v), ...s }));
  host.innerHTML = `${legendHtml(cfg.series)}<div class="chart" tabindex="0" role="img" aria-label="${esc(cfg.label || '')}"></div>${tableHtml(cfg)}`;
  const box = host.querySelector('.chart');
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;

  const draw = () => {
    box.innerHTML = '';
    box.append(tip);
    const W = Math.max(260, box.clientWidth || host.clientWidth || 320);
    const H = cfg.height;
    const m = { t: 12, r: cfg.endLabel ? 44 : 10, b: 22, l: 34 };
    const n = cfg.keys.length;
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const all = cfg.series.flatMap((s) => cfg.keys.map((k) => s.values[k]).filter((v) => v != null));
    const yMin = cfg.yMin ?? 0;
    let yMax = cfg.yMax ?? niceMax(Math.max(cfg.yMaxMin, ...all));
    if (cfg.integer) yMax = Math.max(1, Math.ceil(yMax));
    const band = pw / Math.max(n, 1);
    const cx = (i) => m.l + band * (i + 0.5);
    const y = (v) => m.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, 'aria-hidden': 'true' }, box);
    const grid = el('g', { class: 'grid' }, svg);
    for (const t of ticks(yMin, yMax, 4, cfg.integer)) {
      const yy = Math.round(y(t)) + 0.5;
      if (t !== yMin) el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy }, grid);
      const label = el('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end' }, svg);
      label.textContent = cfg.yTick ? cfg.yTick(t) : String(t);
    }
    const base = Math.round(y(yMin)) + 0.5;
    el('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: base, y2: base }, svg);

    const want = Math.max(2, Math.min(6, Math.floor(pw / 70)));
    const idx = n <= 1 ? [0] : [...new Set(Array.from({ length: want }, (_, i) => Math.round((i * (n - 1)) / (want - 1))))];
    for (const i of idx) {
      if (!cfg.keys[i]) continue;
      const anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
      const x = anchor === 'start' ? m.l : anchor === 'end' ? W - m.r : cx(i);
      const t = el('text', { x, y: H - 6, 'text-anchor': anchor }, svg);
      t.textContent = cfg.xLabel(cfg.keys[i]);
    }

    for (const s of cfg.series) {
      if (s.kind === 'column') {
        const w = Math.max(1, Math.min(24, band - 2, band * 0.72));
        cfg.keys.forEach((k, i) => {
          const v = s.values[k];
          if (v == null || v <= yMin) return;
          const d = columnPath(cx(i) - w / 2, y(yMin), w, y(v));
          if (d) el('path', { d, fill: s.colorFor?.(v, k) || s.color, class: 'col' }, svg);
        });
      } else if (s.kind === 'step') {
        let d = '';
        cfg.keys.forEach((k, i) => {
          const v = s.values[k];
          if (v == null) return;
          const x0 = m.l + band * i;
          const yy = y(v);
          d += `${d ? 'L' : 'M'}${x0},${yy}H${x0 + band}`;
        });
        if (d) el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      } else {
        const pts = cfg.keys.map((k, i) => (s.values[k] == null ? null : [cx(i), y(s.values[k]), k])).filter(Boolean);
        if (pts.length > 1) {
          el('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(''), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
        }
        const dots = pts.length <= 12 ? pts : pts.slice(-1);
        for (const p of dots) el('circle', { cx: p[0], cy: p[1], r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
        const last = pts[pts.length - 1];
        if (cfg.endLabel && last && cfg.series.length === 1) {
          const t = el('text', { x: last[0] + 8, y: last[1] + 4, class: 'endlabel' }, svg);
          t.textContent = s.fmt(s.values[last[2]]);
        }
      }
    }

    // hover layer
    const cross = el('line', { class: 'crosshair', y1: m.t, y2: m.t + ph, visibility: 'hidden' }, svg);
    const hit = el('rect', { class: 'hit', x: m.l, y: 0, width: pw, height: H }, svg);
    let cur = -1;
    const showAt = (i) => {
      if (i < 0 || i >= n) return;
      cur = i;
      const k = cfg.keys[i];
      const x = Math.round(cx(i)) + 0.5;
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const head = document.createElement('div');
      head.className = 't-head';
      head.textContent = cfg.xLabel(k, true);
      tip.append(head);
      for (const s of cfg.series) {
        const row = document.createElement('div');
        row.className = 't-row';
        const key = document.createElement('i');
        key.style.background = s.values[k] != null ? (s.colorFor?.(s.values[k], k) || s.color) : s.color;
        const val = document.createElement('b');
        val.textContent = s.values[k] == null ? '—' : s.fmt(s.values[k]);
        const name = document.createElement('span');
        name.textContent = s.name;
        row.append(key, val, name);
        tip.append(row);
      }
      cfg.tipExtra?.(k, tip);
      tip.hidden = false;
      const scale = svg.getBoundingClientRect().width / W || 1;
      const px = cx(i) * scale;
      let left = px + 12;
      if (left + tip.offsetWidth > box.clientWidth) left = Math.max(0, px - tip.offsetWidth - 12);
      tip.style.left = `${left}px`;
      tip.style.top = '0px';
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const i = Math.min(n - 1, Math.max(0, Math.floor((x - m.l) / band)));
      // Snap to the nearest day that has a value so sparse series never read "—".
      let best = i;
      for (let d = 0; d < n; d++) {
        const hit = [i - d, i + d].find((j) => j >= 0 && j < n && cfg.series.some((s) => s.values[cfg.keys[j]] != null));
        if (hit != null) { best = hit; break; }
      }
      showAt(best);
    });
    hit.addEventListener('pointerleave', hide);
    box.onkeydown = (e) => {
      if (e.key === 'ArrowRight') showAt(Math.min(n - 1, cur + 1));
      else if (e.key === 'ArrowLeft') showAt(Math.max(0, cur < 0 ? n - 1 : cur - 1));
      else if (e.key === 'Escape') hide();
      else return;
      e.preventDefault();
    };
    box.onfocus = () => showAt(cur >= 0 ? cur : n - 1);
    box.onblur = hide;
  };
  observe(host, draw);
}

/**
 * GitHub-style calendar of the 90 program days. values: { key: 0..5 }
 */
export function heatmap(host, { keys, values, todayKey, describe }) {
  const first = keys[0];
  const [y, mo, d] = first.split('-').map(Number);
  const lead = (new Date(y, mo - 1, d).getDay() + 6) % 7; // Monday-first rows
  const cols = Math.ceil((lead + keys.length) / 7);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  keys.forEach((k) => {
    const v = values[k];
    const future = k > todayKey;
    const cls = ['cell', future ? 'future' : '', k === todayKey ? 'today' : ''].join(' ').trim();
    const style = future || v == null ? '' : `style="background:var(--heat-${v})"`;
    cells.push(`<button class="${cls}" ${style} data-k="${k}" aria-label="${esc(describe(k, v, future))}"></button>`);
  });
  host.innerHTML = `<div class="chart"><div class="heat" style="grid-template-rows:repeat(7,1fr);grid-auto-flow:column;grid-template-columns:repeat(${cols},1fr);max-width:${cols * 26}px">${cells.join('')}</div></div>
    <div class="heat-legend"><span>0</span>${[0, 1, 2, 3, 4, 5].map((i) => `<i style="background:var(--heat-${i})"></i>`).join('')}<span>5 of 5 done</span></div>`;
  const box = host.querySelector('.chart');
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  box.append(tip);
  const show = (btn) => {
    tip.textContent = btn.getAttribute('aria-label');
    tip.hidden = false;
    const br = btn.getBoundingClientRect();
    const hr = box.getBoundingClientRect();
    tip.style.left = `${Math.min(br.left - hr.left, hr.width - tip.offsetWidth)}px`;
    tip.style.top = `${br.bottom - hr.top + 6}px`;
  };
  box.addEventListener('pointerover', (e) => { const b = e.target.closest('.cell'); if (b) show(b); });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
  box.addEventListener('focusin', (e) => { const b = e.target.closest('.cell'); if (b) show(b); });
  box.addEventListener('focusout', () => { tip.hidden = true; });
}
