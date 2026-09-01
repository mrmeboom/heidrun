// Per-object ES-9 routing (prototype.md §15) — resolves a sound module's
// routing lines to actual channel voltages/audio on hit. Pure decision logic
// (glide, gate duration, patched-channel accounting) is exported separately
// from `triggerEs9` so it's testable without a real AudioContext
// (architecture.md §7).
import { resolveFrequency } from '../audio/theory.js';
import { frequencyToMidi } from '../audio/theory.js';
import {
  isConnected,
  getContext,
  getChannelLane,
  getMerger,
  channelIndex,
  getCalibration,
  getChannelCount,
} from './context.js';

const LOOKAHEAD = 0.01; // matches audio/scheduleNote.js
const PITCH_SETTLE = 0.003; // pitch must be stable before the gate's rising edge (handoff.md §5)

/**
 * 303-style auto-glide (prototype.md §15): legato/staccato are unconditional,
 * 'auto' glides only if the channel's previous note is still gated/enveloping
 * when this one fires.
 */
export function decideGlide(channelActive, glideMode) {
  if (glideMode === 'legato') return true;
  if (glideMode === 'staccato') return false;
  return !!channelActive;
}

/**
 * Gate/adsr high-duration, reusing the object's own internal ADSR
 * (handoff.md §5 — "just use the app's internal ADSR for gate timing")
 * instead of a separate gate-length control: Attack→Decay→Sustain-hold for
 * the deep tier (bass/pad/melody), or a short decay-scaled pulse for the
 * baseline percussive tier (kick/snare/hat), which has no attack/sustain of
 * its own to read.
 */
export function gateHighSeconds(settings = {}) {
  if (settings.attack != null) {
    return Math.max(0.02, (settings.attack || 0) + (settings.decay || 0) + (settings.sustainTime || 0));
  }
  return Math.max(0.02, 0.12 * (settings.decay ?? 1));
}

/** 1V/oct unit value (-1..1, what a ConstantSourceNode's .offset expects
 * before the interface's own gain scales it to actual volts) for a MIDI note
 * relative to the calibrated root. */
export function pitchToUnit(midiNote, calibration) {
  const volts = (midiNote - calibration.rootMidi) / 12;
  return Math.max(-1, Math.min(1, volts / calibration.fsVolts));
}

function collectEs9Lines(sound, used) {
  if (!sound?.es9?.enabled) return;
  for (const line of sound.es9.lines) used.add(line.channel);
}

/** "x/8 channels patched" readout (prototype.md §15) — every object with an
 * enabled ES-9 module contributes its lines' channels, deduplicated (shared
 * channels count once). */
export function patchedChannelSummary(objects) {
  const used = new Set();
  for (const obj of objects) {
    collectEs9Lines(obj.sound, used);
    collectEs9Lines(obj.field?.sound, used);
    collectEs9Lines(obj.spawn?.particleSound, used);
  }
  return { used: [...used].sort((a, b) => a - b), count: used.size, total: getChannelCount() };
}

/** channel (1-8) -> { activeUntil: audioCtx-time, lastObjectId } for gate/adsr
 * lines, and channel -> last audiosignal GainNode, so a new note can steal
 * cleanly (prototype.md §15's monophonic voice-stealing). Module-level since
 * a channel is a real shared physical wire, not owned by any one object. */
const gateChannelState = new Map();
const audioSignalVoices = new Map();

function resolveEs9Frequency(sound, effectiveKey, positionIndex, accented) {
  const pitchSource = accented && sound.accent ? sound.accent : sound;
  return resolveFrequency(pitchSource, effectiveKey, positionIndex, sound.pianoNotes);
}

function scheduleGateOrAdsr(line, glide, now, instrumentSettings) {
  const lane = getChannelLane(line.channel);
  if (!lane) return;
  const state = gateChannelState.get(line.channel);
  if (glide && state && state.activeUntil > now) {
    // Legato: keep whatever's already ramping/holding on this channel — only
    // pitch moves. Nothing to schedule here.
    return;
  }
  const { gateVolts, fsVolts } = getCalibration();
  const peakUnit = Math.max(-1, Math.min(1, gateVolts / fsVolts));
  const holdSeconds = gateHighSeconds(instrumentSettings);
  const onTime = now + PITCH_SETTLE;

  lane.offset.cancelScheduledValues(now);
  lane.offset.setValueAtTime(0, now);

  if (line.signal === 'gate') {
    lane.offset.setValueAtTime(peakUnit, onTime);
    lane.offset.setValueAtTime(0, onTime + holdSeconds);
  } else {
    // adsr: shaped envelope instead of flat on/off, same overall duration.
    const attack = instrumentSettings?.attack ?? 0.01;
    const decay = instrumentSettings?.decay ?? 0;
    const sustainLevel = instrumentSettings?.sustainLevel ?? 1;
    const sustainTime = instrumentSettings?.sustainTime ?? 0;
    const release = instrumentSettings?.release ?? 0.1;
    const attackEnd = onTime + attack;
    const decayEnd = attackEnd + Math.max(decay, 0.001);
    const holdEnd = decayEnd + sustainTime;
    lane.offset.linearRampToValueAtTime(peakUnit, attackEnd);
    lane.offset.linearRampToValueAtTime(peakUnit * Math.max(sustainLevel, 0.0001), decayEnd);
    lane.offset.setValueAtTime(peakUnit * Math.max(sustainLevel, 0.0001), holdEnd);
    lane.offset.linearRampToValueAtTime(0, holdEnd + release);
  }
  gateChannelState.set(line.channel, { activeUntil: onTime + holdSeconds, objectId: null });
}

