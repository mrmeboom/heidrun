# Heiðrún — architecture

A standalone browser instrument: a blank canvas of physics-driven objects (bouncers, triggers, spawners, peg fields) whose collisions and math/randomization generators drive WebAudio synthesis, with optional CV/gate output to Eurorack hardware. A populated, switched-on canvas plays itself — a self-running generative patch arranged by hand instead of by patch-cables.

This doc covers both what it's for and how it's built. It describes the app as it stands, not the history of how it got there — see `git log` for that.

---

## 1. Core idea & interaction model

The canvas is a "musical Miro board": place objects freely, manipulate them directly in place (drag, resize, rotate, toggle on/off), with settings surfaced right next to each object rather than in a separate panel.

**Two modes**, toggled top-right:

- **Build** (default) — placing, molding, and testing all happen here, not in a separate "dev" state. Every object shows drag/resize/rotate handles; a `+` affordance opens an inline settings popover (pill-shaped fields for that object's own settings — shape, size, instrument, pitch behavior, timing, generator choice). The popover also holds the object's on/off toggle: on means it physically participates *and* is live for sound, so trajectories/interactions can be tested immediately while building.
- **Clean** (was "Play") — locks placement and hides on-canvas chrome for a clean, performative view. Doesn't change simulation behavior, only what's visible/interactive.

**Top bar** (left to right): **Clear all** (removes every object from the canvas — confirms first, pushes one undo step so Cmd/Ctrl+Z brings it back), **Mute Unsent** / **Mute All** (see §8), the Build/Clean toggle, **Pause** (freezes physics stepping and spawner ticking entirely — nothing moves, nothing new sounds; defaults to paused on load so a freshly-placed object never sounds before you're ready), and the hamburger menu.

**System menu** (hamburger) is scoped strictly to things not tied to any single object: undo/redo, project manager, global timing (BPM), global key/mode, global physics, per-instrument sound design, output limiter, default sizes per object class, palette, JSON export/import, and ES-9 routing/calibration. Laid out as two side-by-side "islands" — Instruments and Global — each a CSS-multi-column card grid. The Global island's title row also carries **Reset all**, which reverts every setting in both islands to its hardcoded factory value (confirms first, pushes one undo step) — deliberately leaves canvas objects untouched, since wiping those is Clear all's job.

**Look & UI**: soft cream background (not white), objects filled in hard, semi-saturated pastel colors randomly assigned per object rather than by instrument. Controls are small pill-shaped fields (text inputs and dropdowns alike) — thin border, fully rounded, no heavy chrome; a focused/active pill picks up a highlight drawn from one of the base pastels. Deliberately minimal and compact — small type, tight padding — so a canvas full of placed objects doesn't drown in surrounding UI. The base pastel set + cream background are hex/picker-adjustable from the system menu; everything downstream (pill fills, highlights, object colors) derives from that small set rather than being hardcoded per component, so a palette change reflows the whole UI at once.

---

## 2. Object model

One generic **Object**, composable rather than three hardcoded classes — "Bouncer," "Trigger," and "Spawner" are just factory presets of the same shape, not separate code paths. `src/state/object.js` is the authoritative shape (its JSDoc typedefs — `HeidrunObject`, `SoundModule`, `SpawnModule`, `GateConfig` — are the source of truth; read that file directly for the current field list). Three modules:

1. **Placement/physics** (every object has this) — position, rotation, size (independent width/height for square/rect shapes, dragged from one corner handle), shape (circle/triangle/square/asterisk), static or dynamic, and an on/off flag controlling collision participation. Collision off + still "live" = a pass-through sensor zone (a "Trigger"); collision on = a "Bouncer." A spawner repurposes this same flag as **Collide**: whether it has a physics body at all, which controls whether its own freshly-spawned particles immediately sound on birth (on by default) or stay silent until they hit something else.
2. **Sound module** (optional) — instrument assignment (kick/snare/hat/bass/pad/melody) + pitch behavior (§4), an optional hit-indexed **gate** (§3) that can thin how often an interaction produces sound (default: always-on, every hit sounds), and an **accent gate** — a second, independent hit-indexed gate evaluated only on hits the main gate already passed; when it fires, it swaps in an alternate pitch instead of adding a second note. Any object can carry a sound module, including a spawner's particles — each particle gets its own cloned, independently-accumulating gate state, since it can bounce through several bouncers/triggers before leaving the canvas and genuinely experiences its own stream of hits. Particles can opt out of sound entirely (pure exciter, physical-only).
3. **Spawn module** (optional) — rhythm + a clock-tick-indexed gate tied to the global transport, object choice/size for what it emits, and the sound-module template every emitted particle is born with (instrument, key/mode/octave, pitch behavior) — set once on the spawner, stamped onto each particle as a fresh clone.

`sound`/`spawn` are `null` when not present. `createBouncer()`/`createTrigger()`/`createSpawner()` in `state/object.js` are factories returning this same shape with different starting module values — presets, not types. `createParticle(spawnerObject)` stamps a spawner's `particleSound` template onto a fresh dynamic object each time it fires.

**Peg field** is a special cluster object — many pegs placed/configured as a unit (spacing/radius handles, drag/resize/rotate like any object). Pitch behavior and the hit-indexed gate are set once at the field level and shared across every peg (all pegs share the field object's own id, so any hit routes to the same state) — field-level "Field pitch" (Up/Down/Left→Right/Right→Left/Random) normalizes the struck peg's own position against the field's own (rotation-aware) local bounds.

Spawner-emitted particles are destroyed once they drift off the world bounds — cleanup, not a gameplay rule, keeping live physics-body and audio-voice counts bounded over a long session. Deliberately placed objects (bouncers, triggers, peg fields) are never auto-destroyed.

---

## 3. Timing & math generators

Two index spaces, kept strictly separate:

- **Clock-ticks** — what a spawn module counts against. One shared BPM/transport drives all spawn timing; only spawn modules know "what beat is it." Per spawner: time signature (numerator/denominator, each independently driftable — a nonzero drift-max re-picks that value, within its limit, once the current cycle completes), and a beat-select mode deciding which eligible beats actually fire: **None** (every beat), **Manual** (a hand-toggled step grid — resolution is a note subdivision scaled by the spawner's own numerator, not a fixed step count), **Euclidean** (Bjorklund's algorithm, N hits spread across M beats, plus rotation), or one of the math generators below.
- **Hits** — what a sound module counts against, if it gates at all. Every physical interaction (collision, pass-through, landing) increments an object's own private hit-counter by one; the same generator chamber can attach here, reading `table[hitCount % length]` instead of `table[tick % length]`. Not clock-aligned — an interaction-density filter, not a rhythm. To make a static object sound at a precise musical rate, the rhythm is built into an upstream spawner's clock-tick gate and the receiving object's own gate stays always-on, just relaying whatever arrives.

**The generator chamber** — six interchangeable, uniformly-shaped generators (`generators/index.js`'s `createGenerator(type, config)`), each O(1) per index step:

```js
/** @typedef {Object} Generator
 * @property {(index: number) => boolean} read
 * @property {(seed?: number) => void} [reseed]
 */
```

- **Prime** — hardcoded 128-entry table, `table[index % 128]`.
- **Fibonacci-mod-6 (as gap lengths)** — the raw sequence isn't read directly (too dense to be musically useful); each value means "N zeros then a one," expanded once offline into a fixed binary string and read the same way as the prime table.
- **Markov (2-state on/off chain)** — currently-on → 30% stay on/70% off; currently-off → 60% on/40% stay off (tunable). The simplest possible Markov chain, one `Math.random()` compare per step.
- **LFSR** — linear feedback shift register, shift+XOR feedback taps, reseedable.
- **Wolfram** (elementary CA, rule 30/90/110/150) — row stored as a 32-bit int, next generation via a handful of bitwise ops, edges wrap circularly.
- **Euclidean/Bjorklund** — also usable standalone as a generator, not just for spawner beat-selection.

`prime`, `fibonacci`, and `euclidean` are table-backed (`tables.js` holds the two precomputed binary strings; `euclidean.js` computes its pattern once per N/M/rotation change) — `read(index)` is a pure lookup. `markov`, `lfsr`, and `wolfram` hold live internal state and advance it on every `read()` call — these three are meant to keep evolving/be reseedable.

`generators/gate.js`'s **`evaluateGate(gate)`** is what callers actually use — it owns the `{ type, config, index, _generator }` record, lazily creates/caches the right generator instance, advances `index`, and handles `'manual'` (a plain array read, not a chamber member) inline. **`evaluateGateAt(gate, index)`** reads a gate at a caller-supplied index without advancing its own counter — used once, to phase-lock the accent gate to the main gate's hit-index (`main.js`'s `onHit` captures `sound.gate.index` before calling `evaluateGate`, then evaluates the accent gate with `evaluateGateAt(sound.accent.gate, hitIndex)`), so picking matching step numbers in both grids actually lands on the same note.

None of this is a performance concern: every generator costs a lookup, a shift, or a comparison, negligible next to a single WebAudio voice's per-sample DSP or a Matter.js physics step. The real cost centers are concurrent audio voices and live physics bodies (§9), not which of these six functions an object happens to run.

---

## 4. Pitch, key/mode, and chords

**Global key/mode** (note + octave + mode) lives in the system menu; any sound-carrying object can override it with its own note/octave/mode, each independently — overriding just the octave doesn't require also overriding the note.

**Pitch behavior** (per sound-carrying object): **Fixed**, **Random-in-key**, **Cycle-up**, **Cycle-down**, **Piano**, **Positional** (peg fields only, set programmatically). All draw from the object's effective key/mode.

**Piano** is a continuous 3-octave (36-key) widget in the popover, root at the leftmost key. Notes are stored as semitone offsets from the object's own effective root, so a root/octave change transposes every picked note for free — nothing stored needs to change. A mode change is the one case that does need a rewrite: it can make a previously-valid pick fall out of the new scale, so `canvasState.js`'s `notify()` runs a pass (before listeners are informed) that snaps any now-out-of-scale pick to its nearest in-scale neighbor, for every sound module, on every path (global key edit, per-object override, project load, undo/redo). Own cycle order (Up/Down/Up-down/Down-up/Random); empty selection plays nothing.

**Chords** (pad auto-chord): three tiers — **Triad** (root+3rd+5th), **7th** (+7th), **Extended** (+9th/11th/13th from the active scale). A **Chord** toggle decides only whether the extra tones stack on top — the root itself always follows whichever pitch behavior is selected, chord-on or off. Accent reuses the main pitch's resolved notes rather than a second widget.

---

## 5. Sound engine & effects

Pure WebAudio synthesis (oscillators, noise sources, filters, ADSR-style envelopes) — no sample loading. Six voices: kick, snare, hat, bass, pad, melody. Snare and hat are deliberately separated in frequency (snare: tonal thump + ~2800Hz mid crack; hat: pure noise above ~9500Hz) so they read as distinct percussion.

**Per-instrument sound design** (system menu, Instruments cards) is global, not per-object — this is a WebAudio prototyping layer standing in for the eventual modular-synth CV/gate output, so "make the kick punchier for the whole patch" is the actual use case. Kick/snare/hat share a 3-knob baseline (Decay/Tone/Pitch). Bass/pad/melody get a deeper tier: a full ADSR-shaped amplitude envelope (Attack/Decay/Sustain level/Sustain time/Release), tone, waveform, resonance, filter envelope, unison, vibrato, noise transient, and — bass only — a sub oscillator. `sustainTime` exists because every note here is a one-shot physics-triggered hit, not a held key — there's no real note-off for a normal ADSR's Sustain stage to release against, so Attack→Decay ramps to Sustain level, holds there for `sustainTime` seconds (0 default = an immediate "plonk"), then Release fades out.

Effects are shared **return channels** (one reverb, one delay), not placeable objects — any sound-carrying object sends to them with its own gain/send amount, keeping effect processing centralized (only ever N reverb/delay instances regardless of object count).

**Output limiter**: a `DynamicsCompressorNode` after the master bus, on by default (ceiling −3dB), adjustable/removable via the system menu with an at-your-own-risk warning — disabling sets a true 1:1 bypass rather than disconnecting the graph.

---

## 6. Timing details

Global BPM lives in the system menu; time signature stays per-spawner (§3). Spawner ticking is edge-triggered with no catch-up/replay mechanism — each tick computes "which step is this, right now" by division and fires at most once if that differs from the last-fired step. At BPM/subdivision combos faster than one rendered frame, firing rate silently caps at one particle/frame instead of staying locked to tempo — a deliberate trade, since a burst is worse than a very-slightly-under-tempo edge case.

**Why rAF-granularity timing is fine, and a lookahead-scheduler isn't needed**: a spawn tick only decides when a particle is *born* — the actual sound happens later, whenever physics delivers it to a trigger, and that fall time already varies by gravity/bounce/collisions far more than a few milliseconds of tick jitter would. The physics is the humanizer. What still matters is scheduling the audio node against `audioCtx.currentTime` once a hit is confirmed, not "right now" wall-clock — cheap, standard practice, no lookahead complexity needed since these are one-off async events, not a pre-scheduled sequence.

---

## 7. Canvas: pan/zoom & object cap

The canvas is a viewport into a fixed, generous world rect (`render/camera.js`'s `WORLD`), not literally infinite — an unbounded world paired with an unbounded peg field is exactly the runaway-density failure mode the object cap exists to prevent. Pan: space+drag, middle-click-drag, or trackpad two-finger scroll. Zoom: ctrl/cmd+scroll, centered on the pointer. A dashed outline (build mode only) shows the world edge. Physics bodies were always in world coordinates; only rendering and pointer math needed to stop assuming world == screen.

A plain-text live counter (next to the toolbar's Peg field button; `physics/sync.js`'s `getLiveBodyCount`, pegs counted individually) shows the current live-body total. An optional hard cap (off by default, its own system-menu card) stops a spawner from emitting new particles once the count reaches the configured number — existing particles keep living/dying normally. The counter turns red once the cap is on and reached.

This cap is a body-count proxy, not the real bottleneck: a dense-but-spread-out peg field handles 4000+ live bodies fine — the actual ceiling is **concurrent audio voices**, which only tracks body count when particles are concentrated through a few sound-producing objects rather than spread across a field. No direct concurrent-voice throttle exists yet.

---

## 8. Hardware output — ES-9 Eurorack interface

Sends pitch/gate/envelope/audio signals over USB to an Expert Sleepers ES-9 Eurorack interface via plain multichannel WebAudio — `ConstantSourceNode`s for pitch (1V/oct DC offset) and gate (on/off DC level) feeding a 16-channel `ChannelMergerNode`, routed out via `AudioContext.setSinkId` — **not MIDI**. Of the ES-9's 16 device channels, only 8 (its DC-coupled 3.5mm Eurorack jacks) are usable this way; those 8 are what "channel 1–8" means throughout the app's UI. See the README for adapting this to different hardware.

Runs on its **own dedicated AudioContext**, fully separate from the app's normal listening context. Routing lives inside each object's sound module (an object needs a sound module to route to ES-9). Any number of **lines** per object, each a channel (1–8) + signal type:

- **Pitch** — 1V/octave CV, the object's resolved pitch.
- **Gate** — high through the object's own ADSR's Attack→Decay→Sustain-hold, low at Release. Reuses existing instrument ADSR knobs.
- **ADSR** — same envelope, sent as shaped CV instead of flat on/off. Alternative to Gate, not additional — a note costs 2 outs (pitch + one of gate/adsr), never 3.
- **Audio signal** — the object's actual synthesized audio at audio rate, replacing that object's local playback (pitch/gate/adsr routing leaves local playback untouched).

Channels are **not exclusive** — routing multiple objects to one channel is intentional (patch-cable-stacking), not prevented. The ES-9 settings card shows an "x/8 channels patched" readout.

**Voice stealing**: each channel is monophonic in practice — whichever object last triggered a note takes it over. **Legato/staccato/auto-glide (+ glide time) is a per-object setting**; the winning (stealing) object's own setting applies. Auto-glide (303-style): glide+legato if the previous note on that channel is still gated/enveloping when the new one fires, otherwise staccato.

**Calibration** is global (full-scale volts, gate-high volts, root note) — one interface, one calibration, not per-channel.

**Three independent mute layers**, next to the Build/Clean toggle: **Pause** (existing — freezes physics/spawning, not for performance use, desyncs timing), **Mute Unsent** (mutes the app's own local AudioContext only — ES-9 output keeps going), **Mute All** (mutes both contexts, full silence, but keeps physics/spawning/scheduling running so un-muting doesn't desync).

Modules: `es9/context.js` (device connection, calibration, the 8 persistent per-channel `ConstantSourceNode` lanes), `es9/routing.js` (per-object routing, voice-stealing/glide decision, gate/adsr scheduling, the audiosignal oscillator voice, the "x/8" summary). `audiosignal` routing is a separate, simpler oscillator+ADSR voice, not each voice module's own unison/filter-sweep/sub-oscillator character — good enough to get real audio to the modular; revisit if a specific voice's exact timbre needs to reach ES-9 too.

---

## 9. Persistence

Two independent layers:

- **Named projects** (`persistence/localProject.js`) — an explicit save/open/save-as/delete/rename store: a localStorage index (list of names) plus one JSON blob per project. JSON export/import (`persistence/jsonIO.js`) sits alongside it for backup or moving a layout between machines.
- **Autosave** (`persistence/autosave.js`) — an ambient, automatic layer distinct from the above: the whole canvas (settings *and* layout) is debounce-written to its own localStorage key on every change, and silently restored on load, before the undo baseline is set — so a plain reload continues exactly where you left off with no explicit save required.

`state/canvasState.js`'s `serialize()`/`deserialize()` back both layers — one JSON shape (`version`, `objects`, `palette`, `globalKey`, `physicsSettings`, `objectDefaults`, `instrumentSettings`, `limiterSettings`), merged with current defaults on load rather than replacing outright, so a blob saved before some setting existed doesn't leave it `undefined`.

---

## 10. State ownership & data flow

**State is the single source of truth.** Physics bodies, audio nodes, canvas pixels, the undo stack, and localStorage are all derived from or synced to state, never an independent copy kept manually consistent. All mutation goes through `canvasState.js`'s own setters (`addObject`, `updateObject`, `removeObject`, …) — nothing else reaches into the object map directly.

**Per-frame loop** (`main.js`):
```
if paused: skip to redraw only — nothing moves/sounds this frame
1. world.stepPhysics(deltaMs) — a direct Matter Engine.update() call
2. collisions.js turns this step's collision events into hit events, deduped
   per contact episode (collisionStart → collisionEnd), not once per step
3. per hit: resolve the struck object's sound module → evaluate its gate →
   if it passes, evaluate its accent gate → resolve pitch (swapped for the
   accent's pitch behavior if accented) → scheduleNote / triggerEs9
4. sync.js reconciles objects created/destroyed this frame (spawned
   particles, off-canvas cleanup) between state and the physics world
5. draw.js renders the frame from current state + live body positions
```
Clock ticks run on their own cadence, still driven by the same loop rather than a dedicated timer.

**Ownership rules worth knowing before extending this:**
- Derived data (Matter bodies, audio nodes, canvas pixels) is always safe to throw away and rebuild from state.
- `history.js` snapshots full serialized state (not diffs) per meaningful edit — simplest correct approach at this data size, capped at 50 steps.
- **A stateful counter belongs to whichever object actually persists through the events being counted** — never pre-computed and baked into something shorter-lived. (A particle's hit-gate must be its own live, independently-accumulating state, cloned per particle — not evaluated once at spawn time against the spawner's own counter.)
- **Ephemeral view/UI state that isn't canvas data stays out of `canvasState` entirely** — `interaction.js`'s selection `Set`, `render/camera.js`'s pan/zoom — neither is serialized or undo-tracked, and both change on every frame/drag in a way that would make routing them through `notify()` wasteful (it would re-run physics reconcile and the piano requantize pass for a change neither cares about). `canvasState`'s own `paused`/`muteUnsent`/`muteAll` are the "ephemeral but still in canvasState" precedent; camera goes one step further and isn't in canvasState at all.
- **A settings change is normally just read fresh next time something resolves — nothing rewrites already-stored object data in response to a setting changing.** The one deliberate exception is the piano mode-requantize pass (§4) — if a future feature is tempted toward "mutate stored state in response to a setting," that's the existing pattern to reuse rather than inventing a second one.

---

## 11. Tech stack & coding style

- **No framework** — an imperative canvas + physics + audio loop; a UI framework would fight that rather than help.
- **Matter.js** for physics (via CDN `<script>` tag) — the one dependency; physics is genuinely hard to hand-roll well.
- **Native WebAudio API** for synthesis — no Tone.js or similar; everything needed is a built-in primitive (oscillators, `BiquadFilterNode`, `GainNode` envelopes, `ConvolverNode`/`DelayNode`).
- **Canvas 2D** for rendering — plenty at this scale, avoids WebGL setup for no visual payoff (flat pastel shapes don't need a GPU pipeline).
- **No build step** — plain ES modules loaded natively via `<script type="module">`. Open `index.html` (or serve it with any static file server) and edit-refresh.
- **Plain JS + JSDoc type comments**, not TypeScript — real editor autocomplete/inline type-checking without a compiler in the loop.
- Favor small pure functions over classes wherever state doesn't need identity/lifecycle (generators, pitch/chord resolution, serialization); reserve closures for genuine lifecycle (audio voices, physics body wrappers). Presets are data, not subtypes.
- One-way data flow: UI/physics events → state mutation → next frame's render/audio reads the new state. Nothing reads-and-writes state in the same pass.
- Comments only where the *why* isn't obvious — matters most in `generators/wolfram.js` and `generators/lfsr.js`, where the bitwise tricks are genuinely opaque without one line naming the trick.

---

## 12. File / module layout

```
index.html                — entry point: canvas markup, imports main.js
test.html                 — standalone ES-9 CV/gate test rig, reference for
                             the low-level device-connection/CV-scheduling
                             mechanics es9/context.js generalizes
src/
  main.js                 — wires everything together, owns the frame loop
  state/
    object.js              — the Object record shape + preset factories (§2)
    canvasState.js          — source-of-truth store: add/remove/update,
                              serialize/deserialize, resetSettingsToDefaults,
                              global settings, the piano requantize pass (§4)
    history.js              — undo/redo ring buffer
  physics/
    world.js                — Matter engine/world setup, global physics
                              settings, manual stepPhysics(dt)
    sync.js                 — state Object ⇄ Matter body (build/rebuild/destroy)
    collisions.js            — Matter collision events → hit events, deduped
                              per contact episode
  audio/
    context.js               — AudioContext + master/return buses + limiter
    theory.js                 — scales, note/octave → MIDI, pitch-degree
                              resolution, piano note-set traversal/quantization
    voices/                    — kick.js, snare.js, hats.js, bass.js, pad.js,
                              melody.js
    scheduleNote.js            — shared "play this now-ish" scheduling helper
  generators/
    index.js                   — createGenerator(type, config) factory (§3)
    gate.js                     — evaluateGate / evaluateGateAt (§3)
    tables.js                   — precomputed prime + fibonacci-gap strings
    markov.js, lfsr.js, wolfram.js, euclidean.js
  clock/
    transport.js                — global BPM tick source, edge-triggered
  es9/
    context.js                   — dedicated ES-9 AudioContext, device scan/
                              connect/disconnect, channel lanes, calibration
    routing.js                    — per-object routing, voice-stealing/glide,
                              gate/adsr scheduling, audiosignal voice
    sync.js                       — ConstantSourceNode lifecycle per routing
                              line, forces gate low / holds pitch on pause,
                              object delete, or undo/redo
  render/
    draw.js                       — per-frame canvas 2D draw, camera transform
    camera.js                      — pan/zoom view state + fixed WORLD bounds
    palette.js                      — theme colors as CSS custom properties
  ui/
    systemMenu.js                   — hamburger menu (§1)
    objectPopover.js                 — the `+` inline settings popover,
                              including the piano note-picker widget
    interaction.js                    — pointer events → drag/resize/rotate/
                              duplicate/delete/marquee-select → state
                              mutations; owns selection state itself
  persistence/
    localProject.js                   — named-project store (§9)
    jsonIO.js                          — export/import JSON
    autosave.js                        — ambient autosave layer (§9)
test/
  generators.test.js, canvasState.test.js, theory.test.js,
  transport.test.js, es9.test.js
```

Each top-level folder is a boundary with one job; nothing outside `state/` mutates canvas state directly (§10).

---

## 13. Testing

Node's built-in test runner (`node:test`, zero dependency, works directly against plain ES modules — `npm test` / `node --test`), scoped to what's pure and cheap to verify:

- **`generators.test.js`** — each generator, given a fixed seed/index sequence, produces the expected bit sequence. Highest-value test in the codebase: the prime/Fibonacci tables must be exactly right (a wrong table is a silent, hard-to-notice musical bug).
- **`canvasState.test.js`** — serialize→deserialize round-trips; undo/redo behavior (push, undo, redo, cap); global settings patch/round-trip correctly (including `resetSettingsToDefaults`); the piano requantize pass end-to-end.
- **`theory.test.js`** — pitch/chord resolution: scale-degree math, piano note-set traversal, quantization tie-breaking, root-transposition-for-free, chord-snap-on-piano-root, empty-selection handling.
- **`transport.test.js`** — spawner tick timing: no catch-up burst after a spawner is off or a meter is edited mid-bar, steady ticking fires roughly once per configured step.
- **`es9.test.js`** — the pure decision logic: monophonic voice-stealing, legato/staccato/auto-glide selection, gate-high duration derived from an object's own ADSR.

Physics, audio, and rendering are **not** automated — verified by running the app in-browser instead of simulated.
