import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { getColumn } from './fcsParser';
import { resolveAxis, scaleTicks, scaleMinorTicks, formatTick } from './scales';
import { computeGateMask } from './gateUtils';
import { gaussianSmooth } from './smoothing';
import { sampleColor } from './palette';

const WIDTH = 620;
const ROW_H = 70;
const MARGIN = { top: 12, right: 16, bottom: 50, left: 160 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const NUM_BINS = 512;


export default function StackedHistogram({ files, paramName, scale, cofactor, normalize, xMin, xMax, gate }) {
  const svgRef = useRef(null);

  const fileSeries = files
    .map((f, fi) => {
      const idx = f.parsed.params.findIndex(p => p.name === paramName);
      if (idx < 0) return null;
      return { fileName: f.name, fileIdx: fi, parsed: f.parsed, paramIdx: idx, range: f.parsed.params[idx].range };
    })
    .filter(Boolean);

  const range = fileSeries.length > 0 ? Math.max(...fileSeries.map(s => s.range)) : 1;
  const { lo: xLo, hi: xHi, scale: s } = resolveAxis(scale, xMin, xMax, range, cofactor);
  const tMin = s.transform(xLo);
  const tMax = s.transform(xHi);
  const xToPixel = (v) => ((s.transform(v) - tMin) / (tMax - tMin)) * PLOT_W;

  const totalH = MARGIN.top + Math.max(1, fileSeries.length) * ROW_H + MARGIN.bottom;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const plot = svg.select('g.d3-layer');
    plot.selectAll('*').remove();

    if (fileSeries.length === 0) {
      plot.append('text').attr('x', PLOT_W / 2).attr('y', ROW_H / 2)
        .attr('text-anchor', 'middle').attr('fill', '#666')
        .text(`No files contain parameter "${paramName}"`);
      return;
    }

    // Compute per-file mask if a gate is selected. Gate is applied by geometric definition
    // to each file's parsed data (works when files share parameter layout).
    const perFileMask = fileSeries.map(fs => {
      if (!gate) return null;
      try { return computeGateMask(fs.parsed, gate); } catch { return null; }
    });
    const perFileGatedN = perFileMask.map((m, i) => {
      if (!m) return fileSeries[i].parsed.totalEvents;
      let c = 0; for (let k = 0; k < m.length; k++) c += m[k]; return c;
    });

    // Compute bins + normalized values per file (respecting per-file mask if gated)
    const allValues = fileSeries.map((fs, fi) => {
      const col = getColumn(fs.parsed, fs.paramIdx);
      const mask = perFileMask[fi];
      const bins = new Uint32Array(NUM_BINS);
      for (let i = 0; i < col.length; i++) {
        if (mask && !mask[i]) continue;
        const t = s.transform(col[i]);
        const idx = Math.floor(((t - tMin) / (tMax - tMin)) * NUM_BINS);
        if (idx >= 0 && idx < NUM_BINS) bins[idx]++;
      }
      const smoothed = gaussianSmooth(bins, 4);
      if (normalize === 'modal') {
        let peak = 0;
        for (let k = 0; k < smoothed.length; k++) if (smoothed[k] > peak) peak = smoothed[k];
        if (!peak) peak = 1;
        const out = new Float32Array(smoothed.length);
        for (let k = 0; k < smoothed.length; k++) out[k] = smoothed[k] / peak;
        return out;
      } else if (normalize === 'area') {
        let total = 0;
        for (let k = 0; k < smoothed.length; k++) total += smoothed[k];
        if (!total) total = 1;
        const out = new Float32Array(smoothed.length);
        for (let k = 0; k < smoothed.length; k++) out[k] = smoothed[k] / total;
        return out;
      }
      return smoothed;
    });

    // For 'counts' mode, share the y-scale across rows so heights are comparable;
    // for 'modal'/'area', each row peaks at its own normalized max which is also shared.
    let sharedYMax = 0;
    for (const arr of allValues) for (let k = 0; k < arr.length; k++) if (arr[k] > sharedYMax) sharedYMax = arr[k];
    if (!sharedYMax) sharedYMax = 1;

    const binW = PLOT_W / NUM_BINS;
    const rowPlotH = ROW_H - 14; // leave room for label & baseline

    fileSeries.forEach((s, i) => {
      const yTop = i * ROW_H;
      const color = sampleColor(s.fileIdx);
      const rowG = plot.append('g').attr('class', 'stacked-row').attr('transform', `translate(0,${yTop})`);

      // File name label (left of plot area)
      rowG.append('text')
        .attr('x', -8).attr('y', rowPlotH / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', 11)
        .attr('fill', '#222')
        .text(truncate(s.fileName, 24));

      // Event count (shows gated / total if a gate is applied)
      const total = s.parsed.totalEvents;
      const gatedN = perFileGatedN[i];
      const countLabel = gate
        ? `${gatedN.toLocaleString()} / ${total.toLocaleString()}`
        : `${total.toLocaleString()} events`;
      rowG.append('text')
        .attr('x', -8).attr('y', rowPlotH / 2 + 18)
        .attr('text-anchor', 'end')
        .attr('font-size', 10)
        .attr('fill', '#888')
        .text(countLabel);

      // Baseline
      rowG.append('line')
        .attr('x1', 0).attr('x2', PLOT_W)
        .attr('y1', rowPlotH).attr('y2', rowPlotH)
        .attr('stroke', '#ccc').attr('stroke-width', 1);

      // Smoothed histogram trace (Gaussian-smoothed bins → Catmull-Rom-style spline)
      const values = allValues[i];
      const yToPixel = (v) => rowPlotH - (v / sharedYMax) * rowPlotH;
      const area = d3.area()
        .x((_, j) => (j + 0.5) * binW)
        .y0(rowPlotH)
        .y1(v => yToPixel(v))
        .curve(d3.curveBasis);
      rowG.append('path').attr('d', area(values))
        .attr('fill', color).attr('fill-opacity', 0.35)
        .attr('stroke', color).attr('stroke-width', 1.2);
    });

    // Shared x-axis at the bottom
    const xTicks = scaleTicks(scale, xLo, xHi) || d3.ticks(xLo, xHi, 6);
    const axisY = fileSeries.length * ROW_H;
    const xAxisG = plot.append('g').attr('transform', `translate(0,${axisY})`);
    xAxisG.append('line').attr('x1', 0).attr('x2', PLOT_W).attr('stroke', '#333');
    xAxisG.selectAll('line.minor').data(scaleMinorTicks(scale, xLo, xHi)).enter().append('line')
      .attr('class', 'minor').attr('x1', d => xToPixel(d)).attr('x2', d => xToPixel(d)).attr('y2', 3).attr('stroke', '#333');
    xAxisG.selectAll('g.tick').data(xTicks).enter().append('g').attr('class', 'tick')
      .attr('transform', d => `translate(${xToPixel(d)},0)`)
      .call(g => {
        g.append('line').attr('y2', 5).attr('stroke', '#333');
        g.append('text').attr('y', 18).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#333')
          .text(d => formatTick(d));
      });
    xAxisG.append('text').attr('x', PLOT_W / 2).attr('y', 40)
      .attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#000').text(paramName);
  }, [files, paramName, scale, cofactor, normalize, xLo, xHi, gate]);

  return (
    <svg ref={svgRef} width={WIDTH} height={totalH} viewBox={`0 0 ${WIDTH} ${totalH}`} fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif" style={{ background: '#fff' }}>
      <g className="plot" transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        <g className="d3-layer" />
      </g>
    </svg>
  );
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
