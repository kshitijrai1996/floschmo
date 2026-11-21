// Scale transforms shared by every plot component.
// Supported: 'linear' | 'log' | 'biexp' (asinh-based, FlowJo-like).
// 'asinh' is accepted as an alias for 'biexp' for backward-compat with saved state.

// `logFloor` is the smallest value a log axis can represent: anything at or
// below it (including zero and negative values, which have no logarithm) is
// drawn at the floor, i.e. piled up at the low end of the axis.
export function makeScale(kind, cofactor = 150, logFloor = 1) {
  if (kind === 'log') {
    const floor = logFloor > 0 ? logFloor : 1;
    return {
      transform: (v) => Math.log10(Math.max(v, floor)),
      inverse: (t) => Math.pow(10, t),
    };
  }
  if (kind === 'biexp' || kind === 'asinh') {
    return {
      transform: (v) => Math.asinh(v / cofactor),
      inverse: (t) => Math.sinh(t) * cofactor,
    };
  }
  return {
    transform: (v) => v,
    inverse: (t) => t,
  };
}

// Default axis window for a given scale + parameter range from FCS metadata.
export function scaleDefaults(kind, paramRange) {
  if (kind === 'log') return { min: 1, max: paramRange };
  if (kind === 'biexp' || kind === 'asinh') return { min: -1000, max: paramRange };
  return { min: 0, max: paramRange };
}

// Why a user-entered axis limit can't be used, or null if it is fine.
export function axisLimitProblem(kind, min, max) {
  if (kind === 'log' && Number.isFinite(min) && min <= 0) return 'A log axis needs a minimum above 0 (e.g. 0.1)';
  if (kind === 'log' && Number.isFinite(max) && max <= 0) return 'A log axis needs a maximum above 0';
  if (Number.isFinite(min) && Number.isFinite(max) && max <= min) return 'The maximum must be larger than the minimum';
  return null;
}

// Turn optional user limits into the window an axis actually uses.
// Unset or unusable limits fall back to the scale's defaults, so a half-typed
// or impossible value never breaks the plot.
//   → { lo, hi, scale: { transform, inverse } }
export function resolveAxis(kind, min, max, paramRange, cofactor) {
  const def = scaleDefaults(kind, paramRange);
  const isLog = kind === 'log';
  let lo = Number.isFinite(min) && !(isLog && min <= 0) ? min : def.min;
  let hi = Number.isFinite(max) && !(isLog && max <= 0) ? max : def.max;
  if (!(hi > lo)) {
    // Keep whichever limit the user set and default the other one.
    if (Number.isFinite(min) && def.max > lo) hi = def.max;
    else if (Number.isFinite(max) && def.min < hi) lo = def.min;
    else { lo = def.min; hi = def.max; }
  }
  // A log axis starting below 1 must be able to show values below 1.
  const scale = makeScale(kind, cofactor, isLog ? Math.min(1, lo) : 1);
  return { lo, hi, scale };
}

// Nicely-placed axis ticks for a given scale + window.
// Returns null for linear (caller should use d3.ticks).
export function scaleTicks(kind, min, max) {
  if (kind === 'log') {
    const lo = min > 0 ? min : 1;
    const hi = max > lo ? max : lo * 10;
    const s = Math.ceil(Math.log10(lo) - 1e-9);
    const e = Math.floor(Math.log10(hi) + 1e-9);
    const ticks = [];
    for (let i = s; i <= e; i++) ticks.push(Math.pow(10, i));
    // A window narrower than one decade has no power of ten inside it.
    return ticks.length ? ticks : [lo, hi];
  }
  if (kind === 'biexp' || kind === 'asinh') {
    const candidates = [-1e6, -1e5, -1e4, -1000, -100, 0, 100, 1000, 1e4, 1e5, 1e6];
    return candidates.filter(v => v >= min && v <= max);
  }
  return null;
}

// Unlabelled minor ticks. On a log axis these are 2…9 within each decade,
// which is what shows where an axis starts when the limit isn't a power of ten.
export function scaleMinorTicks(kind, min, max) {
  if (kind !== 'log' || !(min > 0) || !(max > min)) return [];
  const first = Math.floor(Math.log10(min));
  const last = Math.ceil(Math.log10(max));
  if (last - first > 12) return []; // absurdly wide axis: skip
  const ticks = [];
  for (let e = first; e < last; e++) {
    const decade = Math.pow(10, e);
    for (let m = 2; m <= 9; m++) {
      const v = m * decade;
      if (v >= min && v <= max) ticks.push(v);
    }
  }
  return ticks;
}

export function formatTick(v) {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6) return +(v / 1e6).toPrecision(3) + 'M';
  if (abs >= 1000) return +(v / 1000).toPrecision(3) + 'K';
  if (abs >= 0.001) return String(+v.toPrecision(3));   // 0.5, 0.01, 2.5 …
  return v.toExponential(0);                            // 1e-4 and smaller
}
