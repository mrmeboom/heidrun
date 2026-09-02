// Single source of truth for the canvas — architecture.md §10. Every mutation
// goes through these setters; nothing else reaches into the object map directly.
// Physics bodies, audio nodes, rendered pixels, undo snapshots, and localStorage
// saves are all derived from this, never the other way around.
import { noteNameToMidi, quantizeToScale } from '../audio/theory.js';

/** @type {Map<string, import('./object.js').HeidrunObject>} */
const objects = new Map();

/** @type {{ background: string, pastels: string[] }} */
const FACTORY_PALETTE = {
  background: '#f3ead9',
  pastels: ['#f4a3a3', '#f7c98a', '#f6e28a', '#a8d8b9', '#9fc9e8', '#c6a8e0'],
};
let palette = structuredClone(FACTORY_PALETTE);

/** @type {{ note: string, octave: number, mode: string }} */
const FACTORY_GLOBAL_KEY = { note: 'C', octave: 4, mode: 'major' };
let globalKey = structuredClone(FACTORY_GLOBAL_KEY);

/** @type {{ gravity: number, restitution: number, friction: number, airFriction: number, objectCapEnabled: boolean, objectCap: number }} */
// objectCapEnabled/objectCap (off by default): a hard ceiling on live physics
// bodies (physics/sync.js's getLiveBodyCount — pegs count individually, not
// once per field) that a spawner simply stops emitting new particles past.
// Off by default deliberately, not just as a generic "safety valve" —
// user-confirmed testing found physics/rendering handle very high body
// counts fine on their own (a screen-filling peg field plus a spawner can
// clear 4000+ live bodies with zero trouble); what actually cuts audio out
// is many particles trying to sound within the same stretch of time (dense
// concurrent audio voices), which correlates with body count only when
// particles are concentrated (e.g. funneled through the same couple of
// bouncers) rather than spread across a wide field. So this cap is an opt-in
// failsafe for anyone who wants a hard ceiling, not a default limit.
const FACTORY_PHYSICS_SETTINGS = { gravity: 1, restitution: 0.7, friction: 0.05, airFriction: 0.001, objectCapEnabled: false, objectCap: 100 };
let physicsSettings = structuredClone(FACTORY_PHYSICS_SETTINGS);

// Output limiter (brickwall-ish compressor sitting after the master bus,
// audio/context.js) — protects ears/downstream gear from a burst of
// simultaneous voices summing into clipping. On by default; adjustable or
// removable, at the user's own risk, since turning it off or raising the
// ceiling can genuinely put unattenuated audio out the output.
const FACTORY_LIMITER_SETTINGS = { enabled: true, ceiling: -3 };
let limiterSettings = structuredClone(FACTORY_LIMITER_SETTINGS);

// Defaults applied to a freshly-placed object of each preset. A placement
// tool merges these in ahead of
// its own factory defaults, so changing a value here only affects objects
// placed from that point forward, never anything already on the canvas.
const FACTORY_OBJECT_DEFAULTS = {
  bouncer: { shape: 'circle', size: 80 },
  trigger: { shape: 'square', size: 80 },
  spawner: { shape: 'asterisk', size: 80 },
  pegfield: { width: 240, height: 240, spacing: 80, pegRadius: 10 },
};
let objectDefaults = structuredClone(FACTORY_OBJECT_DEFAULTS);

