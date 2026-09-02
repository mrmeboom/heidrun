// Automatic, ambient localStorage snapshot of the whole canvas — distinct
// from the named-project store in localProject.js, which
// only ever persists on an explicit Save. This one silently restores
// everything (layout included, per the user's call) on a plain reload, with
// no save action required.
import { serialize, deserialize, subscribe } from '../state/canvasState.js';

const KEY = 'heidrun-autosave';
const DEBOUNCE_MS = 500;

let timer = null;

/** Call once at startup, before history.init(), so the restored state (if
 * any) becomes the undo baseline rather than something Cmd+Z can undo past. */
export function loadAutosave() {
  const data = localStorage.getItem(KEY);
  if (data) deserialize(data);
}

/** Call once at startup, after loadAutosave(), to start persisting
 * subsequent changes. */
export function initAutosave() {
  subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => localStorage.setItem(KEY, serialize()), DEBOUNCE_MS);
  });
}
