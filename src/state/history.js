// Undo/redo — a capped ring buffer of full serialized snapshots rather than a
// diff/command system: layouts are small JSON, so snapshotting the whole thing
// per meaningful edit is cheap and far less code (prototype.md §12).
import { serialize, deserialize } from './canvasState.js';

const MAX_STEPS = 50;

let past = [];
let future = [];
let baseline = null;
let suppress = false;

/** Call once after the initial canvas state is set up, before any user edits. */
export function init() {
  baseline = serialize();
  past = [];
  future = [];
}

/**
 * Call after a *completed* edit (drag end, popover field committed, object
 * added/removed) — not on every intermediate change, or the history would
 * flood with drag-frame noise.
 */
export function commit() {
  if (suppress || baseline == null) return;
  const current = serialize();
  if (current === baseline) return;
  past.push(baseline);
  if (past.length > MAX_STEPS) past.shift();
  future = [];
  baseline = current;
}

export function undo() {
  if (past.length === 0) return false;
  future.push(baseline);
  const prev = past.pop();
  suppress = true;
  deserialize(prev);
  suppress = false;
  baseline = prev;
  return true;
}

export function redo() {
  if (future.length === 0) return false;
  past.push(baseline);
  if (past.length > MAX_STEPS) past.shift();
  const next = future.pop();
  suppress = true;
  deserialize(next);
  suppress = false;
  baseline = next;
  return true;
}

export function canUndo() {
  return past.length > 0;
}
export function canRedo() {
  return future.length > 0;
}
