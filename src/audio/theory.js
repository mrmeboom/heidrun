// Minimal music-theory helpers — scale degree → frequency, plus the shared
// pitch-behavior vocabulary (fixed / random / up / down /
// positional), reused for both single notes and pad chords.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

export const SCALE_NAMES = Object.keys(SCALES);

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const OCTAVES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Fixed octave 4 (C4 = MIDI 60) — enough for a compact "note + mode" override control. */
export function noteNameToMidi(note, octave = 4) {
  const index = NOTE_NAMES.indexOf(note);
  return (octave + 1) * 12 + (index < 0 ? 0 : index);
}

export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Inverse of midiToFrequency — used by es9/routing.js to turn a resolved
 * note frequency into a 1V/oct-relative MIDI number for CV output. */
export function frequencyToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Maps a scale-degree index (can be negative, can exceed one octave) to a frequency. */
export function degreeToFrequency(rootMidi, mode, degree) {
  const scale = SCALES[mode] ?? SCALES.major;
  const len = scale.length;
  const octave = Math.floor(degree / len);
  const step = ((degree % len) + len) % len;
  return midiToFrequency(rootMidi + scale[step] + octave * 12);
}

/**
 * Resolves the next scale-degree index for a sound module's pitch behavior.
 * `up`/`down` mutate a cursor stored on the sound module itself (§7 "Cycle-up/down").
 * `positional` (peg fields) uses the caller-supplied position instead of a cursor.
 */
export function resolvePitchDegree(sound, positionIndex = 0) {
  const range = sound.pitchRange ?? 14;
  switch (sound.pitchBehavior) {
    case 'fixed':
      return sound.fixedDegree ?? 0;
    case 'random':
      return Math.floor(Math.random() * range) - Math.floor(range / 2);
    case 'up':
      sound._cursor = ((sound._cursor ?? -1) + 1) % range;
      return sound._cursor;
    case 'down':
      sound._cursor = ((sound._cursor ?? range) - 1 + range) % range;
      return sound._cursor;
    case 'positional':
      return positionIndex % range;
    default:
      return 0;
  }
}

/**
 * Which scale degree (in `mode`) sits nearest a given chromatic semitone
 * offset-from-root — the bridge between Piano's chromatic picks and every
 * other pitch behavior's scale-degree math (`degreeToFrequency`). Ties (a
 * pick exactly between two in-scale neighbors) favor the lower one, since the
 * scale array is walked in ascending order and the first minimum wins.
 */
export function nearestDegreeForSemitone(mode, semitone) {
  const scale = SCALES[mode] ?? SCALES.major;
  const len = scale.length;
  const octave = Math.floor(semitone / 12);
  const within = ((semitone % 12) + 12) % 12;
  let bestDegree = 0;
  let bestDist = Infinity;
  for (let i = 0; i < len; i++) {
    const dist = Math.abs(scale[i] - within);
    const wrapped = Math.min(dist, 12 - dist);
    if (wrapped < bestDist) {
      bestDist = wrapped;
      bestDegree = i;
    }
  }
  return bestDegree + octave * len;
}

/** The nearest in-scale semitone offset to a given one — used by
 * canvasState.js to re-snap `pianoNotes` when an object's effective mode
 * changes. Already-in-scale input round-trips unchanged. */
export function quantizeToScale(mode, semitone) {
  const scale = SCALES[mode] ?? SCALES.major;
  const len = scale.length;
  const degree = nearestDegreeForSemitone(mode, semitone);
  const octave = Math.floor(degree / len);
  const step = ((degree % len) + len) % len;
  return scale[step] + octave * 12;
}

/**
 * Piano's traversal over a hand-picked, unordered set of chromatic
 * semitone-offsets-from-root (the piano note-picker) —
 * a genuinely different shape from `resolvePitchDegree`'s cursor, since
 * bounce (`updown`/`downup`) needs to remember which way it was heading and
 * wrap (`up`/`down`) doesn't. `cursorHolder` is whichever sound-shaped object
 * owns the traversal state for this call — the main sound module normally,
 * or `sound.accent` when accenting (accent has its own `pianoCycle` cursor
 * but no `pianoNotes` of its own; it always walks the parent's). Returns
 * `null` for an empty set — an empty selection plays nothing, same as an
 * empty manual gate pattern never firing.
 */
