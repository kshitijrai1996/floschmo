// Fluorescence compensation.
//
// Spillover matrix S (n×n): row i = fluorochrome i, column j = detector j.
// S[i][j] = fraction of fluorochrome i's signal that lands in detector j (S[i][i] = 1).
// Observed  = True · S   (row vectors)   ⇒   True = Observed · S⁻¹
import { getColumn } from './fcsParser';

const SCATTER_RE = /^(FSC|SSC|Time)/i;

// Fluorescence area parameters in a sample (what compensation operates on).
export function fluorChannels(parsed) {
  return parsed.params.map(p => p.name).filter(n => !SCATTER_RE.test(n) && /-A$/.test(n));
}

// Parse $SPILLOVER / SPILL keyword: "n,name1..namen,v11,v12,...,vnn"
export function parseSpillover(meta) {
  const raw = meta?.['$SPILLOVER'] || meta?.['SPILL'] || meta?.['$SPILL'];
  if (!raw) return null;
  const parts = raw.split(',').map(s => s.trim());
  const n = parseInt(parts[0], 10);
  if (!n || parts.length < 1 + n + n * n) return null;
  const channels = parts.slice(1, 1 + n);
  const vals = parts.slice(1 + n).map(Number);
  const matrix = channels.map((_, i) => channels.map((_, j) => vals[i * n + j]));
  return { channels, matrix };
}

export function identity(n) {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

export function isIdentity(m) {
  return m.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9));
}

// Gauss–Jordan inversion with partial pivoting.
export function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...identity(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error('Spillover matrix is singular');
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f) for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map(row => row.slice(n));
}

function median(arr) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(col, q) {
  const s = Float64Array.from(col).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

// Compute a spillover matrix from single-stain controls.
//   controls: { [channelName]: parsed }   (one single-stained sample per fluorochrome)
//   unstained: parsed | null             (negative reference; optional)
// Positive population = control events brighter than the unstained 99.5th
// percentile in the primary channel (falls back to the top 10% of the control).
// Negative reference = unstained events (falls back to the control's bottom 25%).
// S[i][j] = (med_j(pos) − med_j(neg)) / (med_i(pos) − med_i(neg))
export function computeSpillover(channels, controls, unstained) {
  const n = channels.length;
  const S = identity(n);
  const report = [];

  channels.forEach((chI, i) => {
    const ctl = controls[chI];
    if (!ctl) { report.push({ channel: chI, status: 'no control — left as identity' }); return; }
    const idx = (parsed, name) => parsed.params.findIndex(p => p.name === name);
    const iCol = getColumn(ctl, idx(ctl, chI));

    let negSel, posSel;
    if (unstained && idx(unstained, chI) >= 0) {
      const thr = quantile(getColumn(unstained, idx(unstained, chI)), 0.995);
      posSel = [];
      for (let e = 0; e < iCol.length; e++) if (iCol[e] > thr) posSel.push(e);
      negSel = null; // use unstained medians
    }
    if (!posSel || posSel.length < 50) {
      const hi = quantile(iCol, 0.9);
      posSel = [];
      for (let e = 0; e < iCol.length; e++) if (iCol[e] >= hi) posSel.push(e);
    }
    if (!unstained || idx(unstained, chI) < 0) {
      const lo = quantile(iCol, 0.25);
      negSel = [];
      for (let e = 0; e < iCol.length; e++) if (iCol[e] <= lo) negSel.push(e);
    }

    const medPos = (name) => { const c = getColumn(ctl, idx(ctl, name)); return median(posSel.map(e => c[e])); };
    const medNeg = (name) => {
      if (negSel) { const c = getColumn(ctl, idx(ctl, name)); return median(negSel.map(e => c[e])); }
      const u = idx(unstained, name);
      return u >= 0 ? median(Array.from(getColumn(unstained, u))) : 0;
    };

    const denom = medPos(chI) - medNeg(chI);
    if (!(denom > 0)) { report.push({ channel: chI, status: 'no positive signal — left as identity' }); return; }
    channels.forEach((chJ, j) => {
      if (j === i || idx(ctl, chJ) < 0) return;
      S[i][j] = (medPos(chJ) - medNeg(chJ)) / denom;
    });
    report.push({ channel: chI, status: `${posSel.length.toLocaleString()} positive events` });
  });

  return { matrix: S, report };
}

// Return a compensated copy of a parsed sample (only the matrix channels change).
export function compensate(parsed, comp) {
  if (!comp?.enabled || !comp.channels?.length) return parsed;
  const idxs = comp.channels.map(ch => parsed.params.findIndex(p => p.name === ch));
  if (idxs.some(i => i < 0)) return parsed;
  const inv = invert(comp.matrix);
  const n = idxs.length, par = parsed.par, N = parsed.totalEvents;
  const src = parsed.events;
  const out = new Float32Array(src);
  const raw = new Float64Array(n);
  for (let e = 0; e < N; e++) {
    const base = e * par;
    for (let i = 0; i < n; i++) raw[i] = src[base + idxs[i]];
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let i = 0; i < n; i++) acc += raw[i] * inv[i][j];
      out[base + idxs[j]] = acc;
    }
  }
  return { ...parsed, events: out, compensated: true };
}
