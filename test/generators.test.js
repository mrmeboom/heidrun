import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIME_TABLE, FIBONACCI_GATE_TABLE } from '../src/generators/tables.js';
import { createGenerator, GENERATOR_TYPES } from '../src/generators/index.js';
import { bjorklund } from '../src/generators/euclidean.js';
import { evaluateGate, evaluateGateAt } from '../src/generators/gate.js';

test('prime table matches known primes below 128', () => {
  const knownPrimes = new Set([
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107,
    109, 113, 127,
  ]);
  for (let i = 0; i < 128; i++) {
    assert.equal(PRIME_TABLE[i], knownPrimes.has(i), `index ${i}`);
  }
});

test('fibonacci gate table expands the gap-length rule correctly', () => {
  // gaps [0,1,1,2,3,...] → 1, 10, 10, 100, 1000, ...
  const expectedStart = [true, false, true, false, true, false, false, true, false, false, false, true];
  assert.deepEqual(FIBONACCI_GATE_TABLE.slice(0, expectedStart.length), expectedStart);

  const gaps = [0, 1, 1, 2, 3, 5, 2, 1, 3, 4, 1, 5, 0, 5, 5, 4, 3, 1, 4, 5, 3, 2, 5, 1];
  const expectedLen = gaps.reduce((a, b) => a + b, 0) + gaps.length;
  assert.equal(FIBONACCI_GATE_TABLE.length, expectedLen);
});

test('table-backed generators read straight from their tables', () => {
  const prime = createGenerator('prime');
  for (let i = 0; i < 20; i++) assert.equal(prime.read(i), PRIME_TABLE[i]);

  const fib = createGenerator('fibonacci');
  for (let i = 0; i < 20; i++) assert.equal(fib.read(i), FIBONACCI_GATE_TABLE[i]);
});

test('markov generator is stable for a repeated index and reseed produces a boolean', () => {
  const gen = createGenerator('markov', { seed: 0 });
  const first = gen.read(0);
  assert.equal(gen.read(0), first);
  gen.reseed(0);
  assert.equal(typeof gen.read(0), 'boolean');
});

test('lfsr generator is deterministic given the same seed', () => {
  const a = createGenerator('lfsr', { seed: 1234 });
  const b = createGenerator('lfsr', { seed: 1234 });
  const seqA = Array.from({ length: 20 }, (_, i) => a.read(i));
  const seqB = Array.from({ length: 20 }, (_, i) => b.read(i));
  assert.deepEqual(seqA, seqB);
});

test('wolfram generator is deterministic given the same seed', () => {
  const a = createGenerator('wolfram', { seed: 12345, rule: 30 });
  const b = createGenerator('wolfram', { seed: 12345, rule: 30 });
  const seqA = Array.from({ length: 20 }, (_, i) => a.read(i));
  const seqB = Array.from({ length: 20 }, (_, i) => b.read(i));
  assert.deepEqual(seqA, seqB);
});

test('euclidean bjorklund(3, 8) matches the classic tresillo pattern', () => {
  const pattern = bjorklund(3, 8);
  assert.equal(pattern.length, 8);
  assert.equal(pattern.filter(Boolean).length, 3);
  assert.deepEqual(pattern, [true, false, false, true, false, false, true, false]);
});

test('euclidean generator loops its pattern', () => {
  const gen = createGenerator('euclidean', { hits: 3, steps: 8, rotation: 0 });
  const seq = Array.from({ length: 16 }, (_, i) => gen.read(i));
  assert.deepEqual(seq.slice(0, 8), seq.slice(8, 16));
});

test('all six generator types are constructible and return booleans', () => {
  for (const type of GENERATOR_TYPES) {
    const gen = createGenerator(type);
    assert.equal(typeof gen.read(0), 'boolean');
  }
});

test('evaluateGate advances index on an "always on" (null) gate, same as every other type', () => {
  // Regression: a null-type gate returned early without incrementing
  // gate.index, which pinned every hit to index 0 forever. Since
  // gate.index doubles as the hit counter main.js phase-locks the accent
  // gate to, this silently broke accent patterns on any object whose main
  // Gate was left at its default "always on" — a manual accent pattern only
  // ever matched step 0, and prime/markov/etc accent generators only ever
  // read their first value, no matter how many real hits happened.
  const gate = { type: null, config: {}, index: 0 };
  for (let i = 0; i < 5; i++) {
    assert.equal(evaluateGate(gate), true);
    assert.equal(gate.index, i + 1);
  }
});

test('an accent gate phase-locked to an always-on main gate actually advances across hits', () => {
  // End-to-end shape of main.js's onHit: capture the main gate's index
  // before firing it, then read the accent gate at that same index.
  const mainGate = { type: null, config: {}, index: 0 };
  const accentGate = { type: 'manual', config: { manual: { steps: [false, false, false, true] } }, index: 0 };
  const fires = [];
  for (let i = 0; i < 8; i++) {
    const hitIndex = mainGate.index;
    evaluateGate(mainGate);
    fires.push(evaluateGateAt(accentGate, hitIndex));
  }
  // Only the 4th and 8th hits (index 3 and 7) land on the selected step.
  assert.deepEqual(fires, [false, false, false, true, false, false, false, true]);
});
