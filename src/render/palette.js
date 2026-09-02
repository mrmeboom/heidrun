// Theme — cream background + a small pastel set, applied as CSS custom
// properties so pill/DOM UI and canvas drawing derive from the same source
// Editable from the system menu.
import { getPalette } from '../state/canvasState.js';

export function applyPaletteToCSS() {
  const palette = getPalette();
  const root = document.documentElement.style;
  root.setProperty('--bg', palette.background);
  palette.pastels.forEach((c, i) => root.setProperty(`--pastel-${i}`, c));
}

/** Each object gets a random pastel at creation time (state/object.js's colorIndex) — read it back here. */
export function colorForObject(obj) {
  const palette = getPalette();
  const idx = obj.colorIndex ?? 0;
  return palette.pastels[idx % palette.pastels.length];
}
