// Hamburger menu — strictly global/system settings, nothing tied to a single
// object (prototype.md §2): palette, global key/mode, global physics,
// default sizes, build/play toggle, undo/redo, and the project manager.
// Rendered as a wide top-anchored sheet of cards (menu-grid, index.html)
// rather than a tall sidebar — see the `card()` helper below for why.
import {
  getPalette,
  setPalette,
  getPhysicsSettings,
  setPhysicsSettings,
  getGlobalKey,
  setGlobalKey,
  getObjectDefaults,
  setObjectDefaults,
  getInstrumentSettings,
  setInstrumentSettings,
  getLimiterSettings,
  setLimiterSettings,
  listObjects,
} from '../state/canvasState.js';
import { SCALE_NAMES, NOTE_NAMES, OCTAVES } from '../audio/theory.js';
import { SHAPES } from '../state/object.js';
import * as localProject from '../persistence/localProject.js';
import * as jsonIO from '../persistence/jsonIO.js';
import * as history from '../state/history.js';
import * as transport from '../clock/transport.js';
import * as es9 from '../es9/context.js';
import { patchedChannelSummary } from '../es9/routing.js';
import { toggleSwitch } from './objectPopover.js';

let panel = null;

/**
 * Each system-menu section is its own card in a responsive grid (menu-grid,
 * see index.html) rather than one long stacked column — wider, not longer,
 * per the standing feedback that this panel should use horizontal screen
 * space and has more sections coming (instrument sound design). `wide: true`
 * spans the full grid width for content that wants the room (JSON box).
 */
function card(title, { wide = false } = {}) {
  const el = document.createElement('div');
  el.className = wide ? 'menu-card menu-card-wide' : 'menu-card';
  const h = document.createElement('h3');
  h.textContent = title;
  el.appendChild(h);
  return el;
}

/**
 * Cards are grouped into visually separate "islands" (Global vs Instruments)
 * side by side rather than stacked, per feedback — Global's cards are few
 * and compact, so stacking it above a much taller Instruments section left
 * a lot of dead horizontal space under it. `parent` is the shared
 * `.menu-columns` flex row; `extraClass` tags which column this is so its
 * width and inner grid can be styled independently (index.html). Returns the
 * inner grid to append cards to.
 */
function group(title, parent, extraClass) {
  const wrap = document.createElement('div');
  wrap.className = extraClass ? `menu-group ${extraClass}` : 'menu-group';
  const h = document.createElement('h2');
  h.className = 'menu-group-title';
  h.textContent = title;
  wrap.appendChild(h);
  const grid = document.createElement('div');
  grid.className = 'menu-grid';
  wrap.appendChild(grid);
  parent.appendChild(wrap);
  return grid;
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

function colorField(labelText, value, onCommit) {
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = value;
  inp.addEventListener('change', () => onCommit(inp.value));
  return field(labelText, inp);
}

function numberField(labelText, value, opts, onCommit) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'pill';
  inp.value = value;
  if (opts.min != null) inp.min = opts.min;
  if (opts.max != null) inp.max = opts.max;
  inp.step = opts.step ?? 1;
  inp.addEventListener('change', () => onCommit(parseFloat(inp.value)));
  return field(labelText, inp);
}

function checkboxField(labelText, checked, onCommit) {
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.checked = checked;
  inp.addEventListener('change', () => onCommit(inp.checked));
  return field(labelText, inp);
}

function selectField(labelText, options, value, onCommit) {
  const sel = document.createElement('select');
  sel.className = 'pill';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onCommit(sel.value));
  return field(labelText, sel);
}

function textField(labelText, value, onEnter) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'pill';
  inp.value = value;
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onEnter(inp.value);
  });
  const wrap = field(labelText, inp);
  wrap._input = inp;
  return wrap;
}

export function initSystemMenu(root, { onModeChange } = {}) {
  panel = root;
  render(onModeChange);
}

export function rerenderSystemMenu(onModeChange) {
  render(onModeChange);
}

