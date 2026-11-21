// Regenerates the PNG app icons in public/ from the FloSchmo logo.
// Only needed if the logo changes:
//
//   npm install --no-save sharp
//   node scripts/make-icons.mjs
//
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BLOB = 'M-21,-3C-21,-15 -8,-21 5,-19C17,-17 23,-6 21,5C19,16 7,21 -5,19C-16,17 -21,9 -21,-3Z';

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c3d55"/>
      <stop offset="0.55" stop-color="#11789a"/>
      <stop offset="1" stop-color="#22b8c8"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.18"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="eye"><circle cx="31" cy="34" r="6.6"/></clipPath>
  </defs>`;

// Everything that sits on the tile: outlier dots, contour rings, the eye.
const artwork = `
  <circle cx="14" cy="15" r="1.6" fill="#fff" opacity="0.5"/>
  <circle cx="50" cy="13" r="1.25" fill="#fff" opacity="0.4"/>
  <circle cx="53" cy="48" r="1.8" fill="#fff" opacity="0.55"/>
  <circle cx="12" cy="50" r="1.2" fill="#fff" opacity="0.35"/>
  <circle cx="44" cy="55" r="1" fill="#fff" opacity="0.3"/>
  <path d="${BLOB}" fill="none" stroke="#fff" stroke-opacity="0.32" stroke-width="2.3" stroke-linejoin="round" transform="translate(31 34) rotate(-22)"/>
  <path d="${BLOB}" fill="none" stroke="#fff" stroke-opacity="0.58" stroke-width="3.1" stroke-linejoin="round" transform="translate(31 34) rotate(-22) scale(0.74)"/>
  <path d="${BLOB}" fill="none" stroke="#fff" stroke-opacity="0.9" stroke-width="4.6" stroke-linejoin="round" transform="translate(31 34) rotate(-22) scale(0.5)"/>
  <circle cx="31" cy="34" r="6.6" fill="#fff"/>
  <g clip-path="url(#eye)">
    <circle cx="34.4" cy="35.2" r="3.4" fill="#0a2f42"/>
    <circle cx="35.6" cy="34.1" r="1" fill="#fff"/>
    <path d="M23 10 H40 V31.6 Q31 33.4 23 31.2 Z" fill="#0f6a88"/>
  </g>
  <path d="M24.2 31.4 Q31 33.3 37.8 31.5" fill="none" stroke="#0a2f42" stroke-width="1.3" stroke-linecap="round"/>`;

// Rounded tile on a transparent background (browser tabs, desktop shortcuts).
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#bg)"/>
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#sheen)"/>${artwork}
</svg>`;

// Full-bleed square with the artwork inside the central "safe zone" — the OS
// applies its own mask (circle, squircle…) to these.
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" fill="url(#bg)"/>
  <rect width="64" height="64" fill="url(#sheen)"/>
  <g transform="translate(32 32) scale(0.82) translate(-32 -32)">${artwork}</g>
</svg>`;

const targets = [
  ['public/favicon.svg', rounded, null],
  ['public/icon-192.png', rounded, 192],
  ['public/icon-512.png', rounded, 512],
  ['public/icon-maskable-512.png', fullBleed, 512],
  ['public/apple-touch-icon.png', fullBleed, 180],
];

for (const [file, svg, size] of targets) {
  if (size === null) {
    writeFileSync(file, svg.trim() + '\n');
  } else {
    await sharp(Buffer.from(svg), { density: 72 * (size / 64) * 2 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(file);
  }
  console.log('wrote', file);
}
