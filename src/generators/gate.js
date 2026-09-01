// Evaluates a hit/tick-indexed gate (prototype.md §8.6) and advances its index.
// A null type means "always-on" — every hit/tick passes, the default for sound
// modules per §8.6, and how a spawner's exact schedule passes straight through
// a receiving object untouched. 'off' is the opposite sentinel — always fails,
// never advances its index — used where "always-on" isn't a sensible default
// (e.g. the accent gate, where "off" needs to mean "no accents" rather than
// "accent every note").
import { createGenerator } from './index.js';

export function evaluateGate(gate) {
  if (!gate) return true;
  if (gate.type === 'off') return false;
  if (gate.type == null) {
    // Still the hit counter (state/object.js's GateConfig doc: "gate.index
    // doubles as the hit counter") even though "always on" itself does no
    // filtering — main.js's accent gate phase-locks to this index via
    // evaluateGateAt, so it has to advance on every hit regardless of
    // whether the main gate ever actually filters anything. Previously this
    // branch returned early without incrementing, which silently pinned
    // every hit-indexed accent/generator reading off this gate's counter to
    // index 0 forever whenever the main gate was left at its default
    // "always on" — manual accent patterns only ever matched step 0, and
    // prime/markov/etc accent generators only ever read their very first
    // value, no matter how many times the object was actually hit.
    gate.index += 1;
    return true;
  }
  if (gate.type === 'manual') {
    const steps = gate.config?.manual?.steps ?? [];
    if (!steps.length) return false;
    const fires = !!steps[gate.index % steps.length];
    gate.index += 1;
    return fires;
  }
  if (!gate._generator) gate._generator = createGenerator(gate.type, gate.config);
  const result = gate._generator.read(gate.index);
  gate.index += 1;
  return result;
}

export function resetGate(gate) {
  gate.index = 0;
  gate._generator?.reseed?.();
}

// Reads a gate at a caller-supplied index instead of advancing its own
// counter — used to phase-lock the accent gate to the main gate's index
// (the hit-index that just made the main gate fire), rather than letting it
// run its own independently-incrementing "how many notes has this accent
// gate seen" counter. Those two counters used to disagree: the main gate
// counts every hit, the accent gate only ever got called on hits that
// already passed the main gate, so its own index advanced on a slower,
// filtered cadence — "accent step 15" meant "the 16th note that ever
// sounded," not "the note sitting at position 15 in the main gate's own
// pattern." Reading at the shared index fixes that for every index-driven
// type (manual, prime, fibonacci, euclidean); the three live generators
// (markov/lfsr/wolfram) ignore the index argument and advance their own
// internal state per call regardless, same as before.
export function evaluateGateAt(gate, index) {
  if (!gate) return true;
  if (gate.type === 'off') return false;
  if (gate.type == null) return true;
  if (gate.type === 'manual') {
    const steps = gate.config?.manual?.steps ?? [];
    if (!steps.length) return false;
    return !!steps[index % steps.length];
  }
  if (!gate._generator) gate._generator = createGenerator(gate.type, gate.config);
  return gate._generator.read(index);
}
