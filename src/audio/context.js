// AudioContext + the two shared return channels (reverb, delay) — prototype.md
// §9: effects are buses any voice can send to with its own gain, not objects.
let ctx = null;
let master = null;
let reverbBus = null;
let delayBus = null;
let limiter = null;
let muteGain = null;

function generateImpulseResponse(context, duration = 2.2, decay = 2.5) {
  const rate = context.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = context.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.8;

  // Output limiter — a DynamicsCompressorNode run near-brickwall (high ratio,
  // fast attack) sits between master and the actual output, so a burst of
  // simultaneous voices summing together gets caught here instead of
  // clipping out to speakers/downstream gear. `applyLimiterSettings` below
  // controls it live; setting `ratio` to 1 makes it a transparent pass-
  // through, which is how "disabled" is implemented without rewiring the
  // graph.
  limiter = ctx.createDynamicsCompressor();
  limiter.knee.value = 6;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  master.connect(limiter);

  // Mute Unsent / Mute All's app-side half (prototype.md §15) — a plain gain
  // after the limiter, muted independently of Pause so physics/spawning/ES-9
  // output keep running underneath and un-muting never desyncs anything.
  muteGain = ctx.createGain();
  muteGain.gain.value = 1;
  limiter.connect(muteGain);
  muteGain.connect(ctx.destination);

  const reverbInput = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = generateImpulseResponse(ctx);
  const reverbOutput = ctx.createGain();
  reverbOutput.gain.value = 0.9;
  reverbInput.connect(convolver);
  convolver.connect(reverbOutput);
  reverbOutput.connect(master);
  reverbBus = reverbInput;

  const delayInput = ctx.createGain();
  const delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = 0.32;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const delayOutput = ctx.createGain();
  delayOutput.gain.value = 0.7;
  delayInput.connect(delayNode);
  delayNode.connect(feedback);
  feedback.connect(delayNode);
  delayNode.connect(delayOutput);
  delayOutput.connect(master);
  delayBus = delayInput;
}

export function getAudioContext() {
  if (!ctx) initAudio();
  return ctx;
}

/** Browsers require a user gesture before audio can start — call from the first click/keydown. */
export function resumeAudio() {
  getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
}

export function getMaster() {
  getAudioContext();
  return master;
}

/**
 * Live-updates the output limiter from canvasState's `limiterSettings`
 * (state/canvasState.js). `enabled: false` sets `ratio` to 1:1 — a
 * compressor at unity ratio passes its input through unchanged regardless of
 * threshold, so this is a true bypass, not just "very lenient."
 */
export function applyLimiterSettings({ enabled = true, ceiling = -3 } = {}) {
  getAudioContext();
  limiter.threshold.value = ceiling;
  limiter.ratio.value = enabled ? 20 : 1;
}

/** Mute Unsent / Mute All's app-side half — see muteGain above. */
export function setAppMuted(muted) {
  getAudioContext();
  muteGain.gain.value = muted ? 0 : 1;
}

/** Connects a voice's output node to dry (master) plus reverb/delay sends at the given amounts. */
export function connectSends(sourceNode, { sendReverb = 0, sendDelay = 0 } = {}) {
  getAudioContext();
  sourceNode.connect(master);
  if (sendReverb > 0) {
    const g = ctx.createGain();
    g.gain.value = sendReverb;
    sourceNode.connect(g);
    g.connect(reverbBus);
  }
  if (sendDelay > 0) {
    const g = ctx.createGain();
    g.gain.value = sendDelay;
    sourceNode.connect(g);
    g.connect(delayBus);
  }
}