function render(onModeChange) {
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'menu-header';
  const title = document.createElement('span');
  title.className = 'menu-title';
  title.textContent = 'Settings';
  header.appendChild(title);
  panel.appendChild(header);

  const columns = document.createElement('div');
  columns.className = 'menu-columns';
  panel.appendChild(columns);

  // Instruments (left) / Global (right) — the hamburger sits top-left, so the
  // denser, more-elaborate Instruments section lands closest to where the
  // mouse already is, and core stuff (undo/redo, save/load) sits farther out
  // on the right. Groups are declared here, in DOM/visual order; card-
  // building code below still fills each one in through its own variable,
  // wherever that happens to sit in the file.
  const instGrid = group('Instruments', columns, 'menu-group-instruments');
  const grid = group('Global', columns, 'menu-group-global');

  const undoCard = card('Undo / redo');
  const undoRow = document.createElement('div');
  undoRow.className = 'prow';
  const undoBtn = document.createElement('button');
  undoBtn.className = 'pill';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => history.undo());
  const redoBtn = document.createElement('button');
  redoBtn.className = 'pill';
  redoBtn.textContent = 'Redo';
  redoBtn.addEventListener('click', () => history.redo());
  undoRow.appendChild(undoBtn);
  undoRow.appendChild(redoBtn);
  undoCard.appendChild(undoRow);
  grid.appendChild(undoCard);

  const projectCard = card('Project');
  const nameField = textField('Name', 'untitled', () => {});
  projectCard.appendChild(nameField);
  const projRow1 = document.createElement('div');
  projRow1.className = 'prow';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'pill';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    localProject.saveProject(nameField._input.value || 'untitled', jsonIO.exportJSON());
    render(onModeChange);
  });
  projRow1.appendChild(saveBtn);
  projectCard.appendChild(projRow1);

  const list = document.createElement('select');
  list.className = 'pill';
  for (const name of localProject.listProjects()) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    list.appendChild(o);
  }
  projectCard.appendChild(field('Saved', list));

  const projRow2 = document.createElement('div');
  projRow2.className = 'prow';
  const openBtn = document.createElement('button');
  openBtn.className = 'pill';
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', () => {
    const data = localProject.loadProject(list.value);
    if (data) {
      jsonIO.importJSON(data);
      history.init();
      render(onModeChange);
    }
  });
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'pill danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    localProject.deleteProject(list.value);
    render(onModeChange);
  });
  projRow2.appendChild(openBtn);
  projRow2.appendChild(deleteBtn);
  projectCard.appendChild(projRow2);
  grid.appendChild(projectCard);

  const timingCard = card('Global timing');
  timingCard.appendChild(numberField('BPM', transport.getBpm(), { min: 1, max: 400 }, (v) => transport.setBpm(v)));
  const timingHint = document.createElement('p');
  timingHint.className = 'hint';
  timingHint.textContent = 'Time signature (num/denom) is set per spawner. BPM applies globally.';
  timingCard.appendChild(timingHint);
  grid.appendChild(timingCard);

  const keyCard = card('Global key / mode');
  const key = getGlobalKey();
  const keyRow = document.createElement('div');
  keyRow.className = 'prow';
  keyRow.appendChild(selectField('Note', NOTE_NAMES, key.note, (v) => setGlobalKey({ note: v })));
  keyRow.appendChild(selectField('Octave', OCTAVES, key.octave, (v) => setGlobalKey({ octave: parseInt(v, 10) })));
  keyRow.appendChild(selectField('Mode', SCALE_NAMES, key.mode, (v) => setGlobalKey({ mode: v })));
  keyCard.appendChild(keyRow);
  grid.appendChild(keyCard);

  const physCard = card('Global physics');
  const phys = getPhysicsSettings();
  physCard.appendChild(numberField('Gravity', phys.gravity, { step: 0.1 }, (v) => setPhysicsSettings({ gravity: v })));
  physCard.appendChild(numberField('Restitution', phys.restitution, { step: 0.05 }, (v) => setPhysicsSettings({ restitution: v })));
  physCard.appendChild(numberField('Friction', phys.friction, { step: 0.01 }, (v) => setPhysicsSettings({ friction: v })));
  physCard.appendChild(numberField('Air friction', phys.airFriction, { step: 0.001 }, (v) => setPhysicsSettings({ airFriction: v })));
  grid.appendChild(physCard);

  // Object cap gets its own small card rather than living inside Global
  // physics — one line, toggle + number side by side, since "Object cap" as
  // a title already says everything the two stacked fields used to spell
  // out separately. Off by default: physics/rendering handle high object
  // counts fine on their own (a screen-filling peg field with a spawner
  // running through it hits 4000+ live bodies with zero trouble) — the
  // actual failure mode is concurrent audio voices (a burst of particles
  // all sounding within the same stretch of physics), not body count, so
  // this is an opt-in failsafe for anyone who wants a hard ceiling, not a
  // default limit standing between anyone and pushing the canvas hard.
  const capCard = card('Object cap');
  const capRow = document.createElement('div');
  capRow.className = 'cap-row';
  capRow.appendChild(toggleSwitch(phys.objectCapEnabled, (v) => setPhysicsSettings({ objectCapEnabled: v })));
  const capInput = document.createElement('input');
  capInput.type = 'number';
  capInput.className = 'pill';
  capInput.min = 1;
  capInput.step = 1;
  capInput.value = phys.objectCap;
  capInput.addEventListener('change', () => setPhysicsSettings({ objectCap: parseInt(capInput.value, 10) || 1 }));
  capRow.appendChild(capInput);
  capCard.appendChild(capRow);
  const capHint = document.createElement('p');
  capHint.className = 'hint';
  capHint.textContent = 'Off by default. Live bodies (toolbar counter) that high overwhelm the audio graph, not physics/rendering — spawners stop emitting once reached.';
  capCard.appendChild(capHint);
  grid.appendChild(capCard);

  const limiterCard = card('Output limiter');
  const limiterSettings = getLimiterSettings();
  limiterCard.appendChild(checkboxField('Enabled', limiterSettings.enabled, (v) => setLimiterSettings({ enabled: v })));
  limiterCard.appendChild(numberField('Ceiling (dB)', limiterSettings.ceiling, { min: -24, max: 0, step: 1 }, (v) => setLimiterSettings({ ceiling: v })));
  const limiterHint = document.createElement('p');
  limiterHint.className = 'hint';
  limiterHint.textContent = 'Safety measure. Adjust at own risk of ears and equipment.';
  limiterCard.appendChild(limiterHint);
  grid.appendChild(limiterCard);

  const sizeCard = card('Default sizes');
  const sizeHint = document.createElement('p');
  sizeHint.className = 'hint';
  sizeHint.textContent = 'Adjust standard spawn settings.';
  sizeCard.appendChild(sizeHint);
  const defaults = getObjectDefaults();
  for (const preset of ['bouncer', 'trigger', 'spawner']) {
    const d = defaults[preset];
    const row = document.createElement('div');
    row.className = 'prow';
    row.appendChild(selectField(preset[0].toUpperCase() + preset.slice(1), SHAPES, d.shape, (v) => setObjectDefaults(preset, { shape: v })));
    row.appendChild(numberField('Size', d.size, { min: 6, max: 800 }, (v) => setObjectDefaults(preset, { size: v })));
    sizeCard.appendChild(row);
  }
  const pf = defaults.pegfield;
  const pfRow1 = document.createElement('div');
  pfRow1.className = 'prow';
  pfRow1.appendChild(numberField('Peg field width', pf.width, { min: 20, max: 1600 }, (v) => setObjectDefaults('pegfield', { width: v })));
  pfRow1.appendChild(numberField('Height', pf.height, { min: 20, max: 1600 }, (v) => setObjectDefaults('pegfield', { height: v })));
  sizeCard.appendChild(pfRow1);
  const pfRow2 = document.createElement('div');
  pfRow2.className = 'prow';
  pfRow2.appendChild(numberField('Spacing', pf.spacing, { min: 10, max: 200 }, (v) => setObjectDefaults('pegfield', { spacing: v })));
  pfRow2.appendChild(numberField('Peg radius', pf.pegRadius, { min: 2, max: 40 }, (v) => setObjectDefaults('pegfield', { pegRadius: v })));
  sizeCard.appendChild(pfRow2);
  grid.appendChild(sizeCard);

  const paletteCard = card('Palette');
  const palette = getPalette();
  paletteCard.appendChild(colorField('Background', palette.background, (v) => setPalette({ background: v })));
  const swatchGrid = document.createElement('div');
  swatchGrid.className = 'swatch-grid';
  palette.pastels.forEach((c, i) => {
    swatchGrid.appendChild(
      colorField(`${i + 1}`, c, (v) => {
        const next = [...palette.pastels];
        next[i] = v;
        setPalette({ pastels: next });
      }),
    );
  });
  paletteCard.appendChild(swatchGrid);
  grid.appendChild(paletteCard);

  const jsonCard = card('JSON export / import');
  const textarea = document.createElement('textarea');
  textarea.className = 'jsonbox';
  textarea.value = jsonIO.exportJSON();
  jsonCard.appendChild(textarea);
  const jsonRow = document.createElement('div');
  jsonRow.className = 'prow';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'pill';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => navigator.clipboard.writeText(textarea.value));
  const loadBtn = document.createElement('button');
  loadBtn.className = 'pill';
  loadBtn.textContent = 'Load pasted JSON';
  loadBtn.addEventListener('click', () => {
    try {
      jsonIO.importJSON(textarea.value);
      history.init();
      render(onModeChange);
    } catch (err) {
      alert(`Invalid JSON: ${err.message}`);
    }
  });
  jsonRow.appendChild(copyBtn);
  jsonRow.appendChild(loadBtn);
  jsonCard.appendChild(jsonRow);
  grid.appendChild(jsonCard);

  for (const instrument of ['kick', 'snare', 'hat']) {
    instGrid.appendChild(baselineInstrumentCard(instrument));
  }
  for (const instrument of ['bass', 'pad', 'melody']) {
    instGrid.appendChild(deepInstrumentCard(instrument));
  }

  // Lands in Instruments, not Global, purely for space (handoff.md §5) — the
  // Global drawer is already nearly full and this card needs more room than
  // it has to spare; conceptually it's a hardware/global concern like the
  // Limiter card, not a per-voice one.
  instGrid.appendChild(es9Card(onModeChange));
}

