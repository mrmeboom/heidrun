// Dedicated AudioContext for ES-9 hardware output — kept entirely separate
// from audio/context.js's normal-listening context — two separate contexts,
// decided over a single shared one so disconnecting/muting the ES-9 side
// never touches what you hear on your own speakers. A
// ChannelMergerNode routed to a chosen output device via setSinkId, with
// pitch/gate/adsr as ConstantSourceNode DC offsets. Of the ES-9's 16 device
// channels only 8 (its DC-coupled 3.5mm Eurorack jacks, device channels
// 9–16) are usable this way — this module's "channel 1–8" already means
// "jack 1–8", the +8 offset into the merger happens once, here.
const CHANNEL_COUNT = 8;
const MERGER_CHANNELS = 16;
const DEVICE_CHANNEL_OFFSET = 8; // app channel 1 → device/merger channel 9 (index 8)

let ctx = null;
let merger = null;
let muteGain = null;
let streamDest = null;
let audioEl = null;
let usingNativeSink = false;
let connected = false;

/** One ConstantSourceNode per channel — the shared "physical wire" every
 * pitch/gate/adsr line for that channel writes to (last-write-wins, since a
 * channel is genuinely one voltage regardless of how many objects target it
 * — the deliberate "not exclusive" call). */
let channelLanes = [];

let calibration = { fsVolts: 10, gateVolts: 8, rootMidi: 60 };

export function getCalibration() {
  return calibration;
}
export function setCalibration(next) {
  calibration = { ...calibration, ...next };
}

export function isConnected() {
  return connected;
}

export async function scanDevices() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) {
    throw new Error('mic permission needed to list device names');
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audiooutput');
}

function buildChannelLanes() {
  channelLanes = [];
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const src = ctx.createConstantSource();
    src.offset.value = 0;
    src.start();
    src.connect(merger, 0, i + DEVICE_CHANNEL_OFFSET);
    channelLanes.push(src);
  }
}

export async function connect(deviceId) {
  if (!deviceId) throw new Error('pick an output device first');
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  merger = ctx.createChannelMerger(MERGER_CHANNELS);
  muteGain = ctx.createGain();
  muteGain.gain.value = 1;

  if (typeof ctx.setSinkId === 'function') {
    usingNativeSink = true;
    await ctx.setSinkId(deviceId);
    const maxCh = ctx.destination.maxChannelCount || MERGER_CHANNELS;
    ctx.destination.channelCount = Math.min(MERGER_CHANNELS, maxCh);
    ctx.destination.channelCountMode = 'explicit';
    ctx.destination.channelInterpretation = 'discrete';
    merger.connect(muteGain);
    muteGain.connect(ctx.destination);
  } else {
    usingNativeSink = false;
    streamDest = ctx.createMediaStreamDestination();
    streamDest.channelCount = MERGER_CHANNELS;
    streamDest.channelCountMode = 'explicit';
    streamDest.channelInterpretation = 'discrete';
    merger.connect(muteGain);
    muteGain.connect(streamDest);

    audioEl = new Audio();
    audioEl.srcObject = streamDest.stream;
    audioEl.autoplay = true;
    if (typeof audioEl.setSinkId !== 'function') {
      throw new Error('setSinkId not supported in this browser');
    }
    await audioEl.setSinkId(deviceId);
    await audioEl.play();
  }

  buildChannelLanes();
  connected = true;
}

export function disconnect() {
  if (audioEl) {
    audioEl.pause();
    audioEl.srcObject = null;
    audioEl = null;
  }
  if (ctx) ctx.close();
  ctx = null;
  merger = null;
  muteGain = null;
  streamDest = null;
  channelLanes = [];
  connected = false;
}

export function getContext() {
  return ctx;
}

export function getMerger() {
  return merger;
}

export function channelIndex(channel) {
  return channel - 1 + DEVICE_CHANNEL_OFFSET;
}

/** The channel-1..8 lane node — the shared CV/gate/adsr wire for that jack. */
export function getChannelLane(channel) {
  return channelLanes[channel - 1] ?? null;
}

export function getChannelCount() {
  return CHANNEL_COUNT;
}

/** Mute All's ES-9-side half — zeroes final output but
 * leaves every ConstantSourceNode/schedule running, so un-muting resumes in
 * phase instead of re-triggering anything. */
export function setEs9Muted(muted) {
  if (muteGain) muteGain.gain.value = muted ? 0 : 1;
}

/** Stuck-voltage safety — forces every
 * channel's voltage to 0 immediately. Called on Pause and Mute All so nothing
 * is ever left driving a gate/CV open indefinitely. */
export function allChannelsLow() {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const lane of channelLanes) {
    lane.offset.cancelScheduledValues(now);
    lane.offset.setValueAtTime(0, now);
  }
}
