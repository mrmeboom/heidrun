import { connectSends, getAudioContext } from '../context.js';
import { noiseBuffer } from './noise.js';

/** `settings` — same vocabulary as bass.js, no `subLevel` (a sub under a
 * stacked chord just muddies it, so that one knob is bass-only). Same
 * ADSR-with-fake-sustain envelope as bass.js/melody.js: Attack ramps to full
 * peak, Decay brings it to `sustainLevel`, that level holds for
 * `sustainTime` (0 default = a plain Attack→Decay→Release swell, this
 * voice's original shape), then Release fades out — a pad's whole character
 * already lived in slow attack/release times, Decay/`sustainTime` just make
 * the swell's shape and any held plateau explicit instead of implicit. */
export function playPad(time, freqs, { sends = {}, settings = {} } = {}) {
  const {
    attack = 0.6, decay = 0, sustainLevel = 1, sustainTime = 0, release = 2.5,
    tone = 1, pitch = 0,
    waveform = 'triangle', resonance = 1,
    filterEnvDepth = 0, filterEnvSpeed = 1,
    unisonDetune = 0, unisonMix = 0,
    vibratoRate = 5, vibratoDepth = 0,
    noiseMix = 0,
  } = settings;
  const ctx = getAudioContext();
  const attackEnd = time + attack;
  const decayEnd = attackEnd + Math.max(decay, 0.001);
  const holdEnd = decayEnd + sustainTime;
  const stopTime = holdEnd + release + 0.1;

  const gain = ctx.createGain();
  const peak = 0.25 / Math.max(freqs.length, 1);
  const sustainPeak = peak * Math.max(sustainLevel, 0.0001);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(peak, attackEnd);
  gain.gain.linearRampToValueAtTime(sustainPeak, decayEnd);
  gain.gain.setValueAtTime(sustainPeak, holdEnd);
  gain.gain.linearRampToValueAtTime(0.0001, holdEnd + release);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const startCutoff = Math.max(40, 2200 * tone);
  filter.frequency.setValueAtTime(startCutoff, time);
  if (filterEnvDepth > 0) {
    const endCutoff = Math.max(40, startCutoff - filterEnvDepth);
    filter.frequency.exponentialRampToValueAtTime(endCutoff, time + attack * filterEnvSpeed);
  }
  filter.Q.value = resonance;
  filter.connect(gain);
  connectSends(gain, sends);

  const oscillators = [];
  for (const freq of freqs) {
    const baseFreq = freq * Math.pow(2, pitch);
    const osc = ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.value = baseFreq;
    osc.connect(filter);
    osc.start(time);
    osc.stop(stopTime);
    oscillators.push(osc);

    if (unisonMix > 0) {
      const unisonOsc = ctx.createOscillator();
      unisonOsc.type = waveform;
      unisonOsc.frequency.value = baseFreq * Math.pow(2, unisonDetune / 12);
      const unisonGain = ctx.createGain();
      unisonGain.gain.value = unisonMix;
      unisonOsc.connect(unisonGain).connect(filter);
      unisonOsc.start(time);
      unisonOsc.stop(stopTime);
      oscillators.push(unisonOsc);
    }
  }

  if (vibratoDepth > 0) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = vibratoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = vibratoDepth;
    lfo.connect(lfoGain);
    for (const o of oscillators) lfoGain.connect(o.detune);
    lfo.start(time);
    lfo.stop(stopTime);
  }

  if (noiseMix > 0) {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 0.08);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1500;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(noiseMix * 0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    noise.connect(noiseFilter).connect(noiseGain).connect(gain);
    noise.start(time);
    noise.stop(time + 0.1);
  }
}