// Global, per-instrument sound-design knobs — deliberately global-only, not per-object: this is a
// WebAudio prototyping/preview layer standing in for the eventual modular-
// synth CV/gate output, so "make the kick punchier for the whole patch" is
// the actual use case, not per-bouncer overrides. Kick/snare/hat share
// `decay`/`tone`/`pitch`; bass/pad/melody get a full ADSR-shaped amplitude
// envelope (`attack`/`decay`/`sustainLevel`/`sustainTime`/`release` — see
// the voice modules for why `sustainTime` exists: every note here is a
// one-shot physics-triggered hit, not a held key, so there's no real
// note-off for a normal ADSR's Sustain stage to release against;
// `sustainTime` at its 0 default means an immediate Attack→Decay→Release
// "plonk"; dialing it up fakes a held note), plus `waveform` onward for
// their own sound design. Every knob defaults to leaving the original
// hardcoded sound unchanged (decay/tone/resonance multipliers at 1,
// sustainLevel at 1, decay/sustainTime/pitch/detune/vibrato/noise/sub at 0)
// except where a default is needed to reproduce what the voice already
// sounded like before this existed (bass's `filterEnvDepth`, melody's
// `unisonDetune`/`unisonMix`, and each voice's own original attack/release
// timing).
const FACTORY_INSTRUMENT_SETTINGS = {
  kick: { decay: 1, tone: 1, pitch: 1 },
  snare: { decay: 1, tone: 1, pitch: 1 },
  hat: { decay: 1, tone: 1, pitch: 1 },
  bass: {
    attack: 0.01, decay: 0, sustainLevel: 1, sustainTime: 0, release: 0.4,
    tone: 1, pitch: 0,
    waveform: 'sawtooth', resonance: 1,
    filterEnvDepth: 900, filterEnvSpeed: 1,
    unisonDetune: 0, unisonMix: 0,
    vibratoRate: 5, vibratoDepth: 0,
    noiseMix: 0, subLevel: 0,
  },
  pad: {
    attack: 0.6, decay: 0, sustainLevel: 1, sustainTime: 0, release: 2.5,
    tone: 1, pitch: 0,
    waveform: 'triangle', resonance: 1,
    filterEnvDepth: 0, filterEnvSpeed: 1,
    unisonDetune: 0, unisonMix: 0,
    vibratoRate: 5, vibratoDepth: 0,
    noiseMix: 0,
  },
  melody: {
    attack: 0.01, decay: 0, sustainLevel: 1, sustainTime: 0, release: 0.6,
    tone: 1, pitch: 0,
    waveform: 'sine', resonance: 1,
    filterEnvDepth: 0, filterEnvSpeed: 1,
    unisonDetune: 12, unisonMix: 0.3,
    vibratoRate: 5, vibratoDepth: 0,
    noiseMix: 0,
  },
};
let instrumentSettings = structuredClone(FACTORY_INSTRUMENT_SETTINGS);

let mode = 'build'; // 'build' | 'play'

// Default paused so a freshly placed object never starts moving/sounding
// before the user is ready — see the "pause" feedback thread.
let paused = true;

// Two independent, audio-only mute layers —
// deliberately not the same as Pause, which also freezes physics/spawning and
// so would desync timing against anything else playing alongside the app.
// muteUnsent mutes only the app's own local AudioContext (audio/context.js) —
// since an 'audiosignal'-routed object never plays locally anyway (its ES-9
// line replaces that), muting the whole app context already is "mute
// everything except what's going to the modular," no per-object logic
// needed. muteAll additionally mutes the ES-9 context's own output.
let muteUnsent = false;
let muteAll = false;

const listeners = new Set();
function notify() {
  // Keep piano note-picker selections (architecture.md §10) in sync with whatever
  // mode is currently effective for each sound module, before anything reads
  // state off the back of this notify — catches every path uniformly (global
  // key edits, per-object overrides, project load/import, undo/redo,
  // duplicate) since they all already funnel through here, rather than
  // needing to hook each individual setter that could change an effective
  // mode. Runs on every mutation (including ones with nothing to do with
  // pitch, like a drag), same as applyPhysicsSettings/applyPaletteToCSS
  // already do off this same subscribe pattern — cheap early-exit per object
  // when nothing's changed, consistent with that existing cost profile.
  requantizePianoNotes();
  for (const fn of listeners) fn();
}

function requantizePianoNotes() {
  for (const obj of objects.values()) {
    requantizeSoundModule(obj.sound);
    if (obj.field?.sound) requantizeSoundModule(obj.field.sound);
    if (obj.spawn?.particleSound) requantizeSoundModule(obj.spawn.particleSound);
  }
}

/**
 * Snaps `sound.pianoNotes` to the nearest in-scale semitone whenever this
 * sound module's own effective mode has changed since the last time this ran
 * — not merely "doesn't match," which would wrongly re-snap freshly-picked
 * notes the very first time they're ever seen (a brand new selection hasn't
 * had any "mode change" happen to it yet; `_pianoQuantizedMode` starting
 * undefined just records the baseline instead of rewriting anything).
 */
