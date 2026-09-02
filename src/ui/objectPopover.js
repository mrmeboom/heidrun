// The per-object "+" inline settings popover — build mode only. Every field
// commits on change (select/checkbox/number-blur/cycler
// click), never on every keystroke, so the panel is safe to fully re-render
// after each commit without fighting focus.
import { getObject, updateObject, removeObject } from '../state/canvasState.js';
import * as history from '../state/history.js';
import { GENERATOR_TYPES } from '../generators/index.js';
import { SCALE_NAMES, NOTE_NAMES, OCTAVES } from '../audio/theory.js';
import { createSoundModule, createEs9Module, SHAPES } from '../state/object.js';
import { manualStepCount } from '../clock/transport.js';

let container = null;
let openId = null;

export function initPopoverContainer(root) {
  container = root;
}

export function closePopover() {
  openId = null;
  if (container) container.innerHTML = '';
}

export function isOpen(id) {
  return openId === id;
}

/** The currently-open object's id, or null — used to keep the popover glued
 * to its object's screen position while the camera pans/zooms (interaction.js). */
export function getOpenId() {
  return openId;
}

export function togglePopover(id, screenPos) {
  if (openId === id) {
    closePopover();
    return;
  }
  openId = id;
  render(screenPos);
}

export function refreshPopoverPosition(screenPos) {
  if (openId && container?.firstChild) {
    container.firstChild.style.left = `${screenPos.x}px`;
    container.firstChild.style.top = `${screenPos.y}px`;
    clampToViewport(container.firstChild);
  }
}

function clampToViewport(panel) {
  const rect = panel.getBoundingClientRect();
  const margin = 8;
  let dx = 0;
  let dy = 0;
  if (rect.right > window.innerWidth - margin) dx -= rect.right - (window.innerWidth - margin);
  if (rect.left + dx < margin) dx += margin - (rect.left + dx);
  if (rect.bottom > window.innerHeight - margin) dy -= rect.bottom - (window.innerHeight - margin);
  if (rect.top + dy < margin) dy += margin - (rect.top + dy);
  if (dx !== 0) panel.style.left = `${parseFloat(panel.style.left) + dx}px`;
  if (dy !== 0) panel.style.top = `${parseFloat(panel.style.top) + dy}px`;
}

function field(labelText, inputEl) {
  const wrap = document.createElement('label');
  wrap.className = 'pfield';
  const span = document.createElement('span');
  span.textContent = labelText;
  wrap.appendChild(span);
  wrap.appendChild(inputEl);
  return wrap;
}

function selectEl(options, value, onCommit) {
  const sel = document.createElement('select');
  sel.className = 'pill';
  for (const opt of options) {
    const o = document.createElement('option');
    const v = opt.value ?? opt;
    o.value = v;
    o.textContent = opt.label ?? opt;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onCommit(sel.value));
  return sel;
}

function numberEl(value, opts, onCommit) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'pill';
  inp.value = value;
  if (opts.min != null) inp.min = opts.min;
  if (opts.max != null) inp.max = opts.max;
  inp.step = opts.step ?? 1;
  inp.addEventListener('change', () => onCommit(parseFloat(inp.value) || 0));
  return inp;
}

/** Compact single-line toggle switch — used for On/Sound/Auto-chord, not the
 * old label-above-checkbox layout. Exported for systemMenu.js's Object cap
 * card, which wants the same compact side-by-side toggle rather than the
 * label-above-native-checkbox look of its own checkboxField(). */
export function toggleSwitch(checked, onCommit) {
  const label = document.createElement('label');
  label.className = 'toggle-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onCommit(input.checked));
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  label.appendChild(input);
  label.appendChild(slider);
  return label;
}

function toggleRow(labelText, checked, onCommit) {
  const row = document.createElement('div');
  row.className = 'trow';
  const span = document.createElement('span');
  span.textContent = labelText;
  row.appendChild(span);
  row.appendChild(toggleSwitch(checked, onCommit));
  return row;
}

/** Compact labeled toggle for the popover header, where two toggles need to sit side by side. */
function labeledToggle(labelText, checked, onCommit) {
  const wrap = document.createElement('span');
  wrap.className = 'header-toggle';
  const span = document.createElement('span');
  span.textContent = labelText;
  wrap.appendChild(span);
  wrap.appendChild(toggleSwitch(checked, onCommit));
  return wrap;
}

