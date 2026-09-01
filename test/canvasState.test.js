import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as canvasState from '../src/state/canvasState.js';
import { createBouncer, createTrigger, createSpawner, createSoundModule } from '../src/state/object.js';
import { noteNameToMidi, quantizeToScale } from '../src/audio/theory.js';
import * as history from '../src/state/history.js';

function reset() {
  canvasState.clearObjects();
  history.init();
}

test('add/update/remove object round-trips through the store', () => {
  reset();
  const obj = createBouncer({ x: 10, y: 20 });
  canvasState.addObject(obj);
  assert.equal(canvasState.getObject(obj.id).x, 10);

  canvasState.updateObject(obj.id, { x: 99 });
  assert.equal(canvasState.getObject(obj.id).x, 99);

  canvasState.removeObject(obj.id);
  assert.equal(canvasState.getObject(obj.id), null);
});

test('serialize/deserialize round-trips to an identical state', () => {
  reset();
  canvasState.addObject(createBouncer({ x: 1, y: 2 }));
  canvasState.addObject(createTrigger({ x: 3, y: 4 }));
  canvasState.addObject(createSpawner({ x: 5, y: 6 }));

  const before = canvasState.serialize();
  canvasState.deserialize(before);
  const after = canvasState.serialize();
  assert.equal(after, before);
});

test('undo/redo restores prior and next state', () => {
  reset();
  const obj = createBouncer({ x: 0, y: 0 });
  canvasState.addObject(obj);
  history.commit();

  canvasState.updateObject(obj.id, { x: 500 });
  history.commit();
  assert.equal(canvasState.getObject(obj.id).x, 500);

  assert.equal(history.undo(), true);
  assert.equal(canvasState.getObject(obj.id).x, 0);

  assert.equal(history.redo(), true);
  assert.equal(canvasState.getObject(obj.id).x, 500);
});

test('undo with nothing to undo is a no-op that returns false', () => {
  reset();
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), false);
});

test('object defaults patch per-preset and survive a serialize/deserialize round-trip', () => {
  reset();
  const before = canvasState.getObjectDefaults('bouncer');
  canvasState.setObjectDefaults('bouncer', { size: 55 });
  assert.equal(canvasState.getObjectDefaults('bouncer').size, 55);
  // Other presets are untouched by a patch to one.
  assert.equal(canvasState.getObjectDefaults('trigger').shape, 'square');

  const json = canvasState.serialize();
  canvasState.setObjectDefaults('bouncer', { size: before.size });
  canvasState.deserialize(json);
  assert.equal(canvasState.getObjectDefaults('bouncer').size, 55);
});

test('placement merges stored defaults ahead of a factory\'s own hardcoded values', () => {
  reset();
  canvasState.setObjectDefaults('bouncer', { shape: 'triangle', size: 77 });
  const obj = createBouncer({ x: 1, y: 2, ...canvasState.getObjectDefaults('bouncer') });
  assert.equal(obj.shape, 'triangle');
  assert.equal(obj.size, 77);
  assert.equal(obj.width, 77);
  assert.equal(obj.height, 77);
});

test('instrument settings patch per-instrument, leave other instruments untouched, and round-trip', () => {
  reset();
  canvasState.setInstrumentSettings('bass', { waveform: 'square', subLevel: 0.4 });
  const bass = canvasState.getInstrumentSettings('bass');
  assert.equal(bass.waveform, 'square');
  assert.equal(bass.subLevel, 0.4);
  // Unrelated fields on the same instrument survive the patch.
  assert.equal(bass.sustainLevel, 1);
  // A different instrument (and one without a `subLevel` field at all) is untouched.
  const pad = canvasState.getInstrumentSettings('pad');
  assert.equal(pad.waveform, 'triangle');
  assert.equal(pad.subLevel, undefined);

  const json = canvasState.serialize();
  canvasState.setInstrumentSettings('bass', { waveform: 'sawtooth' });
  canvasState.deserialize(json);
  assert.equal(canvasState.getInstrumentSettings('bass').waveform, 'square');
});

test('limiter settings patch, default on, and round-trip', () => {
  reset();
  const defaults = canvasState.getLimiterSettings();
  assert.equal(defaults.enabled, true);

  canvasState.setLimiterSettings({ ceiling: -6 });
  assert.equal(canvasState.getLimiterSettings().ceiling, -6);
  assert.equal(canvasState.getLimiterSettings().enabled, true);

  const json = canvasState.serialize();
  canvasState.setLimiterSettings({ enabled: false, ceiling: 0 });
  canvasState.deserialize(json);
  assert.equal(canvasState.getLimiterSettings().enabled, true);
  assert.equal(canvasState.getLimiterSettings().ceiling, -6);
});

test('effectiveKeyFor falls back to the global note/octave/mode independently', () => {
  reset();
  canvasState.setGlobalKey({ note: 'C', octave: 4, mode: 'major' });

  // A fresh sound module overrides nothing — pure inherit.
  const inheriting = createSoundModule();
  assert.deepEqual(canvasState.effectiveKeyFor(inheriting), { rootMidi: noteNameToMidi('C', 4), mode: 'major' });

  // Overriding only octave keeps the global note and mode.
  const octaveOnly = createSoundModule();
  octaveOnly.keyOverride.octave = 2;
  assert.deepEqual(canvasState.effectiveKeyFor(octaveOnly), { rootMidi: noteNameToMidi('C', 2), mode: 'major' });

  // Overriding only mode keeps the global note and octave.
  const modeOnly = createSoundModule();
  modeOnly.keyOverride.mode = 'dorian';
  assert.deepEqual(canvasState.effectiveKeyFor(modeOnly), { rootMidi: noteNameToMidi('C', 4), mode: 'dorian' });

  // Overriding only note keeps the global octave and mode.
  const noteOnly = createSoundModule();
  noteOnly.keyOverride.note = 'F';
  assert.deepEqual(canvasState.effectiveKeyFor(noteOnly), { rootMidi: noteNameToMidi('F', 4), mode: 'major' });
});

test('pianoNotes stay untouched while the mode is unchanged, and re-snap only once the effective mode actually changes', () => {
  reset();
  canvasState.setGlobalKey({ note: 'C', octave: 4, mode: 'major' });

  const obj = createBouncer({ withSound: true });
  canvasState.addObject(obj);
  canvasState.updateObject(obj.id, { sound: { ...obj.sound, pitchBehavior: 'piano', pianoNotes: [4] } });

  // 4 is in-scale for major — freshly picking it (mode unchanged throughout) must not get rewritten.
  assert.deepEqual(canvasState.getObject(obj.id).sound.pianoNotes, [4]);

  // Switching to a mode that doesn't contain semitone 4 (phrygian: 0,1,3,5,7,8,10)
  // should snap it to its nearest neighbor (3, a tie with 5 that favors the lower).
  canvasState.setGlobalKey({ mode: 'phrygian' });
  assert.deepEqual(canvasState.getObject(obj.id).sound.pianoNotes, [quantizeToScale('phrygian', 4)]);
  assert.deepEqual(canvasState.getObject(obj.id).sound.pianoNotes, [3]);

  // Switching mode again with nothing out-of-scale this time is a no-op.
  canvasState.setGlobalKey({ mode: 'minor' }); // minor: 0,2,3,5,7,8,10 — 3 is in-scale
  assert.deepEqual(canvasState.getObject(obj.id).sound.pianoNotes, [3]);
});
