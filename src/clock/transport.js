// Global BPM transport — spawn modules only.
//
// Every spawner reads the SAME shared `clockSeconds` timeline (frozen while
// paused, per architecture.md's pause design). A spawner's bar-start is
// snapped to that shared clock the first time it ticks — `Math.floor(clockSeconds
// / barLength) * barLength` — so two spawners with matching meters land on
// identical step boundaries no matter when each was created. This is what
// makes "beat 1" actually mean the same instant for every object, not just
// "however long it's personally been running."
import { listObjects, addObject, getPhysicsSettings } from '../state/canvasState.js';
import { createParticle } from '../state/object.js';
import { createGenerator } from '../generators/index.js';

let bpm = 100;
let clockSeconds = 0;

export function setBpm(next) {
  bpm = Math.max(next, 1);
}
export function getBpm() {
  return bpm;
}
export function getClockSeconds() {
  return clockSeconds;
}

function beatDuration(denominator) {
  return (60 / bpm) * (4 / Math.max(denominator, 1));
}

// Manual resolution is a note-subdivision (4 = quarter, 8 = eighth, 16 =
// sixteenth), not "however many equal slices the whole bar gets cut into" —
// so a 7/4 meter at resolution 4 gives 7 steps (one per beat), and at
// resolution 8 gives 14 (two per beat), regardless of what the numerator is.
// This is what makes "beat 1 and 3" in the popover actually mean beats, not
// an arbitrary fraction of a numerator-shaped bar.
function stepsPerBeatUnit(resolution) {
  return Math.max(resolution, 1) / 4;
}

function stepDuration(spawn) {
  if (spawn.beatSelect.type === 'manual') {
    return beatDuration(spawn.meter.denominator) / stepsPerBeatUnit(spawn.beatSelect.manual.resolution);
  }
  return beatDuration(spawn.meter.denominator);
}

/** Exposed so the popover can resize the manual step grid the same way when numerator or resolution changes. */
export function manualStepCount(meter, resolution) {
  return Math.round(Math.max(meter.numerator, 1) * stepsPerBeatUnit(resolution));
}

/** How many steps make one full cycle, for drift purposes — one bar either way. */
function stepsPerCycle(spawn) {
  if (spawn.beatSelect.type === 'manual') {
    return Math.round(spawn.meter.numerator * stepsPerBeatUnit(spawn.beatSelect.manual.resolution));
  }
  return spawn.meter.numerator;
}

function driftPick(max) {
  return 1 + Math.floor(Math.random() * Math.max(max, 1));
}

function evaluateBeatAt(spawn, stepInBar, genIndex) {
  const { type } = spawn.beatSelect;

  if (type === 'none') return true;

  if (type === 'manual') {
    const { steps } = spawn.beatSelect.manual;
    if (!steps.length) return false;
    return !!steps[stepInBar % steps.length];
  }

  // One of the math generators (euclidean/prime/fibonacci/markov/lfsr/wolfram),
  // either/or with 'manual' — no layering, per the "cleaner for now" call.
  // These get their own ever-incrementing index (not reset per bar) so the
  // live ones (markov/lfsr/wolfram) keep evolving across bars as intended.
  const config = type === 'euclidean' ? spawn.beatSelect.euclid : {};
  const key = `${type}:${JSON.stringify(config)}`;
  if (spawn.gate.type !== type || spawn._gateKey !== key) {
    spawn.gate.type = type;
    spawn.gate.config = config;
    spawn.gate._generator = null;
    spawn._gateKey = key;
  }
  if (!spawn.gate._generator) spawn.gate._generator = createGenerator(type, spawn.gate.config);
  return spawn.gate._generator.read(genIndex);
}