let es9DeviceOptions = [];

/**
 * ES-9 connect + routing overview (prototype.md §15). Connection is a
 * user-gesture-gated flow (scan → pick device → connect), same shape as the
 * recovered test.html rig, opened on its own dedicated AudioContext
 * (es9/context.js) — entirely separate from the app's normal listening
 * context. The "x/8 channels patched" readout reads every object's routing
 * lines fresh each render (es9/routing.js's patchedChannelSummary), so it's
 * only as live as this menu's own re-renders (main.js re-renders it on every
 * hamburger open, not continuously — see main.js for why).
 */
function es9Card(onModeChange) {
  const c = card('ES-9');
  const rerender = () => rerenderSystemMenu(onModeChange);

  const status = document.createElement('p');
  status.className = 'hint';
  status.textContent = es9.isConnected() ? 'Connected.' : 'Not connected.';
  c.appendChild(status);

  const patched = patchedChannelSummary(listObjects());
  const patchedHint = document.createElement('p');
  patchedHint.className = 'hint';
  patchedHint.textContent = `${patched.count}/${patched.total} channels patched.`;
  c.appendChild(patchedHint);

  if (!es9.isConnected()) {
    const deviceSelect = document.createElement('select');
    deviceSelect.className = 'pill';
    if (es9DeviceOptions.length === 0) {
      const o = document.createElement('option');
      o.textContent = 'Scan devices first';
      deviceSelect.appendChild(o);
    } else {
      for (const d of es9DeviceOptions) {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || d.deviceId;
        deviceSelect.appendChild(o);
      }
    }
    c.appendChild(field('Output device', deviceSelect));

    const row = document.createElement('div');
    row.className = 'prow';
    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'pill';
    scanBtn.textContent = 'Scan devices';
    scanBtn.addEventListener('click', async () => {
      try {
        es9DeviceOptions = await es9.scanDevices();
      } catch (err) {
        alert(err.message);
      }
      rerender();
    });
    const connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.className = 'pill';
    connectBtn.textContent = 'Connect';
    connectBtn.addEventListener('click', async () => {
      try {
        await es9.connect(deviceSelect.value);
      } catch (err) {
        alert(err.message);
      }
      rerender();
    });
    row.appendChild(scanBtn);
    row.appendChild(connectBtn);
    c.appendChild(row);
  } else {
    const disconnectBtn = document.createElement('button');
    disconnectBtn.type = 'button';
    disconnectBtn.className = 'pill danger';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.addEventListener('click', () => {
      es9.disconnect();
      rerender();
    });
    c.appendChild(disconnectBtn);
  }

  const cal = es9.getCalibration();
  const calRow1 = document.createElement('div');
  calRow1.className = 'prow';
  calRow1.appendChild(
    numberField('Full-scale V', cal.fsVolts, { step: 0.1 }, (v) => es9.setCalibration({ fsVolts: v })),
  );
  calRow1.appendChild(
    numberField('Gate V', cal.gateVolts, { step: 0.1 }, (v) => es9.setCalibration({ gateVolts: v })),
  );
  c.appendChild(calRow1);
  c.appendChild(numberField('Root note (MIDI)', cal.rootMidi, { min: 0, max: 127 }, (v) => es9.setCalibration({ rootMidi: v })));
  const calHint = document.createElement('p');
  calHint.className = 'hint';
  calHint.textContent = 'Global, one interface. Patch the pitch CV jack into a scope or a known 1V/oct source and adjust Full-scale V until octaves land correctly.';
  c.appendChild(calHint);

  return c;
}