const SHAPE_GLYPHS = { circle: '●', triangle: '▲', square: '■', rectangle: '▬', asterisk: '✳', random: '🎲' };

function shapeCycler(options, value, onCommit) {
  let idx = Math.max(options.indexOf(value), 0);
  const wrap = document.createElement('div');
  wrap.className = 'shape-cycler';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'cycler-btn';
  prev.textContent = '‹';
  const preview = document.createElement('span');
  preview.className = 'cycler-preview';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'cycler-btn';
  next.textContent = '›';
  const update = () => {
    preview.textContent = SHAPE_GLYPHS[options[idx]] ?? '●';
  };
  update();
  prev.addEventListener('click', () => {
    idx = (idx - 1 + options.length) % options.length;
    update();
    onCommit(options[idx]);
  });
  next.addEventListener('click', () => {
    idx = (idx + 1) % options.length;
    update();
    onCommit(options[idx]);
  });
  wrap.append(prev, preview, next);
  return wrap;
}

function stepGrid(steps, onToggle) {
  const grid = document.createElement('div');
  grid.className = 'step-grid';
  steps.forEach((on, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = on ? 'step-btn on' : 'step-btn';
    btn.textContent = String(i + 1);
    btn.addEventListener('click', () => onToggle(i));
    grid.appendChild(btn);
  });
  return grid;
}

function resizeSteps(oldSteps, newLen) {
  const next = new Array(newLen).fill(false);
  for (let i = 0; i < Math.min(oldSteps.length, newLen); i++) next[i] = oldSteps[i];
  return next;
}

/**
 * Shared by spawn beat-select's manual pattern and a sound module's manual
 * hit-gate. `computeLength(resolution)` decides the grid length — for a
 * spawner that's numerator-scaled ("beat 1 and 3" needs to mean actual
 * beats); a hit-gate has no meter to scale against, so its grid
 * length is just the resolution itself.
 */
function manualPatternFields(parent, manual, computeLength, onChange) {
  parent.appendChild(
    field(
      'Resolution',
      selectEl([4, 8, 16], manual.resolution, (v) => {
        const resolution = parseInt(v, 10);
        onChange({ resolution, steps: resizeSteps(manual.steps, computeLength(resolution)) });
      }),
    ),
  );
  parent.appendChild(
    stepGrid(manual.steps, (i) => {
      const steps = manual.steps.slice();
      steps[i] = !steps[i];
      onChange({ ...manual, steps });
    }),
  );
}

const DEFAULT_MANUAL = { resolution: 8, steps: new Array(8).fill(false) };

const BEAT_SELECT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'manual', label: 'Manual' },
  { value: 'euclidean', label: 'Euclidean' },
  { value: 'lfsr', label: 'LFSR' },
  { value: 'prime', label: 'Prime' },
  { value: 'fibonacci', label: 'Fibonacci' },
  { value: 'markov', label: 'Markov' },
  { value: 'wolfram', label: 'Wolfram' },
];

// 'positional' is deliberately not offered here — it's a real pitchBehavior
// value in theory.js, but it only means something when main.js supplies a
// live positionIndex from a peg-field hit. Peg fields don't
// even use this list — they get their own "Field pitch" selector
// (FIELD_PITCH_OPTIONS) below. Selecting 'positional' on any other object
// left positionIndex at scheduleNote's default of 0 forever, so it silently
// resolved to the same fixed degree every time — a dead, confusing option
// that predates the peg-field build. Removed here; theory.js's 'positional'
// case is untouched since main.js still sets it programmatically for pegs.
const PITCH_BEHAVIOR_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'random', label: 'Random' },
  { value: 'up', label: 'Cycle up' },
  { value: 'down', label: 'Cycle down' },
  { value: 'piano', label: 'Piano' },
];

const PIANO_CYCLE_OPTIONS = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'updown', label: 'Up-down' },
  { value: 'downup', label: 'Down-up' },
  { value: 'random', label: 'Random' },
];

