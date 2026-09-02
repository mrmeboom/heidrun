// Shared "play this now-ish" entry point — resolves pitch/chord via theory.js
// and dispatches to the instrument's voice module, scheduled against
// audioCtx.currentTime rather than wall-clock (architecture.md §6).
import { getAudioContext } from './context.js';
import { playKick } from './voices/kick.js';
import { playSnare } from './voices/snare.js';
import { playHat } from './voices/hats.js';
import { playBass } from './voices/bass.js';
import { playPad } from './voices/pad.js';
import { playMelody } from './voices/melody.js';
import { resolveFrequency, resolveChordFrequencies } from './theory.js';
import { getInstrumentSettings } from '../state/canvasState.js';

const LOOKAHEAD = 0.01;

/**
 * @param {import('../state/object.js').SoundModule} sound
 * @param {{ rootMidi: number, mode: string }} effectiveKey
 * @param {number} [positionIndex]  used by 'positional' pitch behavior (peg fields)
 * @param {boolean} [accented]  when true, sound.accent's pitch behavior/degree
 *   replaces the normal one for this note instead of adding an extra note
 */
export function scheduleNote(sound, effectiveKey, positionIndex = 0, accented = false) {
  const ctx = getAudioContext();
  const time = ctx.currentTime + LOOKAHEAD;
  const sends = { sendReverb: sound.sendReverb, sendDelay: sound.sendDelay };
  // sound.accent has the same {pitchBehavior, fixedDegree, pitchRange} shape
  // as sound itself, so it can stand in directly for pitch/chord resolution.
  // It has no `pianoNotes` of its own though (state/object.js's SoundModule typedef) — accent's
  // Piano mode always walks the parent `sound`'s picked notes, just with its
  // own cycle order, so `sound.pianoNotes` is always what's passed in below,
  // regardless of which one (`sound` or `sound.accent`) is doing the resolving.
  const pitchSource = accented && sound.accent ? sound.accent : sound;
  const settings = getInstrumentSettings(sound.instrument) ?? {};

  switch (sound.instrument) {
    case 'kick':
      playKick(time, { sends, settings });
      break;
    case 'snare':
      playSnare(time, { sends, settings });
      break;
    case 'hat':
      playHat(time, { sends, settings });
      break;
    case 'bass': {
      // A Piano selection with nothing picked plays nothing at all — same as
      // an empty manual gate pattern never firing, not a fallback note.
      const freq = resolveFrequency(pitchSource, effectiveKey, positionIndex, sound.pianoNotes);
      if (freq == null) break;
      playBass(time, freq / 2, { sends, settings });
      break;
    }
    case 'pad': {
      const freqs = resolveChordFrequencies(pitchSource, effectiveKey, positionIndex, sound.pianoNotes);
      if (freqs.length === 0) break;
      playPad(time, freqs, { sends, settings });
      break;
    }
    case 'melody':
    default: {
      const freq = resolveFrequency(pitchSource, effectiveKey, positionIndex, sound.pianoNotes);
      if (freq == null) break;
      playMelody(time, freq, { sends, settings });
    }
  }
}