export function resolvePianoOffset(notes, cursorHolder) {
  if (!notes || notes.length === 0) return null;
  const sorted = [...notes].sort((a, b) => a - b);
  const n = sorted.length;
  const cycle = cursorHolder.pianoCycle ?? 'up';

  if (cycle === 'random') return sorted[Math.floor(Math.random() * n)];
  if (n === 1) return sorted[0]; // nothing to cycle through either direction

  if (cycle === 'up') {
    cursorHolder._pianoCursor = ((cursorHolder._pianoCursor ?? -1) + 1) % n;
    return sorted[cursorHolder._pianoCursor];
  }
  if (cycle === 'down') {
    cursorHolder._pianoCursor = ((cursorHolder._pianoCursor ?? n) - 1 + n) % n;
    return sorted[cursorHolder._pianoCursor];
  }

  // updown/downup: ping-pong across the sorted set, reversing at either end
  // instead of wrapping — 0,1,2,3,2,1,0,1,2,... not 0,1,2,3,3,2,1,0,0,1,...
  const startDir = cycle === 'downup' ? -1 : 1;
  let idx = cursorHolder._pianoCursor;
  let dir = cursorHolder._pianoDirection ?? startDir;
  if (idx == null) {
    idx = startDir === 1 ? 0 : n - 1;
  } else {
    idx += dir;
    if (idx >= n) {
      idx = n - 2;
      dir = -1;
    } else if (idx < 0) {
      idx = 1;
      dir = 1;
    }
  }
  cursorHolder._pianoCursor = idx;
  cursorHolder._pianoDirection = dir;
  return sorted[idx];
}

/**
 * @param {number[]} [pianoNotes]  the parent sound module's picked notes —
 *   defaults to `sound.pianoNotes` for the common case, but scheduleNote.js
 *   passes the *parent's* array explicitly when `sound` here is actually
 *   `sound.accent` (accent has no note set of its own, see resolvePianoOffset).
 */
export function resolveFrequency(sound, effectiveKey, positionIndex = 0, pianoNotes = sound.pianoNotes) {
  if (sound.pitchBehavior === 'piano') {
    const offset = resolvePianoOffset(pianoNotes, sound);
    if (offset == null) return null;
    return midiToFrequency(effectiveKey.rootMidi + offset);
  }
  const degree = resolvePitchDegree(sound, positionIndex);
  return degreeToFrequency(effectiveKey.rootMidi, effectiveKey.mode, degree);
}

const CHORD_INTERVALS = {
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  extended: [0, 2, 4, 6, 8, 10],
};

function stackChord(rootDegree, effectiveKey, complexity) {
  const intervals = CHORD_INTERVALS[complexity] ?? CHORD_INTERVALS.triad;
  return intervals.map((i) => degreeToFrequency(effectiveKey.rootMidi, effectiveKey.mode, rootDegree + i));
}

/**
 * Pad's root note always resolves through the same pitch-behavior vocabulary
 * as every other voice (fixed/random/up/down/piano) — a pad is "melody plus
 * an optional chord layer", not a separately-behaving voice. `sound.chord.auto`
 * only decides whether that root gets the extra chord tones stacked on top
 * (a genuine chord) or plays alone (a single note, same as melody/bass would
 * for that root) — it does not gate whether pitchBehavior is used at all.
 * Piano's chromatic root plays exactly as picked when chord is off (same
 * chromatic freedom as melody/bass get with piano); only stacking chord tones
 * on top needs a scale degree to add scale-relative intervals to, so that
 * conversion only happens in the chord-on branch (see `nearestDegreeForSemitone`).
 */
export function resolveChordFrequencies(sound, effectiveKey, positionIndex = 0, pianoNotes = sound.pianoNotes) {
  if (sound.pitchBehavior === 'piano') {
    const offset = resolvePianoOffset(pianoNotes, sound);
    if (offset == null) return [];
    if (!sound.chord?.auto) return [midiToFrequency(effectiveKey.rootMidi + offset)];
    return stackChord(nearestDegreeForSemitone(effectiveKey.mode, offset), effectiveKey, sound.chord?.complexity ?? 'triad');
  }
  const rootDegree = resolvePitchDegree(sound, positionIndex);
  if (!sound.chord?.auto) {
    return [degreeToFrequency(effectiveKey.rootMidi, effectiveKey.mode, rootDegree)];
  }
  return stackChord(rootDegree, effectiveKey, sound.chord?.complexity ?? 'triad');
}