// Piano note-picker (pitchBehavior 'piano') — a continuous
// 3-octave strip (36 keys), offset 0 = leftmost key = the object's own
// effective root, so lowering the root's octave visibly (and audibly) slides
// the whole strip down together. Chromatic — picking a passing tone outside
// the current mode is the point; theory.js/canvasState.js handle transposing
// (root changes, free at resolve time) and re-snapping (mode changes,
// explicit rewrite) elsewhere. This widget only ever reflects/toggles
// whatever's currently in `sound.pianoNotes`.
const PIANO_OCTAVES = 3;
const PIANO_WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11]; // semitone-in-octave, in key order
const PIANO_BLACK_STEPS = [1, 3, 6, 8, 10];
const PIANO_TOTAL_WHITE = PIANO_WHITE_STEPS.length * PIANO_OCTAVES;

function pianoWidget(selected, onToggle) {
  const isOn = (offset) => selected.includes(offset);
  const piano = document.createElement('div');
  piano.className = 'piano';

  const whiteRow = document.createElement('div');
  whiteRow.className = 'piano-white-row';
  for (let oct = 0; oct < PIANO_OCTAVES; oct++) {
    for (const step of PIANO_WHITE_STEPS) {
      const offset = oct * 12 + step;
      const key = document.createElement('button');
      key.type = 'button';
      key.className = isOn(offset) ? 'piano-key piano-white on' : 'piano-key piano-white';
      key.addEventListener('click', () => onToggle(offset));
      whiteRow.appendChild(key);
    }
  }
  piano.appendChild(whiteRow);

  for (let oct = 0; oct < PIANO_OCTAVES; oct++) {
    for (const step of PIANO_BLACK_STEPS) {
      const offset = oct * 12 + step;
      // Index (among all 21 white keys) of the white key just below this
      // black one — black keys sit centered on the boundary just past it.
      const precedingWhiteIndex = oct * PIANO_WHITE_STEPS.length + PIANO_WHITE_STEPS.filter((s) => s < step).length - 1;
      const leftPercent = ((precedingWhiteIndex + 0.7) / PIANO_TOTAL_WHITE) * 100;
      const key = document.createElement('button');
      key.type = 'button';
      key.className = isOn(offset) ? 'piano-key piano-black on' : 'piano-key piano-black';
      key.style.left = `${leftPercent}%`;
      key.addEventListener('click', () => onToggle(offset));
      piano.appendChild(key);
    }
  }
  return piano;
}

const GATE_TYPE_OPTIONS = [{ value: '', label: 'Always on' }, { value: 'manual', label: 'manual' }, ...GENERATOR_TYPES.map((t) => ({ value: t, label: t }))];
// Accent gate needs a real "never fires" choice — 'off' is a distinct
// sentinel from the main gate's null/"always on" (accenting every note isn't
// a useful default, but is still offered for anyone who wants it).
const ACCENT_GATE_TYPE_OPTIONS = [{ value: 'off', label: 'Off' }, ...GATE_TYPE_OPTIONS];

// Peg field only — replaces the normal Pitch selector.
// Up/Down/Left/Right map a struck peg's own position (normalized against the
// field's bounds, not a peg count) onto Range — 'Up' means the field's top
// edge is the lowest note and the bottom is the highest, so a particle
// dropping through the field hears pitch climb (matches the audible effect,
// not the on-screen row order); the other three mirror it across the
// relevant axis. Random re-rolls a note within Range on every hit.
const FIELD_PITCH_OPTIONS = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'left', label: 'Left → Right' },
  { value: 'right', label: 'Right → Left' },
  { value: 'random', label: 'Random' },
];

const ES9_SIGNAL_OPTIONS = [
  { value: 'pitch', label: 'Pitch' },
  { value: 'gate', label: 'Gate' },
  { value: 'adsr', label: 'ADSR' },
  { value: 'audiosignal', label: 'Audio signal' },
];
const ES9_GLIDE_OPTIONS = [
  { value: 'staccato', label: 'Staccato' },
  { value: 'legato', label: 'Legato' },
  { value: 'auto', label: 'Auto glide' },
];
const ES9_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Hardware routing — lives inside the sound module itself
 * so it works identically wherever buildSoundFields is called (a plain
 * object's `sound`, a peg field's `field.sound`, a spawner's
 * `spawn.particleSound`), no special-casing per call site. Each line is a
 * channel (1–8, not exclusive — several lines/objects can share one, that's
 * deliberate) + signal type; gate/adsr's actual on-wire duration reuses this
 * object's own instrument ADSR, so there's no separate
 * gate-length control here. Glide is per-object (the winning note's own
 * setting applies whenever it steals a channel from something else).
 */
