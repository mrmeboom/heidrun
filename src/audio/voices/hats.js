import { connectSends, getAudioContext } from '../context.js';
import { noiseBuffer } from './noise.js';

/** `settings`: `decay` scales duration, `tone` scales the highpass cutoff,
 * `pitch` resamples the noise buffer (`playbackRate`) — there's no real
 * pitch on white noise, but resampling shifts its perceived grain/color, so
 * this still gives the knob a meaningful, audible effect. */
export function playHat(time, { open = false, sends = {}, settings = {} } = {}) {
  const { decay = 1, tone = 1, pitch = 1 } = settings;
  const ctx = getAudioContext();
  const duration = (open ? 0.25 : 0.035) * decay;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, duration);
  noise.playbackRate.value = pitch;
  // Pushed well above the snare's mid-band crack (2800Hz) so the two never
  // read as the same sound — this should be pure glassy top end.
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 9500 * tone;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.45, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  noise.connect(highpass).connect(gain);
  connectSends(gain, sends);
  noise.start(time);
  noise.stop(time + duration + 0.02);
}