function schedulePitch(line, midiNote, glide, now, glideTime) {
  const lane = getChannelLane(line.channel);
  if (!lane || midiNote == null) return;
  const unit = pitchToUnit(midiNote, getCalibration());
  lane.offset.cancelScheduledValues(now);
  if (glide) {
    lane.offset.linearRampToValueAtTime(unit, now + Math.max(glideTime, 0.001));
  } else {
    lane.offset.setValueAtTime(unit, now + PITCH_SETTLE);
  }
}

/** Simple audio-rate voice for an 'audiosignal' line — not a reuse of the
 * kick/snare/bass/etc voice modules (those are wired to the app's own
 * listening context only), a lightweight oscillator+envelope shaped by the
 * same instrument settings, connected straight into the ES-9 merger at the
 * assigned channel. Steals cleanly: any still-ringing previous voice on this
 * channel is ramped to silence fast before the new one starts. */
function scheduleAudioSignal(line, midiNote, now, instrumentSettings) {
  const ctx = getContext();
  const merger = getMerger();
  if (!ctx || !merger || midiNote == null) return;
  const prev = audioSignalVoices.get(line.channel);
  if (prev) {
    prev.gain.cancelScheduledValues(now);
    prev.gain.setValueAtTime(prev.gain.value, now);
    prev.gain.linearRampToValueAtTime(0, now + 0.005);
  }
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  const attack = instrumentSettings?.attack ?? 0.005;
  const decay = instrumentSettings?.decay ?? 0;
  const sustainLevel = instrumentSettings?.sustainLevel ?? 1;
  const sustainTime = instrumentSettings?.sustainTime ?? 0;
  const release = instrumentSettings?.release ?? gateHighSeconds(instrumentSettings) / 2;
  const attackEnd = now + attack;
  const decayEnd = attackEnd + Math.max(decay, 0.001);
  const holdEnd = decayEnd + sustainTime;
  const stopTime = holdEnd + release + 0.05;

  const osc = ctx.createOscillator();
  osc.type = instrumentSettings?.waveform ?? 'sine';
  osc.frequency.setValueAtTime(freq, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.9, attackEnd);
  gain.gain.exponentialRampToValueAtTime(0.9 * Math.max(sustainLevel, 0.0001), decayEnd);
  gain.gain.setValueAtTime(0.9 * Math.max(sustainLevel, 0.0001), holdEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, holdEnd + release);
  osc.connect(gain);
  gain.connect(merger, 0, channelIndex(line.channel));
  osc.start(now);
  osc.stop(stopTime);
  audioSignalVoices.set(line.channel, gain);
}

/**
 * Called from main.js's onHit handler alongside (or instead of) scheduleNote.
 * Returns `{ suppressLocal }` — true when an 'audiosignal' line fired, since
 * that line replaces the object's normal local playback (prototype.md §15);
 * pitch/gate/adsr-only routing never suppresses local playback.
 */
export function triggerEs9(sound, effectiveKey, { positionIndex = 0, accented = false, instrumentSettings = {} } = {}) {
  const es9 = sound?.es9;
  if (!es9?.enabled || !es9.lines.length || !isConnected()) return { suppressLocal: false };

  const ctx = getContext();
  const now = ctx.currentTime + LOOKAHEAD;
  const freq = resolveEs9Frequency(sound, effectiveKey, positionIndex, accented);
  const midiNote = freq == null ? null : frequencyToMidi(freq);

  const noteLine = es9.lines.find((l) => l.signal === 'gate' || l.signal === 'adsr');
  const priorState = noteLine ? gateChannelState.get(noteLine.channel) : null;
  const glide = decideGlide(!!priorState && priorState.activeUntil > now, es9.glideMode);

  let suppressLocal = false;
  for (const line of es9.lines) {
    if (line.signal === 'pitch') {
      schedulePitch(line, midiNote, glide, now, es9.glideTime);
    } else if (line.signal === 'gate' || line.signal === 'adsr') {
      scheduleGateOrAdsr(line, glide, now, instrumentSettings);
    } else if (line.signal === 'audiosignal') {
      scheduleAudioSignal(line, midiNote, now, instrumentSettings);
      suppressLocal = true;
    }
  }
  return { suppressLocal };
}
