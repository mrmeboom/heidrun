import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideGlide, gateHighSeconds, pitchToUnit, patchedChannelSummary } from '../src/es9/routing.js';
import { createSoundModule, createEs9Module, createBouncer, createSpawner, createPegField } from '../src/state/object.js';

test('decideGlide: staccato/legato are unconditional, auto follows channel activity', () => {
  assert.equal(decideGlide(false, 'staccato'), false);
  assert.equal(decideGlide(true, 'staccato'), false);
  assert.equal(decideGlide(false, 'legato'), true);
  assert.equal(decideGlide(true, 'legato'), true);
  assert.equal(decideGlide(false, 'auto'), false);
  assert.equal(decideGlide(true, 'auto'), true);
});

test('gateHighSeconds reuses the deep-tier ADSR (attack+decay+sustainTime) when present', () => {
  const deep = { attack: 0.1, decay: 0.05, sustainTime: 0.3, sustainLevel: 1, release: 0.4 };
  assert.equal(gateHighSeconds(deep), 0.1 + 0.05 + 0.3);
});

test('gateHighSeconds falls back to a short decay-scaled pulse for the baseline percussive tier', () => {
  assert.equal(gateHighSeconds({ decay: 1, tone: 1, pitch: 1 }), 0.12);
  assert.equal(gateHighSeconds({ decay: 2 }), 0.24);
});

test('gateHighSeconds never returns below its floor even for a zeroed envelope', () => {
  assert.equal(gateHighSeconds({ attack: 0, decay: 0, sustainTime: 0 }), 0.02);
  assert.equal(gateHighSeconds({ decay: 0 }), 0.02);
});

test('pitchToUnit: 1V/oct relative to the calibrated root, clamped to +/-1', () => {
  const cal = { rootMidi: 60, fsVolts: 10 };
  assert.equal(pitchToUnit(60, cal), 0); // root itself = 0V
  assert.equal(pitchToUnit(72, cal), 0.1); // one octave up = 1V, /10V full-scale
  assert.equal(pitchToUnit(60 - 12, cal), -0.1);
  // Way outside full-scale still clamps rather than sending an out-of-range offset.
  assert.equal(pitchToUnit(60 + 12 * 20, cal), 1);
  assert.equal(pitchToUnit(60 - 12 * 20, cal), -1);
});

test('patchedChannelSummary counts distinct channels across every object, deduplicated when shared', () => {
  const a = createBouncer({ withSound: true });
  a.sound.es9 = createEs9Module({ enabled: true, lines: [{ channel: 1, signal: 'pitch' }, { channel: 2, signal: 'gate' }] });
  const b = createBouncer({ withSound: true });
  // Same channel 1 as `a`, deliberately allowed (prototype.md §15) — should
  // still only count once toward the total.
  b.sound.es9 = createEs9Module({ enabled: true, lines: [{ channel: 1, signal: 'adsr' }] });
  const disabled = createBouncer({ withSound: true });
  disabled.sound.es9 = createEs9Module({ enabled: false, lines: [{ channel: 5, signal: 'pitch' }] });
  const noSound = createBouncer();

  const summary = patchedChannelSummary([a, b, disabled, noSound]);
  assert.deepEqual(summary.used, [1, 2]);
  assert.equal(summary.count, 2);
  assert.equal(summary.total, 8);
});

test('patchedChannelSummary also reads field.sound and spawn.particleSound', () => {
  const field = createPegField();
  field.field.sound = createSoundModule();
  field.field.sound.es9 = createEs9Module({ enabled: true, lines: [{ channel: 3, signal: 'gate' }] });

  const spawner = createSpawner();
  spawner.spawn.particleSound.es9 = createEs9Module({ enabled: true, lines: [{ channel: 4, signal: 'pitch' }] });

  const summary = patchedChannelSummary([field, spawner]);
  assert.deepEqual(summary.used, [3, 4]);
});

test('createEs9Module defaults to disabled, no lines, staccato', () => {
  const es9 = createEs9Module();
  assert.equal(es9.enabled, false);
  assert.deepEqual(es9.lines, []);
  assert.equal(es9.glideMode, 'staccato');
});

test('createSoundModule always carries an es9 module', () => {
  const sound = createSoundModule();
  assert.ok(sound.es9);
  assert.equal(sound.es9.enabled, false);
});
