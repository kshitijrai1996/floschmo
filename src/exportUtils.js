// SVG / PNG export helpers. Exports are clean vector files: interactive-only
// elements (resize handles, drag knobs) are stripped, and sizes come from the
// SVG's intrinsic width/height — not its on-screen (responsive) size.

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export function intrinsicSize(svg) {
  return { w: +svg.getAttribute('width'), h: +svg.getAttribute('height') };
}

export function cleanClone(svg) {
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.ui-only').forEach(n => n.remove());
  clone.setAttribute('xmlns', SVG_NS);
  clone.removeAttribute('style');
  clone.removeAttribute('class');
  const { w, h } = intrinsicSize(svg);
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  clone.setAttribute('font-family', FONT);
  return clone;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const serialize = (node) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(node)}`;

export function exportSvgElement(svg, filename) {
  downloadBlob(new Blob([serialize(cleanClone(svg))], { type: 'image/svg+xml' }), filename);
}

export function exportPngElement(svg, filename, scale = 3) {
  const node = cleanClone(svg);
  const { w, h } = intrinsicSize(svg);
  node.setAttribute('width', w);
  node.setAttribute('height', h);
  rasterize(serialize(node), w, h, scale, filename);
}

function rasterize(svgString, w, h, scale, filename) {
  const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => downloadBlob(b, filename), 'image/png');
  };
  img.src = url;
}

// Compose several plots into one figure SVG: a grid with panel letters + titles.
//   items: [{ svg: SVGElement, title: string, subtitle: string }]
export function buildFigure(items, { columns = 2, gap = 28, letters = true } = {}) {
  const TITLE_H = 40;
  const cells = items.map(it => ({ ...it, ...intrinsicSize(it.svg) }));
  const rows = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  const colW = Array.from({ length: columns }, (_, c) => Math.max(0, ...rows.map(r => r[c]?.w || 0)));
  const rowH = rows.map(r => TITLE_H + Math.max(...r.map(c => c.h)));
  const width = colW.reduce((a, b) => a + b, 0) + gap * (columns + 1);
  const height = rowH.reduce((a, b) => a + b, 0) + gap * (rows.length + 1);

  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('width', width);
  root.setAttribute('height', height);
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  root.setAttribute('font-family', FONT);
  const bg = document.createElementNS(SVG_NS, 'rect');
  Object.entries({ width, height, fill: '#fff' }).forEach(([k, v]) => bg.setAttribute(k, v));
  root.appendChild(bg);

  let y = gap, n = 0;
  rows.forEach((row, ri) => {
    let x = gap;
    row.forEach((cell, ci) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('id', `panel-${String.fromCharCode(65 + n)}`);
      g.setAttribute('transform', `translate(${x},${y})`);

      const addText = (txt, attrs) => {
        const t = document.createElementNS(SVG_NS, 'text');
        Object.entries(attrs).forEach(([k, v]) => t.setAttribute(k, v));
        t.textContent = txt;
        g.appendChild(t);
      };
      if (letters) addText(String.fromCharCode(65 + n), { x: 0, y: 18, 'font-size': 20, 'font-weight': 700, fill: '#000' });
      const tx = letters ? 26 : 0;
      addText(cell.title, { x: tx, y: 15, 'font-size': 13, 'font-weight': 700, fill: '#111' });
      if (cell.subtitle) addText(cell.subtitle, { x: tx, y: 31, 'font-size': 10.5, fill: '#666' });

      const plot = cleanClone(cell.svg);
      plot.setAttribute('x', 0);
      plot.setAttribute('y', TITLE_H);
      plot.setAttribute('width', cell.w);
      plot.setAttribute('height', cell.h);
      plot.removeAttribute('xmlns');
      g.appendChild(plot);

      root.appendChild(g);
      x += colW[ci] + gap;
      n++;
    });
    y += rowH[ri] + gap;
  });
  return root;
}

export function exportFigure(items, opts, filename = 'floschmo-figure', format = 'svg') {
  const fig = buildFigure(items, opts);
  if (format === 'png') {
    rasterize(serialize(fig), +fig.getAttribute('width'), +fig.getAttribute('height'), 2, `${filename}.png`);
  } else {
    downloadBlob(new Blob([serialize(fig)], { type: 'image/svg+xml' }), `${filename}.svg`);
  }
}
