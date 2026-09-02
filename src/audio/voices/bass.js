import { connectSends, getAudioContext } from '../context.js';
import { noiseBuffer } from './noise.js';

/**
 * `settings` (canvasState.js's global per-instrument knobs — this is the
 * deepest of the three scale-resolved voices, "sub" included per feedback):
 * `tone`/`pitch` plus a full ADSR-shaped amplitude envelope (`attack`/
 * `decay`/`sustainLevel`/`sustainTime`/`release`) are the shared baseline
 * across bass/pad/melody; everything from `waveform` down is bass-specific sound
 * design, all still just standard WebAudio nodes — no new dependency.
 * - Envelope: every note here is a physics-triggered one-shot "plonk," not a
 *   held key, so there's no real note-off for a normal ADSR's Sustain stage
 *   to release against. `sustainTime` fakes it: Attack ramps to full peak,
 *   Decay brings it down to `sustainLevel`, that level holds for
 *   `sustainTime` seconds (0 by default — an immediate Attack→Decay→Release
 *   "plonk," this voice's original shape, just with Decay/Sustain now
 *   explicit instead of collapsed into one knob), then Release fades to
 *   silence. Dialing `sustainTime` up is how you fake a longer, held-feeling
 *   note out of a one-shot trigger.
 * - `waveform`: oscillator type.
 * - `resonance`: filter Q.
 * - `filterEnvDepth`/`filterEnvSpeed`: how far and how fast the lowpass
 *   sweeps down from its (tone-scaled) starting cutoff — parameterizes the
 *   sweep that used to be hardcoded 1200→300Hz, default depth (900)
 *   reproduces that original motion.
 * - `unisonDetune`/`unisonMix`: a second oscillator `unisonDetune` semitones
 *   away, blended in at `unisonMix` — 0 mix is silent/free, so this costs
 *   nothing when unused.
 * - `subLevel`: an extra sine oscillator one octave down, routed to the
 *   output *before* the filter so the low end doesn't get swept away by the
 *   filter envelope — the one deliberately-not-generalized voice here,
 *   since a filtered sub defeats the point of a sub.
 * - `vibratoRate`/`vibratoDepth`: an LFO into every active oscillator's
 *   `.detune` AudioParam — audio-rate modulation, no extra JS-side cost.
 * - `noiseMix`: a short filtered noise transient blended into the attack.
 */
export function playBass(time, freq, { sends = {}, settings = {} } = {}) {
  const {
    attack = 0.01, decay = 0, sustainLevel = 1, sustainTime = 0, release = 0.4,
    tone = 1, pitch = 0,
    waveform = 'sawtooth', resonance = 1,
    filterEnvDepth = 900, filterEnvSpeed = 1,
    unisonDetune = 0, unisonMix = 0,
    vibratoRate = 5, vibratoDepth = 0,
    noiseMix = 0, subLevel = 0,
  } = settings;
  const ctx = getAudioContext();
  const baseFreq = freq * Math.pow(2, pitch);
  const attackEnd = time + attack;
  const decayEnd = attackEnd + Math.max(decay, 0.001);
  const holdEnd = decayEnd + sustainTime;
  const stopTime = holdEnd + release + 0.05;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const startCutoff = Math.max(40, 1200 * tone);
  const endCutoff = Math.max(40, startCutoff - filterEnvDepth);
  filter.frequency.setValueAtTime(startCutoff, time);
  filter.frequency.exponentialRampToValueAtTime(endCutoff, time + 0.3 * filterEnvSpeed);
  filter.Q.value = resonance;

  const peak = 0.6;
  const sustainPeak = peak * Math.max(sustainLevel, 0.0001);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
  gain.gain.exponentialRampToValueAtTime(sustainPeak, decayEnd);
  gain.gain.setValueAtTime(sustainPeak, holdEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, holdEnd + release);
  filter.connect(gain);
  connectSends(gain, sends);

  const osc = ctx.createOscillator();
  osc.type = waveform;
  osc.frequency.value = baseFreq;
  osc.connect(filter);
  osc.start(time);
  osc.stop(stopTime);
  const oscillators = [osc];

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

  if (subLevel > 0) {
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = baseFreq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = subLevel;
    sub.connect(subGain).connect(gain);
    sub.start(time);
    sub.stop(stopTime);
    oscillators.push(sub);
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
    noiseFilter.frequency.value = 800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(noiseMix, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    noise.connect(noiseFilter).connect(noiseGain).connect(gain);
    noise.start(time);
    noise.stop(time + 0.06);
  }
}
