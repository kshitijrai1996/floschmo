import * as d3 from 'd3';

// Renders event dots (and optional contours) into a d3 selection, in pixel space.
// Modes:
//   'density' — FlowJo-style pseudocolor: each dot colored by local 2D density
//   'contour' — light grey dots + density contour lines
//   'dots'    — single-color dots
// Everything stays vector: dots are grouped into one <path> per color level, so
// exported SVGs remain light and fully editable in Illustrator.

const LEVELS = 40;
const DOT_SIZE = 1.9;

// Pseudocolor ramp: deep blue → cyan → green → yellow → orange → red.
const PSEUDO = d3.scaleLinear()
  .domain([0, 0.2, 0.42, 0.62, 0.8, 1])
  .range(['#1f3fbf', '#1fa3e0', '#2dbf5a', '#f2e21b', '#f58a1f', '#d7191c'])
  .interpolate(d3.interpolateLab);

function blur2d(grid, gx, gy, sigma) {
  const radius = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); sum += w; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;

  const tmp = new Float32Array(gx * gy);
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      let acc = 0;
      for (let j = -radius; j <= radius; j++) {
        const xx = x + j;
        if (xx >= 0 && xx < gx) acc += k[j + radius] * grid[y * gx + xx];
      }
      tmp[y * gx + x] = acc;
    }
  }
  const out = new Float32Array(gx * gy);
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      let acc = 0;
      for (let j = -radius; j <= radius; j++) {
        const yy = y + j;
        if (yy >= 0 && yy < gy) acc += k[j + radius] * tmp[yy * gx + x];
      }
      out[y * gx + x] = acc;
    }
  }
  return out;
}

function dotPath(xs, ys, idxs) {
  let s = '';
  for (const i of idxs) s += `M${xs[i].toFixed(1)},${ys[i].toFixed(1)}h0.01`;
  return s;
}

export function renderEvents(layer, xs, ys, W, H, mode = 'density') {
  const n = xs.length;
  if (n === 0) return;
  const g = layer.append('g').attr('class', 'events');

  const dotAttrs = (sel) => sel
    .attr('fill', 'none')
    .attr('stroke-width', DOT_SIZE)
    .attr('stroke-linecap', 'round');

  if (mode === 'dots') {
    const all = Array.from({ length: n }, (_, i) => i);
    g.append('path').attr('d', dotPath(xs, ys, all))
      .call(dotAttrs).attr('stroke', '#2a5ea8').attr('stroke-opacity', 0.55);
    return;
  }

  // 2D density on a grid with ~3.75 px cells, Gaussian-smoothed.
  const gx = 128;
  const gy = Math.max(8, Math.round(gx * H / W));
  const cx = W / gx, cy = H / gy;
  const raw = new Float32Array(gx * gy);
  const cell = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const ix = Math.min(gx - 1, Math.max(0, Math.floor(xs[i] / cx)));
    const iy = Math.min(gy - 1, Math.max(0, Math.floor(ys[i] / cy)));
    cell[i] = iy * gx + ix;
    raw[cell[i]]++;
  }
  const dens = blur2d(raw, gx, gy, 1.6);
  let max = 0;
  for (let i = 0; i < dens.length; i++) if (dens[i] > max) max = dens[i];
  if (!max) max = 1;

  if (mode === 'contour') {
    const all = Array.from({ length: n }, (_, i) => i);
    g.append('path').attr('d', dotPath(xs, ys, all))
      .call(dotAttrs).attr('stroke', '#9aa6b2').attr('stroke-opacity', 0.45);

    // Log-spaced contour levels, like FlowJo's "probability contours".
    const thresholds = [0.02, 0.05, 0.1, 0.18, 0.3, 0.45, 0.62, 0.8].map(f => f * max);
    const contours = d3.contours().size([gx, gy]).thresholds(thresholds)(dens);
    const proj = d3.geoTransform({ point(x, y) { this.stream.point(x * cx, y * cy); } });
    const path = d3.geoPath(proj);
    g.append('g').attr('class', 'contours').selectAll('path').data(contours).enter().append('path')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', '#1d3557')
      .attr('stroke-width', 0.9)
      .attr('stroke-linejoin', 'round');
    return;
  }

  // Pseudocolor: bucket points by density level, draw low → high so dense cores sit on top.
  const buckets = Array.from({ length: LEVELS }, () => []);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(dens[cell[i]] / max, 0.5); // sqrt lifts sparse regions out of the floor
    buckets[Math.min(LEVELS - 1, Math.floor(t * LEVELS))].push(i);
  }
  buckets.forEach((idxs, lvl) => {
    if (!idxs.length) return;
    g.append('path').attr('d', dotPath(xs, ys, idxs))
      .call(dotAttrs)
      .attr('stroke', PSEUDO((lvl + 0.5) / LEVELS));
  });
}