function buildEs9Fields(parent, sound, patch) {
  const es9 = sound.es9 ?? createEs9Module();
  const section = document.createElement('div');
  section.className = 'psection';
  const heading = document.createElement('div');
  heading.className = 'psub-heading';
  heading.textContent = 'ES-9 out';
  section.appendChild(heading);
  section.appendChild(toggleRow('Route to ES-9', es9.enabled, (v) => patch({ es9: { ...es9, enabled: v } })));

  if (es9.enabled) {
    if (es9.lines.length > 0) {
      // Column labels shown once above the stack, not repeated per line —
      // every line row below is just the two bare pills + remove button.
      const header = document.createElement('div');
      header.className = 'prow';
      const chLabel = document.createElement('span');
      chLabel.className = 'pfield';
      chLabel.textContent = 'Channel';
      const sigLabel = document.createElement('span');
      sigLabel.className = 'pfield';
      sigLabel.textContent = 'Signal';
      header.appendChild(chLabel);
      header.appendChild(sigLabel);
      section.appendChild(header);
    }
    es9.lines.forEach((line, i) => {
      const row = document.createElement('div');
      row.className = 'prow';
      row.appendChild(
        selectEl(ES9_CHANNELS, line.channel, (v) => {
          const lines = es9.lines.slice();
          lines[i] = { ...line, channel: parseInt(v, 10) };
          patch({ es9: { ...es9, lines } });
        }),
      );
      row.appendChild(
        selectEl(ES9_SIGNAL_OPTIONS, line.signal, (v) => {
          const lines = es9.lines.slice();
          lines[i] = { ...line, signal: v };
          patch({ es9: { ...es9, lines } });
        }),
      );
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'cycler-btn';
      removeBtn.title = 'Remove line';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => patch({ es9: { ...es9, lines: es9.lines.filter((_, j) => j !== i) } }));
      row.appendChild(removeBtn);
      section.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'pill';
    addBtn.textContent = '+ line';
    addBtn.addEventListener('click', () => patch({ es9: { ...es9, lines: [...es9.lines, { channel: 1, signal: 'pitch' }] } }));
    section.appendChild(addBtn);

    const glideRow = document.createElement('div');
    glideRow.className = 'prow';
    glideRow.appendChild(field('Glide', selectEl(ES9_GLIDE_OPTIONS, es9.glideMode, (v) => patch({ es9: { ...es9, glideMode: v } }))));
    glideRow.appendChild(
      field('Glide time', numberEl(es9.glideTime, { min: 0, max: 2, step: 0.01 }, (v) => patch({ es9: { ...es9, glideTime: v } }))),
    );
    section.appendChild(glideRow);
  }
  parent.appendChild(section);
}

// `opts.hidePitch` — a peg field's Pitch/Degree row is replaced by its own
// "Field pitch" selector below (pitchMode, not pitchBehavior) instead of
// showing this row redundantly for something that isn't actually used.
function buildSoundFields(parent, sound, patch, opts = {}) {
  const instRow = document.createElement('div');
  instRow.className = 'prow';
  instRow.appendChild(
    field('Instrument', selectEl(['kick', 'snare', 'hat', 'bass', 'pad', 'melody'], sound.instrument, (v) => patch({ instrument: v }))),
  );
  if (!opts.hidePitch) {
    instRow.appendChild(field('Pitch', selectEl(PITCH_BEHAVIOR_OPTIONS, sound.pitchBehavior, (v) => patch({ pitchBehavior: v }))));
  }
  parent.appendChild(instRow);
  // Degree (fixed) and Range (random/up/down) share one row — both are
  // single-field conditionals on pitchBehavior, so this doesn't add an extra
  // line per popover. Piano replaces this row entirely with
  // the note-picker widget + its own Cycle order, below the row instead of
  // in it — a 3-octave strip doesn't fit inline.
  if (!opts.hidePitch && sound.pitchBehavior === 'fixed') {
    parent.appendChild(field('Degree', numberEl(sound.fixedDegree, { step: 1 }, (v) => patch({ fixedDegree: v }))));
  } else if (!opts.hidePitch && (sound.pitchBehavior === 'random' || sound.pitchBehavior === 'up' || sound.pitchBehavior === 'down')) {
    parent.appendChild(field('Range', numberEl(sound.pitchRange, { min: 1, max: 48 }, (v) => patch({ pitchRange: v }))));
  } else if (!opts.hidePitch && sound.pitchBehavior === 'piano') {
    // `?? []` covers sound modules saved before Piano existed — old data has
    // no pianoNotes field at all, not just an empty one.
    const pianoNotes = sound.pianoNotes ?? [];
    parent.appendChild(
      pianoWidget(pianoNotes, (offset) => {
        const next = pianoNotes.includes(offset) ? pianoNotes.filter((n) => n !== offset) : [...pianoNotes, offset];
        patch({ pianoNotes: next });
      }),
    );
    parent.appendChild(field('Cycle', selectEl(PIANO_CYCLE_OPTIONS, sound.pianoCycle, (v) => patch({ pianoCycle: v }))));
  }

  // Accent: evaluated only on notes that already pass the Gate below — when
  // it fires, it swaps in this pitch behavior/degree for that one note
  // instead of spawning a second, independent note.
  const accentRow = document.createElement('div');
  accentRow.className = 'prow';
  accentRow.appendChild(
    field(
      'Accent gate',
      selectEl(ACCENT_GATE_TYPE_OPTIONS, sound.accent.gate.type ?? '', (v) =>
        patch({ accent: { ...sound.accent, gate: { type: v || null, config: v === 'manual' ? { manual: DEFAULT_MANUAL } : {}, index: 0 } } }),
      ),
    ),
  );
  // Accent's 'piano' choice only offered once the main pitch is actually
  // Piano — accent has no note set of its own to walk (it always reuses
  // sound.pianoNotes), so there's nothing for it to mean
  // otherwise. Same hidden-until-relevant treatment as the main Piano row.
  const accentPitchOptions = sound.pitchBehavior === 'piano' ? PITCH_BEHAVIOR_OPTIONS : PITCH_BEHAVIOR_OPTIONS.filter((o) => o.value !== 'piano');
  accentRow.appendChild(field('Accent pitch', selectEl(accentPitchOptions, sound.accent.pitchBehavior, (v) => patch({ accent: { ...sound.accent, pitchBehavior: v } }))));
  parent.appendChild(accentRow);
  if (sound.accent.pitchBehavior === 'fixed') {
    parent.appendChild(field('Accent degree', numberEl(sound.accent.fixedDegree, { step: 1 }, (v) => patch({ accent: { ...sound.accent, fixedDegree: v } }))));
  } else if (sound.accent.pitchBehavior === 'random' || sound.accent.pitchBehavior === 'up' || sound.accent.pitchBehavior === 'down') {
    parent.appendChild(field('Accent range', numberEl(sound.accent.pitchRange, { min: 1, max: 48 }, (v) => patch({ accent: { ...sound.accent, pitchRange: v } }))));
  } else if (sound.accent.pitchBehavior === 'piano') {
    // No second widget — same picked notes as the main row, just its own
    // traversal order (e.g. main cycles up, accent picks randomly among them).
    parent.appendChild(field('Accent cycle', selectEl(PIANO_CYCLE_OPTIONS, sound.accent.pianoCycle, (v) => patch({ accent: { ...sound.accent, pianoCycle: v } }))));
  }
  if (sound.accent.gate.type === 'manual') {
    manualPatternFields(parent, sound.accent.gate.config.manual ?? DEFAULT_MANUAL, (res) => res, (next) =>
      patch({ accent: { ...sound.accent, gate: { ...sound.accent.gate, config: { manual: next } } } }),
    );
  }

  parent.appendChild(
    field('Gate', selectEl(GATE_TYPE_OPTIONS, sound.gate.type ?? '', (v) => patch({ gate: { type: v || null, config: v === 'manual' ? { manual: DEFAULT_MANUAL } : {}, index: 0 } }))),
  );
  if (sound.gate.type === 'manual') {
    // A hit-gate has no meter to scale against — resolution is the grid length, directly.
    manualPatternFields(parent, sound.gate.config.manual ?? DEFAULT_MANUAL, (res) => res, (next) =>
      patch({ gate: { ...sound.gate, config: { manual: next } } }),
    );
  }
  if (sound.instrument === 'pad') {
    // Single note vs chord — the root still always follows the Pitch/Degree
    // or Range row above (fixed/random/up/down) either way; this only
    // decides whether extra chord tones get stacked on top of that root.
    parent.appendChild(toggleRow('Chord', sound.chord.auto, (v) => patch({ chord: { ...sound.chord, auto: v } })));
    parent.appendChild(
      field(
        'Chord',
        selectEl(['triad', 'seventh', 'extended'], sound.chord.complexity, (v) => patch({ chord: { ...sound.chord, complexity: v } })),
      ),
    );
  }

  const keyRow = document.createElement('div');
  keyRow.className = 'prow';
  keyRow.appendChild(
    field(
      'Note',
      selectEl(
        [{ value: 'none', label: 'none' }, ...NOTE_NAMES],
        sound.keyOverride.note ?? 'none',
        (v) => patch({ keyOverride: { ...sound.keyOverride, note: v === 'none' ? null : v } }),
      ),
    ),
  );
  keyRow.appendChild(
    field(
      'Octave',
      selectEl(
        [{ value: 'none', label: 'none' }, ...OCTAVES],
        sound.keyOverride.octave ?? 'none',
        (v) => patch({ keyOverride: { ...sound.keyOverride, octave: v === 'none' ? null : parseInt(v, 10) } }),
      ),
    ),
  );
  keyRow.appendChild(
    field(
      'Mode',
      selectEl(
        [{ value: 'none', label: 'none' }, ...SCALE_NAMES],
        sound.keyOverride.mode ?? 'none',
        (v) => patch({ keyOverride: { ...sound.keyOverride, mode: v === 'none' ? null : v } }),
      ),
    ),
  );
  parent.appendChild(keyRow);

  const sendRow = document.createElement('div');
  sendRow.className = 'prow';
  sendRow.appendChild(field('Reverb', numberEl(sound.sendReverb, { min: 0, max: 1, step: 0.05 }, (v) => patch({ sendReverb: v }))));
  sendRow.appendChild(field('Delay', numberEl(sound.sendDelay, { min: 0, max: 1, step: 0.05 }, (v) => patch({ sendDelay: v }))));
  parent.appendChild(sendRow);

  buildEs9Fields(parent, sound, patch);
}

function buildBeatSelectFields(parent, spawn, patchSpawn) {
  parent.appendChild(field('Beat select', selectEl(BEAT_SELECT_OPTIONS, spawn.beatSelect.type, (v) => patchSpawn({ beatSelect: { ...spawn.beatSelect, type: v } }))));

  if (spawn.beatSelect.type === 'euclidean') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Steps = beats in the pattern. Hits = how many of those beats actually fire, spread as evenly as possible. Rotation = shifts which beat the pattern starts on.';
    parent.appendChild(hint);
    const eu = spawn.beatSelect.euclid;
    const row = document.createElement('div');
    row.className = 'prow';
    row.appendChild(field('Hits', numberEl(eu.hits, { min: 0 }, (v) => patchSpawn({ beatSelect: { ...spawn.beatSelect, euclid: { ...eu, hits: v } } }))));
    row.appendChild(field('Steps', numberEl(eu.steps, { min: 1 }, (v) => patchSpawn({ beatSelect: { ...spawn.beatSelect, euclid: { ...eu, steps: v } } }))));
    row.appendChild(field('Rotation', numberEl(eu.rotation, { min: 0 }, (v) => patchSpawn({ beatSelect: { ...spawn.beatSelect, euclid: { ...eu, rotation: v } } }))));
    parent.appendChild(row);
  }

  if (spawn.beatSelect.type === 'manual') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Resolution is a note value (quarter/eighth/sixteenth), not a fixed step count — total steps = numerator × subdivision, so 7/4 at "quarter" gives 7 steps, one per beat.';
    parent.appendChild(hint);
    manualPatternFields(
      parent,
      spawn.beatSelect.manual,
      (resolution) => manualStepCount(spawn.meter, resolution),
      (next) => patchSpawn({ beatSelect: { ...spawn.beatSelect, manual: next } }),
    );
  }
}

