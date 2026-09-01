// Copy-to-clipboard / paste-to-load JSON, same pattern as input.html's "copy
// settings JSON" — for backup, moving a layout between machines, or sharing
// a layout (prototype.md §10).
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
