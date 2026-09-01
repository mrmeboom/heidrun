import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestDegreeForSemitone,
  quantizeToScale,
  resolvePianoOffset,
  resolveFrequency,
  resolveChordFrequencies,
  midiToFrequency,
} from '../src/audio/theory.js';

test('nearestDegreeForSemitone finds the closest scale step, ties favor the lower one', () => {
  // Major scale semitones: 0,2,4,5,7,9,11 — degree indices 0..6.
  assert.equal(nearestDegreeForSemitone('major', 0), 0);
  assert.equal(nearestDegreeForSemitone('major', 4), 2);
  // 1 is equidistant from 0 and 2 — ties favor the lower (degree 0).
  assert.equal(nearestDegreeForSemitone('major', 1), 0);
  // 6 is equidistant from 5 and 7 — favors the lower (degree 3, semitone 5).
  assert.equal(nearestDegreeForSemitone('major', 6), 3);
  // Octave carry: 12 + 0 should be degree 7 (one full octave, 7 steps up).
  assert.equal(nearestDegreeForSemitone('major', 12), 7);
});

test('quantizeToScale snaps out-of-scale semitones and leaves in-scale ones alone', () => {
  assert.equal(quantizeToScale('major', 4), 4); // already in scale
  assert.equal(quantizeToScale('major', 3), 2); // C#3->closer to D(2) than E... actually nearest of 2,4 to 3 is a tie, lower wins: 2
  assert.equal(quantizeToScale('major', 12 + 3), 12 + 2); // octave carried through
});

test('resolvePianoOffset cycles up/down/updown/downup and bounces at the ends without repeating', () => {
  const notes = [7, 0, 4]; // deliberately unsorted — function should sort internally
  const up = { pianoCycle: 'up' };
  assert.deepEqual([0, 1, 2, 3, 4].map(() => resolvePianoOffset(notes, up)), [0, 4, 7, 0, 4]);

  const down = { pianoCycle: 'down' };
  assert.deepEqual([0, 1, 2, 3].map(() => resolvePianoOffset(notes, down)), [7, 4, 0, 7]);

  const bounce = { pianoCycle: 'updown' };
  // 0,4,7,7,4,0,0,4 pattern: reverses at each end without repeating the boundary twice.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(() => resolvePianoOffset(notes, bounce)), [0, 4, 7, 4, 0, 4]);
});

test('resolvePianoOffset returns null for an empty selection, and the single-note case never crashes', () => {
  assert.equal(resolvePianoOffset([], { pianoCycle: 'up' }), null);
  assert.equal(resolvePianoOffset(null, { pianoCycle: 'up' }), null);
  const single = { pianoCycle: 'updown' };
  assert.equal(resolvePianoOffset([5], single), 5);
  assert.equal(resolvePianoOffset([5], single), 5);
});

test('resolveFrequency (piano) transposes for free via rootMidi and returns null when nothing is selected', () => {
  const sound = { pitchBehavior: 'piano', pianoNotes: [4], pianoCycle: 'up' };
  const freq = resolveFrequency(sound, { rootMidi: 60, mode: 'major' });
  assert.equal(freq, midiToFrequency(64));
  // Same object, different root — same stored offset, different resolved pitch, no mutation needed.
  const freqTransposed = resolveFrequency(sound, { rootMidi: 62, mode: 'major' });
  assert.equal(freqTransposed, midiToFrequency(66));

  const empty = { pitchBehavior: 'piano', pianoNotes: [], pianoCycle: 'up' };
  assert.equal(resolveFrequency(empty, { rootMidi: 60, mode: 'major' }), null);
});

test('resolveChordFrequencies (piano): raw chromatic pitch when chord is off, snapped-to-scale stack when on', () => {
  const soundNoChord = { pitchBehavior: 'piano', pianoNotes: [3], pianoCycle: 'up', chord: { auto: false, complexity: 'triad' } };
  assert.deepEqual(resolveChordFrequencies(soundNoChord, { rootMidi: 60, mode: 'major' }), [midiToFrequency(63)]);

  const soundChord = { pitchBehavior: 'piano', pianoNotes: [3], pianoCycle: 'up', chord: { auto: true, complexity: 'triad' } };
  const freqs = resolveChordFrequencies(soundChord, { rootMidi: 60, mode: 'major' });
  assert.equal(freqs.length, 3);
  // Root snaps to nearest degree (semitone 3 -> degree 1, semitone 2) instead of staying raw chromatic.
  assert.equal(freqs[0], midiToFrequency(62));

  const emptyChord = { pitchBehavior: 'piano', pianoNotes: [], pianoCycle: 'up', chord: { auto: true, complexity: 'triad' } };
  assert.deepEqual(resolveChordFrequencies(emptyChord, { rootMidi: 60, mode: 'major' }), []);
});

test('resolveFrequency (piano, accented) reads the parent pianoNotes, not its own', () => {
  const accent = { pitchBehavior: 'piano', pianoCycle: 'up' }; // no pianoNotes of its own
  const parentNotes = [9];
  const freq = resolveFrequency(accent, { rootMidi: 60, mode: 'major' }, 0, parentNotes);
  assert.equal(freq, midiToFrequency(69));
});
