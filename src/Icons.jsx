// Minimal stroke icon set (Lucide-style, 24x24 grid).
const PATHS = {
  rect: <rect x="4" y="5" width="16" height="14" rx="1.5" />,
  polygon: <path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z" />,
  linear: <><path d="M3 12h18" /><path d="M7 8l-4 4 4 4" /><path d="M17 8l4 4-4 4" /></>,
  scatter: <><path d="M3 3v18h18" /><circle cx="8" cy="15" r="1.2" /><circle cx="12" cy="10" r="1.2" /><circle cx="16" cy="13" r="1.2" /><circle cx="18" cy="7" r="1.2" /></>,
  histogram: <><path d="M3 3v18h18" /><path d="M7 21c2-9 3-13 5-13s3 4 5 13" /></>,
  stacked: <><path d="M3 21h18" /><path d="M4 8c3 0 3-4 6-4s3 4 6 4 3 0 4 0" /><path d="M4 14c3 0 3-4 6-4s3 4 6 4 3 0 4 0" /><path d="M4 20c3 0 3-4 6-4s3 4 6 4 3 0 4 0" /></>,
  upload: <><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>,
  file: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></>,
  gate: <><path d="M4 4h6v6H4z" /><path d="M14 14h6v6h-6z" /><path d="M7 10v7h7" /></>,
  close: <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>,
  download: <><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-9 9" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  reset: <><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  sliders: <><path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" /><path d="M2 14h4" /><path d="M10 8h4" /><path d="M18 16h4" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M9 4v16" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  save: <><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></>,
  folder: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  history: <><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 3" /></>,
  quad: <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M12 3v18" /><path d="M3 12h18" /></>,
  matrix: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /></>,
  layout: <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.9 4.9l1.4 1.4" /><path d="M17.7 17.7l1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="M4.9 19.1l1.4-1.4" /><path d="M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.2 9.2a2.9 2.9 0 015.6 1c0 1.9-2.8 2.4-2.8 4.1" /><path d="M12 17.5h.01" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" /></>,
  sparkle: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01" /><path d="M10 10h.01" /><path d="M14 10h.01" /><path d="M18 10h.01" /><path d="M7 14h10" /></>,
  drop: <><path d="M12 3v11" /><path d="M7 10l5 5 5-5" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>,
};

export default function Icon({ name, size = 16, strokeWidth = 1.8, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
