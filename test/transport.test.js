import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as canvasState from '../src/state/canvasState.js';
import { createSpawner } from '../src/state/object.js';
import * as transport from '../src/clock/transport.js';
import * as history from '../src/state/history.js';

function reset() {
  canvasState.clearObjects();
  history.init();
}

function particleCount() {
  return canvasState.listObjects().filter((o) => o.preset === 'particle').length;
}

// Regression test for "turned a spawner back on and it dumped a huge burst
// of particles at once" — reported after leaving a spawner switched off (not
// paused) for a while. Root cause: the spawner's own bar-position bookkeeping
// stayed frozen while off, while the shared transport clock kept advancing
// regardless; re-enabling it found that bookkeeping far in the past and a
// catch-up loop replayed every step it "missed" in one frame.
//
// Fixed by removing the replay model entirely (not just capping it): each
// tick now asks "which step is the clock in right now" directly and fires
// at most once, edge-triggered against the step last fired — there's no
// loop left that could ever replay history, by construction.
test('a spawner switched off does not accumulate a catch-up debt while off', () => {
  reset();
  transport.setBpm(60); // 1 second/step at 4/4, 'none' beat-select
  const spawner = canvasState.addObject(createSpawner({ x: 0, y: 0 }));
  assert.equal(spawner.spawn.beatSelect.type, 'none'); // every eligible step fires

  transport.tickSpawners(0); // establish the anchor — fires immediately for step 0
  const afterActivation = particleCount();
  assert.equal(afterActivation, 1);

  canvasState.updateObject(spawner.id, { physics: { ...spawner.physics, live: false } });
  transport.tickSpawners(100_000); // an enormous stretch of "hidden" time while off
  assert.equal(particleCount(), afterActivation, 'no particles should spawn while off, however long it was off for');

  canvasState.updateObject(spawner.id, { physics: { ...spawner.physics, live: true } });
  transport.tickSpawners(0); // re-enable — should land on "now" and fire it exactly once
  assert.equal(particleCount(), afterActivation + 1, 'reactivating fires exactly the current step, never a backlog');
});

test('an edited meter mid-bar does not burst either', () => {
  reset();
  transport.setBpm(60);
  const spawner = canvasState.addObject(createSpawner({ x: 0, y: 0 }));
  transport.tickSpawners(0);

  // Jump to well past the old 4/4 bar's midpoint (a normal step boundary or
  // two may legitimately fire here — that's not what's under test).
  transport.tickSpawners(1.9);
  const beforeMeterChange = particleCount();

  // Radically change the meter mid-bar (like typing a new denominator) and
  // tick once more — this is the moment that used to matter: the old anchor
  // (set up under 4/4) is now wildly stale relative to a 4/16 bar length.
  canvasState.updateObject(spawner.id, { spawn: { ...spawner.spawn, meter: { ...spawner.spawn.meter, numerator: 4, denominator: 16 } } });
  transport.tickSpawners(0);

  assert.ok(particleCount() - beforeMeterChange <= 1, 'at most one particle fires on the tick a meter change lands, never a replay burst');
});

test('steady ticking fires roughly once per configured step, no more', () => {
  reset();
  transport.setBpm(60); // 1 second/step at 4/4
  const spawner = canvasState.addObject(createSpawner({ x: 0, y: 0 }));
  transport.tickSpawners(0);

  // Ten seconds at 1 second/step, delivered as a handful of uneven frame
  // deltas (not one per step) — should land close to 10 steps' worth of
  // particles, not more (and not wildly fewer).
  for (let i = 0; i < 40; i++) transport.tickSpawners(0.25);

  const count = particleCount();
  assert.ok(count >= 9 && count <= 11, `expected ~10 particles over 10 simulated seconds, got ${count}`);
});

test('object cap (physics card, off by default) blocks new spawns once getLiveBodyCount reports at/over the cap', () => {
  reset();
  canvasState.setPhysicsSettings({ objectCapEnabled: true, objectCap: 3 });
  transport.setBpm(60);
  const spawner = canvasState.addObject(createSpawner({ x: 0, y: 0 }));
  transport.tickSpawners(0, { getLiveBodyCount: () => 3 });

  for (let i = 0; i < 20; i++) transport.tickSpawners(0.25, { getLiveBodyCount: () => 3 });

  assert.equal(particleCount(), 0, 'at/over cap, a spawner should never emit');
  canvasState.setPhysicsSettings({ objectCapEnabled: false, objectCap: 100 });
});

test('object cap does not affect spawning when disabled or when no getLiveBodyCount is supplied', () => {
  reset();
  transport.setBpm(60);
  canvasState.addObject(createSpawner({ x: 0, y: 0 }));
  transport.tickSpawners(0); // no getLiveBodyCount passed at all — same as main.js's very first call before physics exists
  for (let i = 0; i < 8; i++) transport.tickSpawners(0.25);
  assert.ok(particleCount() > 0, 'spawning proceeds normally with no cap wired up');
});
