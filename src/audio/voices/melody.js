import { connectSends, getAudioContext } from '../context.js';
import { noiseBuffer } from './noise.js';

/** `settings` — same vocabulary as bass.js/pad.js. The old hardcoded second
 * oscillator (a fixed +2.01x "shimmer" overtone at 0.3 mix) is now just the
 * default `unisonDetune`/`unisonMix` values (12 semitones ≈ that same
 * octave-ish interval, 0.3 mix) — same sound out of the box, but tunable
 * instead of baked in. No `subLevel` — melody has no low-end role to protect
 * the way bass's sub does. Same ADSR-with-fake-sustain envelope as
 * bass.js/pad.js: Attack ramps to full peak, Decay brings it to
 * `sustainLevel`, that level holds for `sustainTime` (0 default = the
 * original quick pluck, just with Decay/Sustain now explicit), then Release
 * fades out. */
export function playMelody(time, freq, { sends = {}, settings = {} } = {}) {
  const {
    attack = 0.01, decay = 0, sustainLevel = 1, sustainTime = 0, release = 0.6,
    tone = 1, pitch = 0,
    waveform = 'sine', resonance = 1,
    filterEnvDepth = 0, filterEnvSpeed = 1,
    unisonDetune = 12, unisonMix = 0.3,
    vibratoRate = 5, vibratoDepth = 0,
    noiseMix = 0,
  } = settings;
  const ctx = getAudioContext();
  const baseFreq = freq * Math.pow(2, pitch);
  const attackEnd = time + attack;
  const decayEnd = attackEnd + Math.max(decay, 0.001);
  const holdEnd = decayEnd + sustainTime;
  const stopTime = holdEnd + release + 0.05;

  const gain = ctx.createGain();
  const peak = 0.5;
  const sustainPeak = peak * Math.max(sustainLevel, 0.0001);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
  gain.gain.exponentialRampToValueAtTime(sustainPeak, decayEnd);
  gain.gain.setValueAtTime(sustainPeak, holdEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, holdEnd + release);

  // Cutoff defaults well above what a sine/triangle pair actually produces,
  // so Tone at its default (1) is inaudible — the filter only starts doing
  // something once it's actually turned down.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const startCutoff = Math.max(80, 4000 * tone);
  filter.frequency.setValueAtTime(startCutoff, time);
  if (filterEnvDepth > 0) {
    const endCutoff = Math.max(80, startCutoff - filterEnvDepth);
    filter.frequency.exponentialRampToValueAtTime(endCutoff, time + release * filterEnvSpeed);
  }
  filter.Q.value = resonance;
  filter.connect(gain);
  connectSends(gain, sends);

  const osc1 = ctx.createOscillator();
  osc1.type = waveform;
  osc1.frequency.value = baseFreq;
  osc1.connect(filter);
  osc1.start(time);
  osc1.stop(stopTime);
  const oscillators = [osc1];

  if (unisonMix > 0) {
    const osc2 = ctx.createOscillator();
    osc2.type = waveform;
    osc2.frequency.value = baseFreq * Math.pow(2, unisonDetune / 12);
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = unisonMix;
    osc2.connect(osc2Gain).connect(filter);
    osc2.start(time);
    osc2.stop(stopTime);
    oscillators.push(osc2);
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
    noise.buffer = noiseBuffer(ctx, 0.05);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(noiseMix * 0.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    noise.connect(noiseFilter).connect(noiseGain).connect(gain);
    noise.start(time);
    noise.stop(time + 0.06);
  }
}
