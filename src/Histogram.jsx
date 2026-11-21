import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { getColumn } from './fcsParser';
import { resolveAxis, scaleTicks, scaleMinorTicks, formatTick } from './scales';
import { gaussianSmooth } from './smoothing';
import { nextGateName, newGateId } from './gateUtils';

const WIDTH = 560;
const HEIGHT = 320;
const MARGIN = { top: 20, right: 20, bottom: 50, left: 60 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export default function Histogram({
  parsed, paramIndex, scale, cofactor, mask,
  xMin, xMax, parentGateId, gatePct = {},
  drawTool, gates, activeGateId,
  onGatesChange, onActiveGateChange,
}) {
  const svgRef = useRef(null);
  const [drawing, setDrawing] = useState(null);

  const param = parsed.params[paramIndex];
  const { lo: xLo, hi: xHi, scale: s } = resolveAxis(scale, xMin, xMax, param.range, cofactor);
  const tMin = s.transform(xLo);
  const tMax = s.transform(xHi);
  const xToPixel = (v) => ((s.transform(v) - tMin) / (tMax - tMin)) * PLOT_W;
  const pixelToX = (p) => s.inverse((p / PLOT_W) * (tMax - tMin) + tMin);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const plot = svg.select('g.d3-layer');
    plot.selectAll('*').remove();

    const col = getColumn(parsed, paramIndex);
    const values = [];
    for (let i = 0; i < col.length; i++) {
      if (!mask || mask[i]) values.push(col[i]);
    }

    if (values.length === 0) {
      plot.append('text').attr('x', PLOT_W / 2).attr('y', PLOT_H / 2)
        .attr('text-anchor', 'middle').attr('fill', '#666').text('No events in gate');
      return;
    }

    const numBins = 512;
    const bins = new Uint32Array(numBins);
    for (let i = 0; i < values.length; i++) {
      const t = s.transform(values[i]);
      const idx = Math.floor(((t - tMin) / (tMax - tMin)) * numBins);
      if (idx >= 0 && idx < numBins) bins[idx]++;
    }
    const smoothed = gaussianSmooth(bins, 4);
    let maxCount = 0;
    for (let i = 0; i < numBins; i++) if (smoothed[i] > maxCount) maxCount = smoothed[i];
    if (maxCount === 0) maxCount = 1;

    const xTicks = scaleTicks(scale, xLo, xHi) || d3.ticks(xLo, xHi, 6);
    const yToPixel = (count) => PLOT_H - (count / maxCount) * PLOT_H;

    const xAxisG = plot.append('g').attr('transform', `translate(0,${PLOT_H})`);
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
      .attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#000').text(param.name);

    const yAxisG = plot.append('g');
    yAxisG.append('line').attr('y1', 0).attr('y2', PLOT_H).attr('stroke', '#333');
    const yTicks = d3.ticks(0, maxCount, 5);
    yAxisG.selectAll('g.tick').data(yTicks).enter().append('g').attr('class', 'tick')
      .attr('transform', d => `translate(0,${yToPixel(d)})`)
      .call(g => {
        g.append('line').attr('x2', -5).attr('stroke', '#333');
        g.append('text').attr('x', -8).attr('y', 3).attr('text-anchor', 'end').attr('font-size', 10).attr('fill', '#333')
          .text(d => d);
      });
    yAxisG.append('text')
      .attr('transform', `translate(-45,${PLOT_H / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#000').text('Count');

    const binW = PLOT_W / numBins;
    const area = d3.area()
      .x((_, i) => (i + 0.5) * binW)
      .y0(PLOT_H)
      .y1(v => yToPixel(v))
      .curve(d3.curveBasis);
    plot.append('path').attr('d', area(smoothed))
      .attr('fill', '#1f77b4').attr('fill-opacity', 0.55)
      .attr('stroke', '#1f77b4').attr('stroke-width', 1.5);
  }, [parsed, paramIndex, scale, cofactor, mask, xLo, xHi]);

  // Client → plot coords, correcting for CSS scaling of the SVG.
  const toPlot = (clientX, clientY, rect = svgRef.current.getBoundingClientRect()) => {
    const k = WIDTH / rect.width;
    return [(clientX - rect.left) * k - MARGIN.left, (clientY - rect.top) * k - MARGIN.top];
  };

  const handleMouseDown = (e) => {
    const [mx, my] = toPlot(e.clientX, e.clientY);
    if (mx < 0 || mx > PLOT_W || my < 0 || my > PLOT_H) return;
    if (drawTool !== 'linear') return;
    const isBg = e.target.tagName === 'svg' || e.target.classList.contains('plot-bg');
    if (!isBg) return;
    setDrawing({ startX: mx, currentX: mx });
  };

  const handleMouseMove = (e) => {
    if (!drawing) return;
    const mx = Math.max(0, Math.min(PLOT_W, toPlot(e.clientX, e.clientY)[0]));
    setDrawing({ ...drawing, currentX: mx });
  };

  const handleMouseUp = () => {
    if (!drawing) return;
    const x1 = Math.min(drawing.startX, drawing.currentX);
    const x2 = Math.max(drawing.startX, drawing.currentX);
    if (x2 - x1 > 5) {
      const newGate = {
        id: newGateId(),
        name: nextGateName(gates),
        type: 'linear',
        parentId: parentGateId || null,
        paramIndex, scale,
        min: pixelToX(x1), max: pixelToX(x2),
      };
      onGatesChange([...gates, newGate]);
      onActiveGateChange(newGate.id);
    }
    setDrawing(null);
  };

  const startGateDrag = (gateId, mode, e) => {
    e.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    const [startMx] = toPlot(e.clientX, e.clientY, rect);
    const gate = gates.find(g => g.id === gateId);
    const startGate = { ...gate };
    onActiveGateChange(gateId);

    const onMove = (ev) => {
      const [mx] = toPlot(ev.clientX, ev.clientY, rect);
      const dx = mx - startMx;
      const x1px = xToPixel(startGate.min);
      const x2px = xToPixel(startGate.max);

      let nx1 = x1px, nx2 = x2px;
      if (mode === 'move') { nx1 += dx; nx2 += dx; }
      else if (mode === 'l') nx1 += dx;
      else if (mode === 'r') nx2 += dx;

      onGatesChange(gates.map(g => g.id === gateId ? {
        ...g,
        min: pixelToX(Math.min(nx1, nx2)),
        max: pixelToX(Math.max(nx1, nx2)),
      } : g));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const visibleLinearGates = (gates || []).filter(g =>
    g.type === 'linear' && g.paramIndex === paramIndex
  );

  return (
    <svg
      ref={svgRef}
      width={WIDTH}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      height={HEIGHT}
      fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
      style={{ background: '#fff', cursor: drawTool === 'linear' ? 'ew-resize' : 'default', userSelect: 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <g className="plot" transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        <g className="d3-layer" />
        <rect className="plot-bg" x="0" y="0" width={PLOT_W} height={PLOT_H} fill="transparent" stroke="#ccc" />
        {visibleLinearGates.map(g => {
          const isActive = g.id === activeGateId;
          const stroke = isActive ? '#d62728' : '#ff7f0e';
          const x1 = xToPixel(g.min);
          const x2 = xToPixel(g.max);
          const w = x2 - x1;
          return (
            <g key={g.id}>
              <rect
                x={x1} y={0} width={w} height={PLOT_H}
                fill={stroke} fillOpacity="0.08"
                stroke={stroke} strokeWidth="1.5"
                style={{ cursor: 'move' }}
                onMouseDown={(e) => startGateDrag(g.id, 'move', e)}
              />
              <text x={x1 + 4} y={14} fontSize="11" fontWeight="600" fill={stroke}
                stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round" pointerEvents="none">
                {g.name}
                {Number.isFinite(gatePct[g.id]) && <tspan fontWeight="400" dx="5">{gatePct[g.id].toFixed(1)}%</tspan>}
              </text>
              {/* Edge handles */}
              <line x1={x1} y1={0} x2={x1} y2={PLOT_H} stroke={stroke} strokeWidth="3"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => startGateDrag(g.id, 'l', e)} />
              <line x1={x2} y1={0} x2={x2} y2={PLOT_H} stroke={stroke} strokeWidth="3"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => startGateDrag(g.id, 'r', e)} />
            </g>
          );
        })}
        {drawing && (
          <rect
            x={Math.min(drawing.startX, drawing.currentX)} y={0}
            width={Math.abs(drawing.currentX - drawing.startX)} height={PLOT_H}
            fill="#d62728" fillOpacity="0.1" stroke="#d62728" strokeWidth="2" strokeDasharray="4,2"
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}

