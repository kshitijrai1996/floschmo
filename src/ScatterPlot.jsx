import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { getColumn } from './fcsParser';
import { resolveAxis, scaleTicks, scaleMinorTicks, formatTick } from './scales';
import { renderEvents } from './density';
import { nextGateName, newGateId } from './gateUtils';

const WIDTH = 560;
const HEIGHT = 480;
const MARGIN = { top: 20, right: 20, bottom: 50, left: 60 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const POLY_CLOSE_DIST = 10; // px

export default function ScatterPlot({
  parsed,
  xParam,
  yParam,
  xScale,
  yScale,
  xMin, xMax, yMin, yMax,
  cofactor,
  mask,
  displayMode,
  parentGateId,
  gatePct = {},
  gates,
  activeGateId,
  onGatesChange,
  onActiveGateChange,
  drawTool,
}) {
  const svgRef = useRef(null);
  const [drawing, setDrawing] = useState(null);

  const xCol = getColumn(parsed, xParam);
  const yCol = getColumn(parsed, yParam);
  const px = parsed.params[xParam];
  const py = parsed.params[yParam];

  const { lo: xLo, hi: xHi, scale: xS } = resolveAxis(xScale, xMin, xMax, px.range, cofactor);
  const { lo: yLo, hi: yHi, scale: yS } = resolveAxis(yScale, yMin, yMax, py.range, cofactor);
  const xtLo = xS.transform(xLo), xtHi = xS.transform(xHi);
  const ytLo = yS.transform(yLo), ytHi = yS.transform(yHi);

  const xToPixel = (v) => ((xS.transform(v) - xtLo) / (xtHi - xtLo)) * PLOT_W;
  const yToPixel = (v) => PLOT_H - ((yS.transform(v) - ytLo) / (ytHi - ytLo)) * PLOT_H;
  const pixelToX = (p) => xS.inverse((p / PLOT_W) * (xtHi - xtLo) + xtLo);
  const pixelToY = (p) => yS.inverse(((PLOT_H - p) / PLOT_H) * (ytHi - ytLo) + ytLo);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const plot = svg.select('g.d3-layer');
    plot.selectAll('*').remove();

    const xTicks = scaleTicks(xScale, xLo, xHi) || d3.ticks(xLo, xHi, 6);
    const yTicks = scaleTicks(yScale, yLo, yHi) || d3.ticks(yLo, yHi, 6);

    const xAxisG = plot.append('g').attr('transform', `translate(0,${PLOT_H})`);
    xAxisG.append('line').attr('x1', 0).attr('x2', PLOT_W).attr('stroke', '#333');
    xAxisG.selectAll('line.minor').data(scaleMinorTicks(xScale, xLo, xHi)).enter().append('line')
      .attr('class', 'minor').attr('x1', d => xToPixel(d)).attr('x2', d => xToPixel(d)).attr('y2', 3).attr('stroke', '#333');
    xAxisG.selectAll('g.tick').data(xTicks).enter().append('g').attr('class', 'tick')
      .attr('transform', d => `translate(${xToPixel(d)},0)`)
      .call(g => {
        g.append('line').attr('y2', 5).attr('stroke', '#333');
        g.append('text').attr('y', 18).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#333')
          .text(d => formatTick(d));
      });
    xAxisG.append('text').attr('x', PLOT_W / 2).attr('y', 40).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#000').text(px.name);

    const yAxisG = plot.append('g');
    yAxisG.append('line').attr('y1', 0).attr('y2', PLOT_H).attr('stroke', '#333');
    yAxisG.selectAll('line.minor').data(scaleMinorTicks(yScale, yLo, yHi)).enter().append('line')
      .attr('class', 'minor').attr('y1', d => yToPixel(d)).attr('y2', d => yToPixel(d)).attr('x2', -3).attr('stroke', '#333');
    yAxisG.selectAll('g.tick').data(yTicks).enter().append('g').attr('class', 'tick')
      .attr('transform', d => `translate(0,${yToPixel(d)})`)
      .call(g => {
        g.append('line').attr('x2', -5).attr('stroke', '#333');
        g.append('text').attr('x', -8).attr('y', 3).attr('text-anchor', 'end').attr('font-size', 10).attr('fill', '#333')
          .text(d => formatTick(d));
      });
    yAxisG.append('text')
      .attr('transform', `translate(-45,${PLOT_H / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#000').text(py.name);

    const N = parsed.totalEvents;
    const xs = [], ys = [];
    for (let i = 0; i < N; i++) {
      if (mask && !mask[i]) continue;
      const x = xToPixel(xCol[i]);
      const y = yToPixel(yCol[i]);
      if (!(x >= 0 && x <= PLOT_W && y >= 0 && y <= PLOT_H)) continue;
      xs.push(x); ys.push(y);
    }
    renderEvents(plot, xs, ys, PLOT_W, PLOT_H, displayMode || 'density');
  }, [parsed, xParam, yParam, xScale, yScale, cofactor, mask, xLo, xHi, yLo, yHi, displayMode]);

  // Map client (screen) coords → plot coords. The SVG may be scaled by CSS in
  // the responsive grid, so divide out the rendered/intrinsic size ratio.
  const toPlot = (clientX, clientY, rect = svgRef.current.getBoundingClientRect()) => {
    const k = WIDTH / rect.width;
    return [(clientX - rect.left) * k - MARGIN.left, (clientY - rect.top) * k - MARGIN.top];
  };

  // -- Mouse handlers --
  const handleMouseDown = (e) => {
    const [mx, my] = toPlot(e.clientX, e.clientY);
    if (mx < 0 || mx > PLOT_W || my < 0 || my > PLOT_H) return;
    const isBg = e.target.tagName === 'svg' || e.target.classList.contains('plot-bg');
    if (!isBg) return;

    if (drawTool === 'quad') {
      createQuadrants(mx, my);
      return;
    }

    if (drawTool === 'rect') {
      setDrawing({ type: 'rect', startX: mx, startY: my, currentX: mx, currentY: my });
    } else if (drawTool === 'polygon') {
      // Polygon uses click-to-add-point; mouseDown adds a point
      setDrawing(prev => {
        if (!prev || prev.type !== 'polygon') {
          return { type: 'polygon', points: [{ x: mx, y: my }], hover: { x: mx, y: my } };
        }
        // Check close-to-start to finish polygon
        const first = prev.points[0];
        if (prev.points.length >= 3 && Math.hypot(mx - first.x, my - first.y) < POLY_CLOSE_DIST) {
          finishPolygon(prev.points);
          return null;
        }
        return { ...prev, points: [...prev.points, { x: mx, y: my }] };
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!drawing) return;
    const [rx, ry] = toPlot(e.clientX, e.clientY);
    const mx = Math.max(0, Math.min(PLOT_W, rx));
    const my = Math.max(0, Math.min(PLOT_H, ry));
    if (drawing.type === 'rect') {
      setDrawing({ ...drawing, currentX: mx, currentY: my });
    } else if (drawing.type === 'polygon') {
      setDrawing({ ...drawing, hover: { x: mx, y: my } });
    }
  };

  const handleMouseUp = () => {
    if (!drawing || drawing.type !== 'rect') return;
    const x1 = Math.min(drawing.startX, drawing.currentX);
    const x2 = Math.max(drawing.startX, drawing.currentX);
    const y1 = Math.min(drawing.startY, drawing.currentY);
    const y2 = Math.max(drawing.startY, drawing.currentY);
    if (x2 - x1 > 5 && y2 - y1 > 5) {
      const newGate = {
        id: newGateId(),
        name: nextGateName(gates),
        type: 'rect',
        parentId: parentGateId || null,
        xParam, yParam, xScale, yScale,
        xMin: pixelToX(x1), xMax: pixelToX(x2),
        yMin: pixelToY(y2), yMax: pixelToY(y1),
      };
      onGatesChange([...gates, newGate]);
      onActiveGateChange(newGate.id);
    }
    setDrawing(null);
  };

  const handleDoubleClick = () => {
    if (drawing && drawing.type === 'polygon' && drawing.points.length >= 3) {
      finishPolygon(drawing.points);
      setDrawing(null);
    }
  };

  const finishPolygon = (pixelPoints) => {
    const dataPoints = pixelPoints.map(p => ({ x: pixelToX(p.x), y: pixelToY(p.y) }));
    const newGate = {
      id: newGateId(),
      name: nextGateName(gates),
      type: 'polygon',
      parentId: parentGateId || null,
      xParam, yParam, xScale, yScale,
      points: dataPoints,
    };
    onGatesChange([...gates, newGate]);
    onActiveGateChange(newGate.id);
  };

  // Quadrant tool: one click → four linked gates sharing a `groupId` and center.
  const createQuadrants = (mx, my) => {
    const cx = pixelToX(mx), cy = pixelToY(my);
    const short = (n) => (n || '').replace(/-[AHW]$/, '');
    const xn = short(px.name), yn = short(py.name);
    const groupId = newGateId('quad');
    const quads = [['-+', 'Q1'], ['++', 'Q2'], ['+-', 'Q3'], ['--', 'Q4']].map(([q, tag], i) => ({
      id: `${groupId}-${i}`,
      groupId,
      name: `${tag} ${xn}${q[0] === '+' ? '+' : '−'} ${yn}${q[1] === '+' ? '+' : '−'}`,
      type: 'quad',
      quadrant: q,
      parentId: parentGateId || null,
      xParam, yParam, xScale, yScale,
      cx, cy,
    }));
    // Deliberately leave the current selection alone. A quadrant set has no
    // single "the" gate, and jumping the statistics to one of the four (which
    // may well be empty) is confusing. Click a quadrant label to select it.
    onGatesChange([...gates, ...quads]);
  };

  // ESC cancels in-progress polygon
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setDrawing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startGateDrag = (gateId, mode, e) => {
    e.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    const [startMx, startMy] = toPlot(e.clientX, e.clientY, rect);
    const gate = gates.find(g => g.id === gateId);
    const startGate = JSON.parse(JSON.stringify(gate));
    onActiveGateChange(gateId);

    const onMove = (ev) => {
      const [mx, my] = toPlot(ev.clientX, ev.clientY, rect);
      const dx = mx - startMx;
      const dy = my - startMy;

      if (gate.type === 'quad') {
        // Moving the crosshair moves all four linked quadrants together.
        const ncx = pixelToX(Math.max(0, Math.min(PLOT_W, xToPixel(startGate.cx) + dx)));
        const ncy = pixelToY(Math.max(0, Math.min(PLOT_H, yToPixel(startGate.cy) + dy)));
        onGatesChange(gates.map(g => g.groupId === gate.groupId ? { ...g, cx: ncx, cy: ncy } : g));
      } else if (gate.type === 'rect') {
        const x1px = xToPixel(startGate.xMin);
        const x2px = xToPixel(startGate.xMax);
        const y1px = yToPixel(startGate.yMax);
        const y2px = yToPixel(startGate.yMin);

        let nx1 = x1px, nx2 = x2px, ny1 = y1px, ny2 = y2px;
        if (mode === 'move') { nx1 += dx; nx2 += dx; ny1 += dy; ny2 += dy; }
        else if (mode === 'l') nx1 += dx;
        else if (mode === 'r') nx2 += dx;
        else if (mode === 't') ny1 += dy;
        else if (mode === 'b') ny2 += dy;
        else if (mode === 'tl') { nx1 += dx; ny1 += dy; }
        else if (mode === 'tr') { nx2 += dx; ny1 += dy; }
        else if (mode === 'bl') { nx1 += dx; ny2 += dy; }
        else if (mode === 'br') { nx2 += dx; ny2 += dy; }

        onGatesChange(gates.map(g => g.id === gateId ? {
          ...g,
          xMin: pixelToX(Math.min(nx1, nx2)),
          xMax: pixelToX(Math.max(nx1, nx2)),
          yMin: pixelToY(Math.max(ny1, ny2)),
          yMax: pixelToY(Math.min(ny1, ny2)),
        } : g));
      } else if (gate.type === 'polygon') {
        if (mode === 'move') {
          const newPts = startGate.points.map(p => ({
            x: pixelToX(xToPixel(p.x) + dx),
            y: pixelToY(yToPixel(p.y) + dy),
          }));
          onGatesChange(gates.map(g => g.id === gateId ? { ...g, points: newPts } : g));
        } else if (typeof mode === 'number') {
          // dragging vertex `mode`
          const newPts = startGate.points.map((p, i) => i === mode ? ({
            x: pixelToX(xToPixel(p.x) + dx),
            y: pixelToY(yToPixel(p.y) + dy),
          }) : p);
          onGatesChange(gates.map(g => g.id === gateId ? { ...g, points: newPts } : g));
        }
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const visibleGates = gates.filter(g =>
    (g.type === 'rect' || g.type === 'polygon') &&
    g.xParam === xParam && g.yParam === yParam
  );

  // One crosshair per quadrant group on these axes.
  const quadGroups = Object.values(
    gates.filter(g => g.type === 'quad' && g.xParam === xParam && g.yParam === yParam)
      .reduce((acc, g) => { (acc[g.groupId] ||= []).push(g); return acc; }, {})
  );

  return (
    <svg
      ref={svgRef}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
      style={{ background: '#fff', cursor: (drawTool === 'polygon' || drawTool === 'quad') ? 'crosshair' : (drawing?.type === 'rect' ? 'crosshair' : 'default'), userSelect: 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      <g className="plot" transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        <g className="d3-layer" />
        <rect className="plot-bg" x="0" y="0" width={PLOT_W} height={PLOT_H} fill="transparent" stroke="#ccc" />
        {visibleGates.map(g => {
          const isActive = g.id === activeGateId;
          // FlowJo convention: black gates with a white halo read on any pseudocolor.
          const stroke = isActive ? '#000000' : '#2b2f36';
          const sw = isActive ? 2 : 1.4;
          const labelProps = {
            fontSize: 11, fontWeight: 600, fill: '#111',
            stroke: '#fff', strokeWidth: 3, paintOrder: 'stroke', strokeLinejoin: 'round',
            pointerEvents: 'none',
          };
          const pct = gatePct[g.id];
          const label = (
            <>
              {g.name}
              {Number.isFinite(pct) && <tspan fontWeight="400" dx="5">{pct.toFixed(1)}%</tspan>}
            </>
          );
          if (g.type === 'rect') {
            const x = xToPixel(g.xMin);
            const w = xToPixel(g.xMax) - xToPixel(g.xMin);
            const y = yToPixel(g.yMax);
            const h = yToPixel(g.yMin) - yToPixel(g.yMax);
            return (
              <g key={g.id} className="gate">
                <rect x={x} y={y} width={w} height={h} fill="none"
                  stroke="#fff" strokeOpacity="0.85" strokeWidth={sw + 2.5} pointerEvents="none" />
                <rect
                  x={x} y={y} width={w} height={h}
                  fill="none" stroke={stroke} strokeWidth={sw}
                  style={{ cursor: 'move' }}
                  onMouseDown={(e) => startGateDrag(g.id, 'move', e)}
                />
                <text x={x + 4} y={y - 5} {...labelProps}>{label}</text>
                {isActive && [
                  ['tl', x, y], ['tr', x + w, y], ['bl', x, y + h], ['br', x + w, y + h],
                  ['t', x + w / 2, y], ['b', x + w / 2, y + h], ['l', x, y + h / 2], ['r', x + w, y + h / 2],
                ].map(([mode, hx, hy]) => (
                  <rect key={mode}
                    x={hx - 4} y={hy - 4} width="8" height="8"
                    className="ui-only" fill="white" stroke={stroke} strokeWidth="1.5"
                    style={{ cursor: cursorFor(mode) }}
                    onMouseDown={(e) => startGateDrag(g.id, mode, e)}
                  />
                ))}
              </g>
            );
          } else if (g.type === 'polygon') {
            const pixPts = g.points.map(p => `${xToPixel(p.x)},${yToPixel(p.y)}`).join(' ');
            const first = g.points[0];
            return (
              <g key={g.id} className="gate">
                <polygon points={pixPts} fill="none"
                  stroke="#fff" strokeOpacity="0.85" strokeWidth={sw + 2.5} strokeLinejoin="round" pointerEvents="none" />
                <polygon
                  points={pixPts}
                  fill="none" stroke={stroke} strokeWidth={sw} strokeLinejoin="round"
                  style={{ cursor: 'move' }}
                  onMouseDown={(e) => startGateDrag(g.id, 'move', e)}
                />
                <text
                  x={xToPixel(first.x) + 4}
                  y={yToPixel(first.y) - 5}
                  {...labelProps}
                >{label}</text>
                {isActive && g.points.map((p, i) => (
                  <rect key={i}
                    x={xToPixel(p.x) - 4} y={yToPixel(p.y) - 4} width="8" height="8"
                    className="ui-only" fill="white" stroke={stroke} strokeWidth="1.5"
                    style={{ cursor: 'move' }}
                    onMouseDown={(e) => startGateDrag(g.id, i, e)}
                  />
                ))}
              </g>
            );
          }
          return null;
        })}
        {quadGroups.map(group => {
          const ref = group[0];
          const qx = Math.max(0, Math.min(PLOT_W, xToPixel(ref.cx)));
          const qy = Math.max(0, Math.min(PLOT_H, yToPixel(ref.cy)));
          const anyActive = group.some(g => g.id === activeGateId);
          const corner = {
            '-+': { x: 6, y: 14, anchor: 'start' },
            '++': { x: PLOT_W - 6, y: 14, anchor: 'end' },
            '--': { x: 6, y: PLOT_H - 7, anchor: 'start' },
            '+-': { x: PLOT_W - 6, y: PLOT_H - 7, anchor: 'end' },
          };
          return (
            <g key={ref.groupId} className="gate quad-gate">
              {[[qx, 0, qx, PLOT_H], [0, qy, PLOT_W, qy]].map(([x1, y1, x2, y2], i) => (
                <g key={i}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeOpacity="0.85" strokeWidth="4" pointerEvents="none" />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#111" strokeWidth={anyActive ? 1.8 : 1.3} pointerEvents="none" />
                </g>
              ))}
              {group.map(g => {
                const c = corner[g.quadrant];
                const isActive = g.id === activeGateId;
                const pct = gatePct[g.id];
                return (
                  <text key={g.id} x={c.x} y={c.y} textAnchor={c.anchor}
                    fontSize="11" fontWeight={isActive ? 700 : 600} fill={isActive ? '#000' : '#222'}
                    stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round"
                    textDecoration={isActive ? 'underline' : 'none'}
                    style={{ cursor: 'pointer' }}
                    onMouseDown={(e) => { e.stopPropagation(); onActiveGateChange(g.id); }}>
                    {g.name.split(' ')[0]}
                    {Number.isFinite(pct) && <tspan fontWeight="400" dx="4">{pct.toFixed(1)}%</tspan>}
                  </text>
                );
              })}
              <circle className="ui-only" cx={qx} cy={qy} r="5.5" fill="#fff" stroke="#111" strokeWidth="1.6"
                style={{ cursor: 'move' }}
                onMouseDown={(e) => startGateDrag(ref.id, 'move', e)} />
            </g>
          );
        })}
        {/* In-progress drawing */}
        {drawing && drawing.type === 'rect' && (
          <rect
            x={Math.min(drawing.startX, drawing.currentX)}
            y={Math.min(drawing.startY, drawing.currentY)}
            width={Math.abs(drawing.currentX - drawing.startX)}
            height={Math.abs(drawing.currentY - drawing.startY)}
            fill="none" stroke="#111" strokeWidth="2" strokeDasharray="4,2"
            pointerEvents="none"
          />
        )}
        {drawing && drawing.type === 'polygon' && (
          <g pointerEvents="none">
            <polyline
              points={[...drawing.points.map(p => `${p.x},${p.y}`),
                       drawing.hover ? `${drawing.hover.x},${drawing.hover.y}` : ''].join(' ')}
              fill="rgba(214,39,40,0.05)" stroke="#111" strokeWidth="2" strokeDasharray="4,2"
            />
            {drawing.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3" fill="#111" />
            ))}
          </g>
        )}
      </g>
    </svg>
  );
}

function cursorFor(mode) {
  return {
    tl: 'nwse-resize', br: 'nwse-resize',
    tr: 'nesw-resize', bl: 'nesw-resize',
    t: 'ns-resize', b: 'ns-resize',
    l: 'ew-resize', r: 'ew-resize',
  }[mode] || 'move';
}
