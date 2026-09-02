// Wires every module together — architecture.md §10. This is the only file
// that knows about all the layers at once; everything else only knows its
// own slice.
import {
  subscribe,
  listObjects,
  updateObject,
  removeObject,
  getPhysicsSettings,
  effectiveKeyFor,
  getObject,
  getMode,
  setMode,
  getPaused,
  setPaused,
  getLimiterSettings,
  getInstrumentSettings,
  getMuteUnsent,
  setMuteUnsent,
  getMuteAll,
  setMuteAll,
  clearObjects,
} from './state/canvasState.js';
import * as history from './state/history.js';
import { loadAutosave, initAutosave } from './persistence/autosave.js';
import { applyPhysicsSettings, stepPhysics } from './physics/world.js';
import { writeBackDynamicPositions, getLiveBodyCount } from './physics/sync.js';
import { onHit } from './physics/collisions.js';
import { WORLD } from './render/camera.js';
import { evaluateGate, evaluateGateAt } from './generators/gate.js';
import { scheduleNote } from './audio/scheduleNote.js';
import { applyLimiterSettings, setAppMuted } from './audio/context.js';
import { triggerEs9 } from './es9/routing.js';
import { allChannelsLow, setEs9Muted } from './es9/context.js';
import { tickSpawners } from './clock/transport.js';
import { draw } from './render/draw.js';
import { applyPaletteToCSS } from './render/palette.js';
import { initInteraction, setPlacementTool, setSelectedId, getSelectedIds, getMarqueeRect } from './ui/interaction.js';
import { initPopoverContainer, closePopover } from './ui/objectPopover.js';
import { initSystemMenu, rerenderSystemMenu } from './ui/systemMenu.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const popoverRoot = document.getElementById('popoverRoot');
const systemMenuPanel = document.getElementById('systemMenu');
const hint = document.getElementById('audioHint');
const pauseBtn = document.getElementById('pauseBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const muteUnsentBtn = document.getElementById('muteUnsentBtn');
const muteAllBtn = document.getElementById('muteAllBtn');
const modeToggle = document.getElementById('modeToggle');
const hamburger = document.getElementById('hamburger');
const bodyCounter = document.getElementById('bodyCounter');

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

applyPhysicsSettings(getPhysicsSettings());
subscribe(() => applyPhysicsSettings(getPhysicsSettings()));
applyPaletteToCSS();
subscribe(applyPaletteToCSS);
applyLimiterSettings(getLimiterSettings());
subscribe(() => applyLimiterSettings(getLimiterSettings()));

// Mute Unsent mutes only the app's own local context; Mute All mutes that
// plus the ES-9 context — both audio-only,
// independent of Pause, so physics/spawning/ES-9 scheduling keep running and
// un-muting never desyncs from anything else playing alongside the app.
function applyMuteState() {
  const all = getMuteAll();
  setAppMuted(all || getMuteUnsent());
  setEs9Muted(all);
}
applyMuteState();
subscribe(applyMuteState);

// Collision → hit → (hit-indexed gate) → sound. Bodies/sensors alike fire
// this; a spawner or plain physics-only bouncer just has no sound module so
// nothing happens. `field.sound` lives on the peg field
// object itself (state/object.js's FieldModule), reusing the field's own
// `sound`/`gate`/`accent` the same way `obj.sound` does for everything else
// — so this reads `obj.sound` either way, no pegfield branch needed for the
// gate/accent parts.
onHit((hitId, _otherId, hitBody) => {
  const obj = getObject(hitId);
  const sound = obj?.preset === 'pegfield' ? obj.field?.sound : obj?.sound;
  if (!sound) return;
  const hitIndex = sound.gate.index;
  if (!evaluateGate(sound.gate)) return;
  // Accent gate only runs on notes that already sound — it's a modifier, not
  // a second independent trigger, so it never adds an extra note on its own.
  // Read at the same hit-index the main gate just fired on (evaluateGateAt),
  // not the accent's own separately-incrementing "how many accented notes
  // have I seen" counter — the two used to disagree about what "step 15"
  // meant (gate.js's evaluateGateAt has the full story).
  const accented = sound.accent ? evaluateGateAt(sound.accent.gate, hitIndex) : false;

  let noteSound = sound;
  let positionIndex = 0;
  if (obj.preset === 'pegfield') {
    // Which peg was actually hit, as *where in the field* it sits — not an
    // absolute count (an earlier version counted pegs row-major and clamped
    // at the top of the range; any field wider than a couple of columns blew
    // through the range within the first few rows, so almost every peg
    // clamped to the same note). A peg's own position, normalized against
    // the field's current bounds, scales correctly no matter how many pegs
    // or how wide the range is — 0 at one edge, 1 at the other, always.
    // The peg's position is in world space, but "top/bottom/left/right of the
    // field" only means something in the field's own (possibly rotated)
    // local frame — rotate the peg back by -obj.rotation around the field's
    // center before measuring row/column fraction, same transform as
    // physics/sync.js's makePegBodies runs forward to place it in the first
    // place. Without this, a tilted field's "up" would follow world-up
    // instead of the field's own physical top.
    const dx = (hitBody?.position?.x ?? obj.x) - obj.x;
    const dy = (hitBody?.position?.y ?? obj.y) - obj.y;
    const cos = Math.cos(-obj.rotation);
    const sin = Math.sin(-obj.rotation);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    const rowFrac = obj.height > 0 ? clamp01((localY + obj.height / 2) / obj.height) : 0;
    const colFrac = obj.width > 0 ? clamp01((localX + obj.width / 2) / obj.width) : 0;
    const range = Math.max(sound.pitchRange ?? 14, 1);
    const mode = obj.field.pitchMode ?? 'up';
    if (mode === 'random') {
      noteSound = { ...sound, pitchBehavior: 'random' };
    } else {
      // 'up': top of the field is the lowest note, bottom the highest, so a
      // particle dropping through hears pitch climb — matches the field's
      // physical top-to-bottom, not the on-screen row order. 'down' mirrors
      // it; 'left'/'right' do the same across columns.
      let frac = 0;
      if (mode === 'up') frac = rowFrac;
      else if (mode === 'down') frac = 1 - rowFrac;
      else if (mode === 'left') frac = colFrac;
      else if (mode === 'right') frac = 1 - colFrac;
      noteSound = { ...sound, pitchBehavior: 'positional' };
      positionIndex = Math.round(frac * (range - 1));
    }
  }
  const effectiveKey = effectiveKeyFor(sound);
  // ES-9 routing fires alongside the normal WebAudio
  // voice, except an 'audiosignal' line replaces local playback entirely —
  // that's the one case triggerEs9 reports back via suppressLocal, since
  // every other signal type (pitch/gate/adsr) is a control-only send that
  // doesn't compete with what you hear through the app.
  const { suppressLocal } = triggerEs9(noteSound, effectiveKey, {
    positionIndex,
    accented,
    instrumentSettings: getInstrumentSettings(sound.instrument) ?? {},
  });
  if (!suppressLocal) scheduleNote(noteSound, effectiveKey, positionIndex, accented);
});

initPopoverContainer(popoverRoot);
initInteraction(canvas);
initSystemMenu(systemMenuPanel, {});

document.getElementById('toolBouncer').addEventListener('click', () => setPlacementTool('bouncer'));
document.getElementById('toolTrigger').addEventListener('click', () => setPlacementTool('trigger'));
document.getElementById('toolSpawner').addEventListener('click', () => setPlacementTool('spawner'));
document.getElementById('toolPegField').addEventListener('click', () => setPlacementTool('pegfield'));

hamburger.addEventListener('click', () => {
  const opening = !systemMenuPanel.classList.contains('open');
  systemMenuPanel.classList.toggle('open');
  // Re-render on open only (not continuously) so cards reading live state —
  // the ES-9 card's "x/8 channels patched" readout in particular — reflect
  // whatever's changed since the menu was last open, without paying a full
  // DOM rebuild on every canvasState notify (those fire every physics frame
  // while particles move, via writeBackDynamicPositions's updateObject calls).
  if (opening) rerenderSystemMenu();
});

function syncPauseButton() {
  const paused = getPaused();
  pauseBtn.textContent = paused ? '▶' : '❚❚';
  pauseBtn.title = paused ? 'Play' : 'Pause';
}
pauseBtn.addEventListener('click', () => {
  const next = !getPaused();
  setPaused(next);
  // Stuck-voltage safety — Pause freezes everything else, so
  // any ES-9 gate/adsr line currently held high has nothing left to bring it
  // back down; force every channel to 0 immediately instead of leaving a
  // module gated open.
  if (next) allChannelsLow();
  syncPauseButton();
});
syncPauseButton();

function syncMuteButtons() {
  muteUnsentBtn.classList.toggle('active', getMuteUnsent());
  muteAllBtn.classList.toggle('active', getMuteAll());
}
muteUnsentBtn.addEventListener('click', () => {
  setMuteUnsent(!getMuteUnsent());
  syncMuteButtons();
});
muteAllBtn.addEventListener('click', () => {
  const next = !getMuteAll();
  setMuteAll(next);
  if (next) allChannelsLow();
  syncMuteButtons();
});
syncMuteButtons();

clearAllBtn.addEventListener('click', () => {
  if (listObjects().length === 0) return;
  if (!window.confirm('Clear the entire canvas? This can be undone with Cmd/Ctrl+Z.')) return;
  clearObjects();
  history.commit();
  closePopover();
  setSelectedId(null);
});

modeToggle.checked = getMode() === 'play';
modeToggle.addEventListener('change', () => {
  setMode(modeToggle.checked ? 'play' : 'build');
  if (modeToggle.checked) closePopover();
});

window.addEventListener('pointerdown', () => hint?.remove(), { once: true });

// Backspace/Delete removes every selected object (marquee-select can pick up
// more than one — interaction.js), unless the user is typing in a field
// (popover inputs, system menu inputs, project name, etc). One history
// commit for the whole batch, so a mass-delete undoes in a single step.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  for (const id of ids) removeObject(id);
  history.commit();
  closePopover();
  setSelectedId(null);
  e.preventDefault();
});

// Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo — same guard as Backspace/Delete so
// typing in a text field never gets hijacked.
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey)) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  if (e.shiftKey) history.redo();
  else history.undo();
  closePopover();
  setSelectedId(null);
});

loadAutosave();
history.init();
initAutosave();

// Bounds are the fixed WORLD rect (render/camera.js), not the viewport —
// since pan/zoom decoupled "on screen" from "in the world," a particle
// scrolled off the visible viewport but still inside the world must keep
// living, only one that's left the world rect entirely should despawn.
function cleanupOffCanvas() {
  const margin = 200;
  for (const obj of listObjects()) {
    if (obj.preset !== 'particle') continue;
    if (obj.x < WORLD.minX - margin || obj.x > WORLD.maxX + margin || obj.y < WORLD.minY - margin || obj.y > WORLD.maxY + margin) {
      removeObject(obj.id); // cleanup only — never goes through undo history (architecture.md §2, particle lifecycle)
    }
  }
}

function syncBodyCounter() {
  const count = getLiveBodyCount();
  bodyCounter.textContent = String(count);
  const settings = getPhysicsSettings();
  bodyCounter.classList.toggle('at-cap', settings.objectCapEnabled && count >= settings.objectCap);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (!getPaused()) {
    stepPhysics(dt * 1000);
    writeBackDynamicPositions(updateObject);
    tickSpawners(dt, { getLiveBodyCount });
    cleanupOffCanvas();
  }
  draw(ctx, { w: canvas.width, h: canvas.height }, { selectedIds: new Set(getSelectedIds()), marqueeRect: getMarqueeRect() });
  syncBodyCounter();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
