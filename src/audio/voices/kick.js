import { connectSends, getAudioContext } from '../context.js';

/**
 * `settings` (canvasState.js's global per-instrument knobs): `decay` scales
 * the pitch-sweep and amplitude envelope together (a "faster/slower kick"
 * knob), `tone` scales the sweep's starting multiplier (higher = sharper
 * click, lower = softer thump — reuses the existing pitch-envelope instead
 * of adding a filter node, since that's already the thing giving this voice
 * its character), `pitch` scales the base frequency directly.
 */
export function playKick(time, { freq = 55, sends = {}, settings = {} } = {}) {
  const { decay = 1, tone = 1, pitch = 1 } = settings;
  const ctx = getAudioContext();
  const baseFreq = freq * pitch;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseFreq * 4 * tone, time);
  osc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.08 * decay);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(1, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35 * decay);
  osc.connect(gain);
  connectSends(gain, sends);
  osc.start(time);
  osc.stop(time + 0.4 * decay);
}
