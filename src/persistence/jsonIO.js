// Copy-to-clipboard / paste-to-load JSON — for backup, moving a layout
// between machines, or sharing a layout.
import { serialize, deserialize } from '../state/canvasState.js';

export function exportJSON() {
  return serialize();
}

export function importJSON(text) {
  deserialize(text);
}

export async function copyExportToClipboard() {
  const text = exportJSON();
  await navigator.clipboard.writeText(text);
  return text;
}
