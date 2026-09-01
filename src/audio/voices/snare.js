import { connectSends, getAudioContext } from '../context.js';
import { noiseBuffer } from './noise.js';

/** `settings`: `decay` scales both the body and crack envelopes, `tone`
 * scales the crack's bandpass center frequency, `pitch` scales the body's
 * frequency sweep. */
export function playSnare(time, { sends = {}, settings = {} } = {}) {
  const { decay = 1, tone = 1, pitch = 1 } = settings;
  const ctx = getAudioContext();

  // Body: a short tonal thump, lower and punchier than the hat has any of.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(190 * pitch, time);
  osc.frequency.exponentialRampToValueAtTime(120 * pitch, time + 0.1);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.6, time);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.14 * decay);

  // Crack: mid-band noise (not the hat's bright top end) — this is what
  // actually reads as "snare" rather than "hat with extra steps".
  const crackNoise = ctx.createBufferSource();
  crackNoise.buffer = noiseBuffer(ctx, 0.22 * decay);
  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = 'bandpass';
  crackFilter.frequency.value = 2800 * tone;
  crackFilter.Q.value = 0.7;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.8, time);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22 * decay);

  const mix = ctx.createGain();
  osc.connect(oscGain).connect(mix);
  crackNoise.connect(crackFilter).connect(crackGain).connect(mix);
  connectSends(mix, sends);

  osc.start(time);
  osc.stop(time + 0.16 * decay);
  crackNoise.start(time);
  crackNoise.stop(time + 0.24 * decay);
}