const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];

/** Kick/snare/hat — the shared 3-knob baseline (decay/tone/pitch) only. */
function baselineInstrumentCard(instrument) {
  const c = card(instrument[0].toUpperCase() + instrument.slice(1));
  const s = getInstrumentSettings(instrument);
  const patch = (p) => setInstrumentSettings(instrument, p);
  const row = document.createElement('div');
  row.className = 'prow';
  row.appendChild(numberField('Decay', s.decay, { min: 0.25, max: 3, step: 0.05 }, (v) => patch({ decay: v })));
  row.appendChild(numberField('Tone', s.tone, { min: 0.25, max: 3, step: 0.05 }, (v) => patch({ tone: v })));
  row.appendChild(numberField('Pitch', s.pitch, { min: 0.25, max: 4, step: 0.05 }, (v) => patch({ pitch: v })));
  c.appendChild(row);
  return c;
}

/**
 * Bass/pad/melody — the deep tier (handoff.md's instrument-settings
 * discussion): a full ADSR-shaped amplitude envelope (Attack/Decay/Sustain
 * level/Sustain time/Release — see the voice modules for why Sustain time
 * exists on top of a normal ADSR: every note here is a one-shot
 * physics-triggered hit, not a held key, so there's no real note-off to
 * release a true ADSR's Sustain stage against; Attack ramps to full peak,
 * Decay brings it down to Sustain level, that level holds for Sustain
 * time — 0 by default, an immediate Attack→Decay→Release "plonk" — then
 * Release fades out; dialing Sustain time up is how you fake a longer,
 * held-feeling note) plus tone/waveform, filter resonance + envelope,
 * unison detune/mix, vibrato, noise transient, and (bass only) a sub
 * oscillator. Same rows for all three so the pattern reads the same across
 * cards; `subLevel` row only appears where the settings object actually has
 * it (bass), rather than a per-instrument flag. No octave/pitch knob here —
 * that duplicated the per-object key-override octave once that landed
 * (handoff.md §3), so it was removed; `settings.pitch` stays a valid
 * (always-0-from-here-on, unless an old save set it) field the voices still
 * read, just no longer UI-exposed.
 */
