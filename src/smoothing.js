// Gaussian smoothing for histogram bins — this is the technique FlowJo uses
// under the hood to get its smooth-looking histograms. Convolves the binned
// counts with a Gaussian kernel of width `sigma` bins, then callers draw the
// result as a spline path.

export function gaussianSmooth(bins, sigma = 3) {
  const n = bins.length;
  if (sigma <= 0) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = bins[i];
    return out;
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) acc += kernel[k + radius] * bins[j];
    }
    out[i] = acc;
  }
  return out;
}
