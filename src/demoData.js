// Synthetic demo dataset — generated in the browser, no real data involved.
// Four samples shaped like a typical two-colour reporter experiment:
// debris, singlets and doublets in scatter; GFP / mCherry with known spillover
// (GFP→mCherry 12%, mCherry→GFP 3%) so compensation can be tried out too.

export const DEMO_PREFIX = 'Demo_';
export const isDemoName = (name) => name.startsWith(DEMO_PREFIX);

const PARAMS = ['FSC-A', 'FSC-H', 'FSC-W', 'SSC-A', 'GFP-A', 'mCherry-A', 'Time'];
const RANGE = 262144;
const SPILL = { gfpToMch: 0.12, mchToGfp: 0.03 };

// Small seeded PRNG (mulberry32) so the demo looks identical on every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSample(name, seed, { gfp = false, mch = false, linked = false, n = 12000 }) {
  const rand = rng(seed);
  const norm = (mean = 0, sd = 1) => {
    const u = Math.max(rand(), 1e-12), v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const logn = (median, sdlog) => Math.exp(norm(Math.log(median), sdlog));
  const clampScatter = (v) => Math.min(RANGE - 1, Math.max(0, v));

  const par = PARAMS.length;
  const events = new Float32Array(n * par);

  for (let i = 0; i < n; i++) {
    const u = rand();
    let fscA, fscH, fscW, sscA, isCell = true;

    if (u < 0.10) {            // debris
      isCell = false;
      fscA = logn(9000, 0.5);
      sscA = logn(7000, 0.6);
      fscH = fscA * 0.75 * (1 + norm(0, 0.06));
      fscW = 80000 * (1 + norm(0, 0.10));
    } else if (u < 0.17) {     // doublets: more area for the same height
      fscA = norm(200000, 26000);
      sscA = fscA * Math.exp(norm(-0.2, 0.30));
      fscH = fscA * 0.50 * (1 + norm(0, 0.05));
      fscW = 215000 * (1 + norm(0, 0.06));
    } else {                   // singlets
      fscA = norm(112000, 20000);
      sscA = fscA * Math.exp(norm(-0.25, 0.28));
      fscH = fscA * 0.72 * (1 + norm(0, 0.035));
      fscW = 150000 * (1 + norm(0, 0.05));
    }

    // True fluorochrome signal
    let g = 0, m = 0;
    if (isCell) {
      const expresses = rand() < 0.72;
      if (linked) {
        // Dual reporter: both colours scale with the same expression level.
        if (expresses) {
          g = logn(16000, 1.15);
          m = Math.pow(g, 0.92) * Math.exp(norm(Math.log(1.1), 0.42));
        }
      } else {
        if (gfp && expresses) g = logn(18000, 1.10);
        if (mch && expresses) m = logn(9000, 1.00);
      }
    }
    // Observed = autofluorescence + signal + spillover, with a little measurement noise
    const gfpObs = norm(60, 45) + (g + SPILL.mchToGfp * m) * (1 + norm(0, 0.03));
    const mchObs = norm(40, 40) + (m + SPILL.gfpToMch * g) * (1 + norm(0, 0.03));

    const b = i * par;
    events[b] = clampScatter(fscA);
    events[b + 1] = clampScatter(fscH);
    events[b + 2] = clampScatter(fscW);
    events[b + 3] = clampScatter(sscA);
    events[b + 4] = Math.min(RANGE - 1, gfpObs);
    events[b + 5] = Math.min(RANGE - 1, mchObs);
    events[b + 6] = (i / n) * 4500;
  }

  return {
    name,
    parsed: {
      version: 'synthetic',
      params: PARAMS.map(p => ({ name: p, stain: '', range: RANGE, bits: 32, voltage: '' })),
      events,
      totalEvents: n,
      par,
      meta: { $CYT: 'FloSchmo demo generator' },
    },
  };
}

export function generateDemoFiles() {
  return [
    makeSample(`${DEMO_PREFIX}Unstained.fcs`, 11, {}),
    makeSample(`${DEMO_PREFIX}GFP_only.fcs`, 22, { gfp: true }),
    makeSample(`${DEMO_PREFIX}mCherry_only.fcs`, 33, { mch: true }),
    makeSample(`${DEMO_PREFIX}Dual_reporter_library.fcs`, 44, { linked: true, n: 20000 }),
  ];
}