function render(screenPos) {
  if (!container) return;
  container.innerHTML = '';
  const obj = getObject(openId);
  if (!obj) {
    closePopover();
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'popover';
  panel.style.left = `${screenPos.x}px`;
  panel.style.top = `${screenPos.y}px`;

  const patch = (p) => {
    updateObject(obj.id, p);
    history.commit();
    render(screenPos);
  };
  const patchSound = (p) => patch({ sound: { ...obj.sound, ...p } });
  const patchSpawn = (p) => patch({ spawn: { ...obj.spawn, ...p } });
  const patchSpawnSound = (p) => patch({ spawn: { ...obj.spawn, particleSound: { ...obj.spawn.particleSound, ...p } } });
  const patchField = (p) => patch({ field: { ...obj.field, ...p } });
  const patchFieldSound = (p) => patch({ field: { ...obj.field, sound: { ...obj.field.sound, ...p } } });

  const header = document.createElement('div');
  header.className = 'popover-header';
  const title = document.createElement('span');
  title.className = 'popover-title';
  title.textContent = obj.preset === 'pegfield' ? 'peg field' : obj.preset;
  header.appendChild(title);
  if (obj.preset === 'spawner') {
    // Whether this spawner has a physics body at all — off means freshly
    // spawned particles can never overlap/hit their own spawner, so "sound
    // on spawn" becomes opt-in per spawner instead of always-on.
    header.appendChild(labeledToggle('Collide', obj.physics.collides, (v) => patch({ physics: { ...obj.physics, collides: v } })));
  }
  header.appendChild(labeledToggle('On', obj.physics.live, (v) => patch({ physics: { ...obj.physics, live: v } })));
  panel.appendChild(header);

  const isRect = obj.shape === 'square' || obj.shape === 'rectangle';
  const isPegField = obj.preset === 'pegfield';
  const topRow = document.createElement('div');
  topRow.className = 'prow';
  if (!isPegField) {
    topRow.appendChild(field('Shape', shapeCycler(SHAPES, obj.shape, (v) => patch({ shape: v }))));
  }
  // Width pill matches the Size pill's width exactly (same field markup) —
  // Height goes on its own row underneath instead of widening this row, so
  // switching to a rect shape only grows the popover a little taller, not wider.
  topRow.appendChild(field(isRect ? 'Width' : 'Size', numberEl(isRect ? obj.width : obj.size, { min: 6, max: isRect ? 800 : 300 }, (v) => patch(isRect ? { width: v } : { size: v }))));
  panel.appendChild(topRow);
  if (isRect) {
    panel.appendChild(field('Height', numberEl(obj.height, { min: 6, max: 800 }, (v) => patch({ height: v }))));
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = isPegField
      ? 'Drag the corner handle to resize the field — pegs auto-fill based on spacing, so the count follows the size.'
      : 'Drag the corner handle on canvas to resize width/height independently — stretch into a block or a thin line.';
    panel.appendChild(hint);
  }
  if (isPegField) {
    const fieldRow = document.createElement('div');
    fieldRow.className = 'prow';
    fieldRow.appendChild(field('Spacing', numberEl(obj.field.spacing, { min: 10, max: 200 }, (v) => patchField({ spacing: v }))));
    fieldRow.appendChild(field('Peg radius', numberEl(obj.field.pegRadius, { min: 2, max: 40 }, (v) => patchField({ pegRadius: v }))));
    panel.appendChild(fieldRow);
  }

  if (obj.preset === 'bouncer') {
    panel.appendChild(toggleRow('Sound', !!obj.sound, (v) => patch({ sound: v ? createSoundModule() : null })));
  }
  if (isPegField) {
    // Field-level sound lives on `field.sound`, not `obj.sound` — one shared
    // instrument/gate/accent for the whole field, which every peg hit routes back to since all pegs share the field
    // object's own id.
    panel.appendChild(toggleRow('Sound', !!obj.field.sound, (v) => patchField({ sound: v ? createSoundModule() : null })));
  }
  if (obj.sound) {
    const section = document.createElement('div');
    section.className = 'psection';
    buildSoundFields(section, obj.sound, patchSound);
    panel.appendChild(section);
  }
  if (isPegField && obj.field.sound) {
    const section = document.createElement('div');
    section.className = 'psection';
    const pitchRow = document.createElement('div');
    pitchRow.className = 'prow';
    pitchRow.appendChild(field('Field pitch', selectEl(FIELD_PITCH_OPTIONS, obj.field.pitchMode, (v) => patchField({ pitchMode: v }))));
    pitchRow.appendChild(field('Range', numberEl(obj.field.sound.pitchRange, { min: 1, max: 48 }, (v) => patchFieldSound({ pitchRange: v }))));
    section.appendChild(pitchRow);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Up: top of the field is lowest, bottom is highest (particles falling through sound like they climb). Down/Left/Right mirror it across the same or the horizontal axis. Random re-rolls a note within Range on every hit.';
    section.appendChild(hint);
    buildSoundFields(section, obj.field.sound, patchFieldSound, { hidePitch: true });
    panel.appendChild(section);
  }
  if (obj.spawn) {
    const section = document.createElement('div');
    section.className = 'psection';
    const meter = obj.spawn.meter;

    const meterRow = document.createElement('div');
    meterRow.className = 'prow';
    meterRow.appendChild(
      field('Num.', numberEl(meter.numerator, { min: 1 }, (v) => {
        const nextMeter = { ...meter, numerator: v };
        const p = { meter: nextMeter };
        // Numerator changing reshapes the manual grid too (steps = numerator × subdivision).
        if (obj.spawn.beatSelect.type === 'manual') {
          const manual = obj.spawn.beatSelect.manual;
          const length = manualStepCount(nextMeter, manual.resolution);
          p.beatSelect = { ...obj.spawn.beatSelect, manual: { ...manual, steps: resizeSteps(manual.steps, length) } };
        }
        patchSpawn(p);
      })),
    );
    meterRow.appendChild(field('Denom.', numberEl(meter.denominator, { min: 1 }, (v) => patchSpawn({ meter: { ...meter, denominator: v } }))));
    section.appendChild(meterRow);

    const driftRow = document.createElement('div');
    driftRow.className = 'prow';
    driftRow.appendChild(
      field('Num. drift max', numberEl(meter.numeratorDriftMax, { min: 0 }, (v) => patchSpawn({ meter: { ...meter, numeratorDriftMax: v } }))),
    );
    driftRow.appendChild(
      field('Denom. drift max', numberEl(meter.denominatorDriftMax, { min: 0 }, (v) => patchSpawn({ meter: { ...meter, denominatorDriftMax: v } }))),
    );
    section.appendChild(driftRow);

    buildBeatSelectFields(section, obj.spawn, patchSpawn);

    const emitRow = document.createElement('div');
    emitRow.className = 'prow';
    emitRow.appendChild(field('Emit shape', shapeCycler(['random', ...SHAPES], obj.spawn.emitShape, (v) => patchSpawn({ emitShape: v }))));
    emitRow.appendChild(field('Emit size', numberEl(obj.spawn.emitSize, { min: 4, max: 80 }, (v) => patchSpawn({ emitSize: v }))));
    section.appendChild(emitRow);

    const heading = document.createElement('div');
    heading.className = 'psub-heading';
    heading.textContent = 'Particle sound';
    section.appendChild(heading);
    section.appendChild(toggleRow('Sound', obj.spawn.particlesHaveSound, (v) => patchSpawn({ particlesHaveSound: v })));
    if (obj.spawn.particlesHaveSound) {
      buildSoundFields(section, obj.spawn.particleSound, patchSpawnSound);
    } else {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Particles are pure exciters — no sound of their own. Whatever they hit does the sounding, gated by that object’s own settings.';
      section.appendChild(hint);
    }

    panel.appendChild(section);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'pill danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    removeObject(obj.id);
    history.commit();
    closePopover();
  });
  panel.appendChild(deleteBtn);

  container.appendChild(panel);
  clampToViewport(panel);
}