function requantizeSoundModule(sound) {
  if (!sound) return;
  const mode = effectiveKeyFor(sound).mode;
  if (sound._pianoQuantizedMode === undefined) {
    sound._pianoQuantizedMode = mode;
    return;
  }
  if (sound._pianoQuantizedMode === mode) return;
  if (sound.pianoNotes?.length) {
    sound.pianoNotes = sound.pianoNotes.map((n) => quantizeToScale(mode, n));
  }
  sound._pianoQuantizedMode = mode;
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addObject(obj) {
  objects.set(obj.id, obj);
  notify();
  return obj;
}

export function removeObject(id) {
  const existed = objects.delete(id);
  if (existed) notify();
  return existed;
}

export function updateObject(id, patch) {
  const obj = objects.get(id);
  if (!obj) return null;
  Object.assign(obj, patch);
  notify();
  return obj;
}

export function getObject(id) {
  return objects.get(id) ?? null;
}

export function listObjects() {
  return [...objects.values()];
}

export function clearObjects() {
  objects.clear();
  notify();
}

export function setPalette(next) {
  palette = { ...palette, ...next };
  notify();
}
export function getPalette() {
  return palette;
}

export function setGlobalKey(next) {
  globalKey = { ...globalKey, ...next };
  notify();
}
export function getGlobalKey() {
  return globalKey;
}

/**
 * Resolves the effective key/mode for a *sound module*: its own override, or
 * the global default — note/octave/mode each fall back to the global value
 * independently (not as a single all-or-nothing override), so an object can
 * override just its octave while still inheriting the global note, or just
 * its mode while inheriting everything else. Takes the sound module directly
 * (not the containing object) — a peg field's sound lives at `field.sound`,
 * not `obj.sound`, and this used to hardcode `obj.sound`, silently ignoring a
 * field's own note/octave/mode. Every caller already has the actual sound
 * module in hand (main.js picks `field.sound` vs `obj.sound` before
 * calling), so there's nothing case-specific left to embed here.
 */
export function effectiveKeyFor(sound) {
  const override = sound?.keyOverride;
  const note = override?.note ?? globalKey.note;
  const octave = override?.octave ?? globalKey.octave;
  const mode = override?.mode ?? globalKey.mode;
  return { rootMidi: noteNameToMidi(note, octave), mode };
}

export function setPhysicsSettings(next) {
  physicsSettings = { ...physicsSettings, ...next };
  notify();
}
export function getPhysicsSettings() {
  return physicsSettings;
}

export function setLimiterSettings(next) {
  limiterSettings = { ...limiterSettings, ...next };
  notify();
}
export function getLimiterSettings() {
  return limiterSettings;
}

export function setInstrumentSettings(instrument, patch) {
  instrumentSettings = { ...instrumentSettings, [instrument]: { ...instrumentSettings[instrument], ...patch } };
  notify();
}
export function getInstrumentSettings(instrument) {
  return instrument ? instrumentSettings[instrument] : instrumentSettings;
}

export function setObjectDefaults(preset, patch) {
  objectDefaults = { ...objectDefaults, [preset]: { ...objectDefaults[preset], ...patch } };
  notify();
}
export function getObjectDefaults(preset) {
  return preset ? objectDefaults[preset] : objectDefaults;
}

export function setMode(next) {
  mode = next;
  notify();
}
export function getMode() {
  return mode;
}

export function setPaused(next) {
  paused = next;
  notify();
}
export function getPaused() {
  return paused;
}

export function setMuteUnsent(next) {
  muteUnsent = next;
  notify();
}
export function getMuteUnsent() {
  return muteUnsent;
}

export function setMuteAll(next) {
  muteAll = next;
  notify();
}
export function getMuteAll() {
  return muteAll;
}

/**
 * "Reset all" — reverts every global setting
 * (palette, key/mode, physics, per-class object defaults, instrument sound
 * design, limiter) back to its hardcoded factory value. Deliberately leaves
 * `objects` untouched — wiping the canvas is "Clear all"'s job, not this
 * one's — so a project with tuned settings but factory-fresh objects isn't
 * possible to reach any other way once autosave means those tweaks now
 * survive a reload on their own.
 */
export function resetSettingsToDefaults() {
  palette = structuredClone(FACTORY_PALETTE);
  globalKey = structuredClone(FACTORY_GLOBAL_KEY);
  physicsSettings = structuredClone(FACTORY_PHYSICS_SETTINGS);
  objectDefaults = structuredClone(FACTORY_OBJECT_DEFAULTS);
  instrumentSettings = structuredClone(FACTORY_INSTRUMENT_SETTINGS);
  limiterSettings = structuredClone(FACTORY_LIMITER_SETTINGS);
  notify();
}

export function serialize() {
  return JSON.stringify({
    version: 1,
    objects: listObjects(),
    palette,
    globalKey,
    physicsSettings,
    objectDefaults,
    instrumentSettings,
    limiterSettings,
  });
}

export function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  objects.clear();
  for (const obj of data.objects ?? []) objects.set(obj.id, obj);
  if (data.palette) palette = data.palette;
  if (data.globalKey) globalKey = data.globalKey;
  // Merged with defaults, not replaced outright — a project saved before the
  // object cap existed has no objectCapEnabled/objectCap fields, and a
  // straight replace would leave those undefined after load (same reasoning
  // as objectDefaults/instrumentSettings just below).
  if (data.physicsSettings) physicsSettings = { ...physicsSettings, ...data.physicsSettings };
  if (data.objectDefaults) objectDefaults = { ...objectDefaults, ...data.objectDefaults };
  if (data.instrumentSettings) instrumentSettings = { ...instrumentSettings, ...data.instrumentSettings };
  if (data.limiterSettings) limiterSettings = { ...limiterSettings, ...data.limiterSettings };
  notify();
}
