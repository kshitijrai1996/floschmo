// Compute a Uint8 mask (length = totalEvents) of which events fall inside a gate.
import { getColumn } from './fcsParser';

// Resolve a parameter by name first (so gates transfer between samples whose
// parameter order differs), falling back to the stored index.
export function resolveParam(parsed, idx, name) {
  if (name) {
    const i = parsed.params.findIndex(p => p.name === name);
    if (i >= 0) return i;
  }
  return idx;
}

// "Gate N" with the next unused number (ignores quadrants and renamed gates).
export function nextGateName(gates) {
  let max = 0;
  for (const g of gates) {
    const m = /^Gate (\d+)$/.exec(g.name || '');
    if (m) max = Math.max(max, +m[1]);
  }
  return `Gate ${max + 1}`;
}

// Unique id for a new gate (or quadrant group). Time-based so ids from a saved
// workspace never collide with ones created later; the counter separates gates
// made within the same millisecond.
let gateCounter = 0;
export function newGateId(prefix = 'gate') {
  return `${prefix}-${Date.now()}-${++gateCounter}`;
}

// Depth-first ordering of the gate tree, so lists and table columns read
// parent → children. Returns [{ gate, depth }].
export function flattenGateTree(gates) {
  const out = [];
  const ids = new Set(gates.map(g => g.id));
  const visit = (g, depth) => {
    out.push({ gate: g, depth });
    gates.filter(c => c.parentId === g.id).forEach(c => visit(c, depth + 1));
  };
  gates.filter(g => !g.parentId || !ids.has(g.parentId)).forEach(g => visit(g, 0));
  return out;
}

// Stamp parameter names onto a gate (idempotent). Called whenever gates change.
export function withParamNames(gate, parsed) {
  if (!parsed) return gate;
  const nameOf = (i) => parsed.params[i]?.name;
  if (gate.type === 'linear') {
    return gate.paramName ? gate : { ...gate, paramName: nameOf(gate.paramIndex) };
  }
  if (gate.xName && gate.yName) return gate;
  return { ...gate, xName: nameOf(gate.xParam), yName: nameOf(gate.yParam) };
}

export function computeGateMask(parsed, gate) {
  const N = parsed.totalEvents;
  const mask = new Uint8Array(N);

  if (gate.type === 'rect' || gate.type === 'polygon' || gate.type === 'quad') {
    const xi = resolveParam(parsed, gate.xParam, gate.xName);
    const yi = resolveParam(parsed, gate.yParam, gate.yName);
    if (xi == null || yi == null || xi >= parsed.par || yi >= parsed.par) return mask;
    const xCol = getColumn(parsed, xi);
    const yCol = getColumn(parsed, yi);
    if (gate.type === 'rect') {
      for (let i = 0; i < N; i++) {
        const x = xCol[i], y = yCol[i];
        mask[i] = x >= gate.xMin && x <= gate.xMax && y >= gate.yMin && y <= gate.yMax ? 1 : 0;
      }
    } else if (gate.type === 'polygon') {
      const pts = gate.points;
      for (let i = 0; i < N; i++) mask[i] = pointInPolygon(xCol[i], yCol[i], pts) ? 1 : 0;
    } else {
      // Quadrant: gate.quadrant is one of '++', '-+', '+-', '--' (x sign, y sign)
      const wantXHi = gate.quadrant[0] === '+';
      const wantYHi = gate.quadrant[1] === '+';
      for (let i = 0; i < N; i++) {
        const xHi = xCol[i] >= gate.cx, yHi = yCol[i] >= gate.cy;
        mask[i] = (xHi === wantXHi && yHi === wantYHi) ? 1 : 0;
      }
    }
  } else if (gate.type === 'linear') {
    const pi = resolveParam(parsed, gate.paramIndex, gate.paramName);
    if (pi == null || pi >= parsed.par) return mask;
    const col = getColumn(parsed, pi);
    for (let i = 0; i < N; i++) {
      mask[i] = col[i] >= gate.min && col[i] <= gate.max ? 1 : 0;
    }
  }
  return mask;
}

// Ray casting point-in-polygon test
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function countMask(mask) {
  let c = 0;
  for (let i = 0; i < mask.length; i++) c += mask[i];
  return c;
}

// Given a flat list of gates (each optionally carrying `parentId`), returns
// `{ [gateId]: combinedMask }` where each combined mask is the intersection of
// the gate's own mask AND every ancestor's own mask — matching FlowJo's
// hierarchy semantics (a child is "inside" its parent).
export function computeCombinedMasks(parsed, gates) {
  const N = parsed.totalEvents;
  const own = {};
  for (const g of gates) own[g.id] = computeGateMask(parsed, g);

  const gateById = Object.fromEntries(gates.map(g => [g.id, g]));
  const chainCache = {};
  const chainOf = (id) => {
    if (chainCache[id]) return chainCache[id];
    const chain = [];
    let cur = gateById[id];
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      chain.push(cur.id);
      seen.add(cur.id);
      cur = cur.parentId ? gateById[cur.parentId] : null;
    }
    return (chainCache[id] = chain);
  };

  const combined = {};
  for (const g of gates) {
    const chain = chainOf(g.id);
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      let inAll = 1;
      for (const cid of chain) if (!own[cid][i]) { inAll = 0; break; }
      mask[i] = inAll;
    }
    combined[g.id] = mask;
  }
  return combined;
}

// All descendants (recursively) of gateId, plus gateId itself.
export function descendantIds(gateId, gates) {
  const out = [gateId];
  let queue = [gateId];
  while (queue.length) {
    const next = [];
    for (const pid of queue) {
      for (const g of gates) {
        if (g.parentId === pid) { out.push(g.id); next.push(g.id); }
      }
    }
    queue = next;
  }
  return out;
}

// Compute statistics for a single parameter, optionally restricted by mask.
// Returns: { n, mean, geoMean, median, sd, cv, rcv, min, max }
//   geoMean uses only strictly-positive values (silently skips non-positive); n_geo reports how many were used.
//   cv = sd / mean * 100 (percent); rcv = MAD-based robust CV.
export function computeStats(parsed, paramIndex, mask) {
  const col = getColumn(parsed, paramIndex);
  const values = [];
  for (let i = 0; i < col.length; i++) {
    if (!mask || mask[i]) values.push(col[i]);
  }
  if (values.length === 0) return null;

  const n = values.length;
  let sum = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;

  let sqSum = 0;
  for (let i = 0; i < n; i++) sqSum += (values[i] - mean) ** 2;
  const sd = Math.sqrt(sqSum / Math.max(1, n - 1));
  const cv = mean !== 0 ? Math.abs(sd / mean) * 100 : NaN;

  // Geometric mean — only positive values
  let logSum = 0, n_geo = 0;
  for (let i = 0; i < n; i++) {
    if (values[i] > 0) { logSum += Math.log(values[i]); n_geo++; }
  }
  const geoMean = n_geo > 0 ? Math.exp(logSum / n_geo) : NaN;

  // Median + MAD-based robust CV
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const absDev = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = absDev[Math.floor(n / 2)];
  // rCV ≈ 1.4826 * MAD / median (×100 for percent)
  const rcv = median !== 0 ? Math.abs(1.4826 * mad / median) * 100 : NaN;

  return { n, mean, geoMean, median, sd, cv, rcv, min, max, n_geo };
}

export function fmt(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  if (abs >= 1e5 || (abs > 0 && abs < 0.01)) return x.toExponential(2);
  return x.toFixed(digits);
}
