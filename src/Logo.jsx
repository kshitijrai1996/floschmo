import { useEffect, useId, useRef } from 'react';

// FloSchmo mark: an app-icon tile holding a 2D density contour plot whose
// innermost population is an eye. At rest it throws a half-lidded side-eye;
// when the cursor moves, the pupil follows it. It also blinks now and then.
const BLOB = 'M-21,-3C-21,-15 -8,-21 5,-19C17,-17 23,-6 21,5C19,16 7,21 -5,19C-16,17 -21,9 -21,-3Z';
const EYE = { cx: 31, cy: 34, r: 6.6 };
const REST = { x: 3.4, y: 1.2 };   // resting gaze (the side-eye)
const MAX_OFFSET = 3.1;            // keeps the pupil inside the sclera

export default function SchmoLogo({ size = 38, interactive = true }) {
  const uid = useId().replace(/:/g, '');
  const bg = `sbg${uid}`, sheen = `ssh${uid}`, clip = `scl${uid}`;
  const svgRef = useRef(null);
  const pupilRef = useRef(null);

  useEffect(() => {
    if (!interactive) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const pupil = pupilRef.current;
    let idle = 0;

    const look = (x, y) => { pupil.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`; };
    const rest = () => look(REST.x, REST.y);

    const onMove = (e) => {
      const svg = svgRef.current;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const ex = r.left + (EYE.cx / 64) * r.width;
      const ey = r.top + (EYE.cy / 64) * r.height;
      const dx = e.clientX - ex, dy = e.clientY - ey;
      const dist = Math.hypot(dx, dy) || 1;
      // Full deflection once the cursor is ~1.5 logo-widths away; proportional when closer.
      const k = Math.min(1, dist / (r.width * 1.5)) * MAX_OFFSET;
      look((dx / dist) * k, (dy / dist) * k);
      clearTimeout(idle);
      idle = setTimeout(rest, 2600);
    };
    const onLeave = () => { clearTimeout(idle); rest(); };

    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      clearTimeout(idle);
    };
  }, [interactive]);

  const rings = [
    { s: 1, o: 0.32 },
    { s: 0.74, o: 0.58 },
    { s: 0.5, o: 0.9 },
  ];

  return (
    <svg ref={svgRef} className="schmo-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="FloSchmo logo">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0c3d55" />
          <stop offset="0.55" stopColor="#11789a" />
          <stop offset="1" stopColor="#22b8c8" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}><circle cx={EYE.cx} cy={EYE.cy} r={EYE.r} /></clipPath>
      </defs>

      {/* Tile */}
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${bg})`} />
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${sheen})`} />

      {/* Outlier events */}
      <circle cx="14" cy="15" r="1.6" fill="#fff" opacity="0.5" />
      <circle cx="50" cy="13" r="1.25" fill="#fff" opacity="0.4" />
      <circle cx="53" cy="48" r="1.8" fill="#fff" opacity="0.55" />
      <circle cx="12" cy="50" r="1.2" fill="#fff" opacity="0.35" />
      <circle cx="44" cy="55" r="1" fill="#fff" opacity="0.3" />

      {/* Density contours */}
      {rings.map(({ s, o }) => (
        <path key={s} d={BLOB} fill="none" stroke="#fff" strokeOpacity={o}
          strokeWidth={2.3 / s} strokeLinejoin="round"
          transform={`translate(31 34) rotate(-22) scale(${s})`} />
      ))}

      {/* The eye */}
      <circle cx={EYE.cx} cy={EYE.cy} r={EYE.r} fill="#fff" />
      <g clipPath={`url(#${clip})`}>
        <g ref={pupilRef} className="schmo-pupil" style={{ transform: `translate(${REST.x}px, ${REST.y}px)` }}>
          <circle cx={EYE.cx} cy={EYE.cy} r="3.4" fill="#0a2f42" />
          <circle cx={EYE.cx + 1.2} cy={EYE.cy - 1.1} r="1" fill="#fff" />
        </g>
        {/* Skeptical half-lid; slides down to blink */}
        <path className="schmo-lid" d="M23 10 H40 V31.6 Q31 33.4 23 31.2 Z" fill="#0f6a88" />
      </g>
      <path className="schmo-lid" d="M24.2 31.4 Q31 33.3 37.8 31.5" fill="none" stroke="#0a2f42" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