function deepInstrumentCard(instrument) {
  const c = card(instrument[0].toUpperCase() + instrument.slice(1));
  const s = getInstrumentSettings(instrument);
  const patch = (p) => setInstrumentSettings(instrument, p);

  const row1 = document.createElement('div');
  row1.className = 'prow';
  row1.appendChild(selectField('Waveform', WAVEFORMS, s.waveform, (v) => patch({ waveform: v })));
  c.appendChild(row1);

  const rowEnv1 = document.createElement('div');
  rowEnv1.className = 'prow';
  rowEnv1.appendChild(numberField('Attack', s.attack, { min: 0, max: 4, step: 0.01 }, (v) => patch({ attack: v })));
  rowEnv1.appendChild(numberField('Decay', s.decay, { min: 0, max: 4, step: 0.01 }, (v) => patch({ decay: v })));
  c.appendChild(rowEnv1);

  const rowEnv2 = document.createElement('div');
  rowEnv2.className = 'prow';
  rowEnv2.appendChild(numberField('Sustain level', s.sustainLevel, { min: 0, max: 1, step: 0.05 }, (v) => patch({ sustainLevel: v })));
  rowEnv2.appendChild(numberField('Sustain time', s.sustainTime, { min: 0, max: 6, step: 0.02 }, (v) => patch({ sustainTime: v })));
  c.appendChild(rowEnv2);

  const rowEnv3 = document.createElement('div');
  rowEnv3.className = 'prow';
  rowEnv3.appendChild(numberField('Release', s.release, { min: 0.02, max: 6, step: 0.02 }, (v) => patch({ release: v })));
  rowEnv3.appendChild(numberField('Tone', s.tone, { min: 0.25, max: 3, step: 0.05 }, (v) => patch({ tone: v })));
  c.appendChild(rowEnv3);

  const row2 = document.createElement('div');
  row2.className = 'prow';
  row2.appendChild(numberField('Resonance', s.resonance, { min: 0.1, max: 15, step: 0.1 }, (v) => patch({ resonance: v })));
  row2.appendChild(numberField('Filter env', s.filterEnvDepth, { min: 0, max: 2000, step: 10 }, (v) => patch({ filterEnvDepth: v })));
  c.appendChild(row2);

  const row3 = document.createElement('div');
  row3.className = 'prow';
  row3.appendChild(numberField('Filter env speed', s.filterEnvSpeed, { min: 0.25, max: 4, step: 0.05 }, (v) => patch({ filterEnvSpeed: v })));
  row3.appendChild(numberField('Noise mix', s.noiseMix, { min: 0, max: 1, step: 0.05 }, (v) => patch({ noiseMix: v })));
  c.appendChild(row3);

  const row4 = document.createElement('div');
  row4.className = 'prow';
  row4.appendChild(numberField('Detune (semi)', s.unisonDetune, { min: -24, max: 24, step: 0.1 }, (v) => patch({ unisonDetune: v })));
  row4.appendChild(numberField('Unison mix', s.unisonMix, { min: 0, max: 1, step: 0.05 }, (v) => patch({ unisonMix: v })));
  c.appendChild(row4);

  const row5 = document.createElement('div');
  row5.className = 'prow';
  row5.appendChild(numberField('Vibrato rate', s.vibratoRate, { min: 0.5, max: 10, step: 0.1 }, (v) => patch({ vibratoRate: v })));
  row5.appendChild(numberField('Vibrato depth', s.vibratoDepth, { min: 0, max: 100, step: 1 }, (v) => patch({ vibratoDepth: v })));
  c.appendChild(row5);

  if (s.subLevel != null) {
    c.appendChild(numberField('Sub level', s.subLevel, { min: 0, max: 1, step: 0.05 }, (v) => patch({ subLevel: v })));
  }

  return c;
}