/**
 * Snaps a spawner's bar anchor to whichever bar currently contains
 * `clockSeconds`, recomputed fresh from its *current* meter every time this
 * runs. There's no stored "meter signature" to compare against anymore — a
 * meter edited mid-bar, a spawner switched off and back on, and the very
 * first tick all just land here and get the same one answer: "what bar is
 * *now* in, under whatever the settings currently say." Nothing about how
 * long it's been, or how many bars were skipped to get here, matters.
 * `isFirstAnchor` skips the drift reroll — drift picks a new number when a
 * bar *completes*, which an object's very first tick hasn't done yet.
 */
function landInCurrentBar(spawn, { isFirstAnchor }) {
  const dur = stepDuration(spawn);
  const cycleLen = stepsPerCycle(spawn);
  const barLen = dur * cycleLen;
  spawn._barStartClock = barLen > 0 ? Math.floor(clockSeconds / barLen) * barLen : clockSeconds;
  spawn._lastFiredStep = -1;
  if (!isFirstAnchor) {
    if (spawn.meter.numeratorDriftMax > 0) spawn.meter.numerator = driftPick(spawn.meter.numeratorDriftMax);
    if (spawn.meter.denominatorDriftMax > 0) spawn.meter.denominator = driftPick(spawn.meter.denominatorDriftMax);
  }
}

/**
 * Edge-triggered, no replay, no guard needed because there's no loop left to
 * bound: each tick works out which step index the clock is in *right now*
 * and fires at most once, only if that differs from the step last fired.
 * Time spent off, a meter changed mid-bar, a laggy/backgrounded frame — none
 * of it gets "remembered" as a debt to catch up on. A gap just gets skipped,
 * never replayed — deliberately traded for "no burst, ever," over "every
 * historical tick eventually plays." This
 * replaced an earlier while-loop-with-a-64-iteration-cap version that could
 * still dump a real burst of particles in one frame when an anchor went
 * stale (from a spawner sitting off for a while, in particular).
 */
/**
 * `getLiveBodyCount` is injected rather than imported (main.js passes
 * physics/sync.js's own getLiveBodyCount) so this module never has to import
 * physics/world.js — that file touches `window.Matter` at module load time,
 * which would break transport.test.js's headless/no-browser import of this
 * file. Optional: the object cap is off by default, and when a caller
 * doesn't supply it the cap check just no-ops rather than throwing.
 */
export function tickSpawners(deltaSeconds, { getLiveBodyCount } = {}) {
  clockSeconds += deltaSeconds;

  for (const obj of listObjects()) {
    if (obj.preset !== 'spawner' || !obj.spawn || !obj.physics.live) continue;
    const spawn = obj.spawn;

    if (spawn._barStartClock == null) {
      landInCurrentBar(spawn, { isFirstAnchor: true });
      spawn._genIndex = 0;
    }

    let dur = stepDuration(spawn);
    let cycleLen = stepsPerCycle(spawn);
    const barLen = dur * cycleLen;
    if (barLen > 0 && clockSeconds >= spawn._barStartClock + barLen) {
      landInCurrentBar(spawn, { isFirstAnchor: false });
      dur = stepDuration(spawn);
      cycleLen = stepsPerCycle(spawn);
    }

    const stepInBar = cycleLen > 0 && dur > 0
      ? Math.min(cycleLen - 1, Math.max(0, Math.floor((clockSeconds - spawn._barStartClock) / dur)))
      : 0;

    if (stepInBar !== spawn._lastFiredStep) {
      spawn._lastFiredStep = stepInBar;
      const fires = evaluateBeatAt(spawn, stepInBar, spawn._genIndex);
      spawn._genIndex += 1;
      if (fires) {
        // Object cap (off by default, physics card): silently skip the spawn
        // rather than emit and instantly feel the consequences — a spawner
        // just doesn't emit while at the cap, existing particles keep
        // living/dying normally, same "quietly cap rather than burst"
        // philosophy as this function's own edge-triggered design above.
        const settings = getPhysicsSettings();
        const atCap = settings.objectCapEnabled && getLiveBodyCount && getLiveBodyCount() >= settings.objectCap;
        if (!atCap) addObject(createParticle(obj));
      }
    }
  }
}
