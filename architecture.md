# Heiðrún — coding principles & architecture

How the concept in [prototype.md](prototype.md) actually gets built. No build step, plain JS, minimal pure-logic tests — per your calls below.

---

## 1. Tech stack

- **No framework.** This is an imperative canvas + physics + audio loop — a UI framework (React/Vue/etc.) would fight that rather than help it, and it's pure runtime overhead for zero benefit here.
- **Matter.js** for physics — already proven in `input.html`, physics is genuinely hard to hand-roll well, worth being the one dependency.
- **Native WebAudio API** for synthesis — no Tone.js or similar. Oscillators, noise sources, `BiquadFilterNode`, `GainNode` envelopes, `ConvolverNode`/`DelayNode` for the reverb/delay return buses (§9 of prototype.md) — everything the concept needs is a built-in primitive, and skipping a synthesis library keeps the "little overhead" goal literal.
- **Canvas 2D** for rendering — same as `input.html`, plenty at the 50–100 body scale from prototype.md §11, avoids WebGL setup complexity for no visual payoff (flat pastel shapes don't need a GPU pipeline).
- **No build step.** Plain ES modules, loaded natively via `<script type="module">`, Matter.js via CDN `<script>` tag exactly as `input.html` already does it. Open the file (or serve it with any static file server) and edit-refresh — zero install, zero compile step between a change and seeing it.
- **Plain JS + JSDoc type comments**, not TypeScript. JSDoc (`/** @typedef */`, `@param`, `@returns`) gets real editor autocomplete and inline type-checking in VS Code/similar without a compiler in the loop. If the object/module system outgrows what JSDoc comfortably expresses later, moving to TypeScript is a self-contained future decision — it doesn't need to be made now.

---

## 2. File / module layout

One entry HTML file, everything else in ES modules under `src/`.

```
index.html                   — entry point: canvas markup, imports main.js
                                (renamed from heidrun.html so the static server
                                serves it at the root by default; the original
                                unrelated index.html — an ES-9 CV/gate test rig —
                                was lost in that rename and isn't recoverable
                                from this repo)
input.html                    — kept as reference/lineage per prototype.md §14
src/
  main.js                    — wires everything together, owns the frame loop
  state/
    object.js                — the Object record shape + preset factories (§4 below)
    canvasState.js            — source-of-truth store: add/remove/update, serialize/deserialize,
                                 global settings (key, physics, limiter, instrument sound design,
                                 object defaults), the piano mode-requantize pass (§6)
    history.js                — undo/redo ring buffer (prototype.md §12)
  physics/
    world.js                  — Matter engine/world setup, global physics settings, manual stepPhysics(dt)
    sync.js                   — state Object ⇄ Matter body (build/rebuild/destroy)
    collisions.js              — Matter collision events → hit events, deduped per contact episode
  audio/
    context.js                 — AudioContext + master/return buses (reverb, delay) + output limiter
    theory.js                   — scales, note/octave → MIDI, pitch-degree resolution, piano note-set
                                   traversal/quantization
    voices/
      kick.js, snare.js, hats.js, bass.js, pad.js, melody.js
    scheduleNote.js             — shared "play this now-ish" scheduling helper
  generators/
    index.js                    — createGenerator(type, config) factory, uniform interface (§5)
    gate.js                      — evaluateGate(gate): the actual consumer-facing entry point:
                                    caches/creates the generator instance, handles the 'manual'
                                    step-pattern case inline (not a generator-chamber member),
                                    advances gate.index. evaluateGateAt(gate, index) is the
                                    read-without-advancing sibling — used to phase-lock the
                                    accent gate to the main gate's own hit-index rather than
                                    letting accent run its own separately-incrementing counter
                                    (main.js's onHit handler)
    tables.js                   — precomputed prime + fibonacci-gap binary strings (prototype.md §8.4)
    markov.js, lfsr.js, wolfram.js, euclidean.js
  clock/
    transport.js                 — global BPM tick source (spawn modules only, §8.6), edge-triggered
                                    (computes the current step by division each tick, fires at most
                                    once — no catch-up/replay loop; see git history if the old
                                    replay-model burst bug ever needs re-understanding)
  es9/
    context.js                    — second, dedicated AudioContext for ES-9 output only (kept fully
                                     separate from audio/context.js's normal-listening context, per
                                     prototype.md §15); device scan/connect/disconnect (setSinkId),
                                     the 16-channel ChannelMergerNode, global calibration (full-scale
                                     volts, gate-high volts, root note)
    routing.js                    — per-object routing lines (channel 1–8 + signal type: pitch/gate/
                                     adsr/audiosignal); monophonic per-channel voice-stealing +
                                     legato/staccato/auto-glide (per-object settings, prototype.md
                                     §15); resolves pitch/envelope the same way the object's normal
                                     WebAudio voice does, just written to a ConstantSourceNode's
                                     .offset instead of an oscillator/gain
    sync.js                       — ConstantSourceNode lifecycle per routing line (build/rebuild/
                                     teardown from state, same pattern as physics/sync.js); forces
                                     gate low and holds pitch steady on pause, object delete, or
                                     undo/redo, so nothing is left stuck driving voltage
  render/
    draw.js                       — per-frame canvas 2D draw (shapes, handles, popovers-on-canvas bits,
                                     multi-select marquee overlay), applies the camera transform
    camera.js                     — pan/zoom view state (screen ⇄ world coordinate conversion) and the
                                     fixed WORLD bounds rect; deliberately not in canvasState (§6 below)
    palette.js                    — theme colors, applied as CSS custom properties
  ui/
    systemMenu.js                 — hamburger menu (prototype.md §2)
    objectPopover.js               — the `+` inline settings popover, including the piano note-picker widget
    interaction.js                  — pointer events → drag/resize/rotate/duplicate/delete/marquee-select
                                       → state mutations. Owns selection state (a `Set` of ids, for
                                       multi-select) itself — not in canvasState, since it's ephemeral
                                       UI state, not part of the canvas that gets saved/exported.
  persistence/
    localProject.js                 — save/open/save-as/delete/rename (prototype.md §10)
    jsonIO.js                        — export/import JSON
test/
  generators.test.js
  canvasState.test.js
  theory.test.js
  transport.test.js
```

**Built**: the `es9/` module above (Eurorack interface over USB, multichannel WebAudio — not MIDI — prototype.md §15), plus its call site in `main.js`'s `onHit` handler and the ES-9 card in `ui/systemMenu.js`'s Instruments grid. `test.html` (recovered from a prior session, root of this repo) was the reference for the low-level device-connection/CV-scheduling mechanics — `es9/context.js` generalizes that file's single-purpose approach into 8 persistent per-channel `ConstantSourceNode` "lanes" rather than the test rig's ad hoc pitch/gate pair. Not yet click/listen-tested against real hardware — see handoff.md §5.

Each top-level folder is a boundary with one job; nothing outside `state/` mutates canvas state directly (§6).

---

## 3. Data flow / the update loop

**State is the single source of truth.** Physics bodies, audio nodes, canvas pixels, the undo stack, and localStorage are all *derived from or synced to* state — never an independent copy that state has to be kept consistent with. Concretely:

```
requestAnimationFrame loop (main.js):
  0. if paused (canvasState.getPaused(), default true on load): skip straight
     to step 5 — nothing moves, nothing new sounds, only the current frame
     redraws. This is a deliberate single on/off switch, which is exactly why
     physics is stepped manually here instead of via Matter's own Runner —
     Runner.run() owns its own internal loop and gives no clean way to pause it.
  1. world.stepPhysics(deltaMs) — a direct Engine.update() call
  2. collisions.js reads this step's collision events, turns each into a hit
     event: { objectId, otherObjectId } — deduped so a pair still in contact
     across steps only fires once per contact episode (collisionStart →
     collisionEnd), not once per step
  3. For each hit: look up the struck object's sound module (if any) →
     evaluate its hit-indexed gate (prototype.md §8.6) → if it passes,
     evaluate its accent gate too → resolve pitch (§7), swapped for the
     accent's pitch behavior if accented → call into audio/scheduleNote.js
  4. sync.js reconciles any objects created/destroyed this frame
     (spawned particles, off-canvas cleanup — prototype.md §4) between
     state and the physics world
  5. draw.js renders the frame from current state + live body positions
```

**Clock ticks run on their own cadence**, separate from the render loop's exact framerate but still driven by it (no need for a dedicated timer). Per tick: for every spawn module whose time-signature position is eligible (§8.2–8.3) and whose clock-tick-indexed gate fires, `object.js`'s spawn factory creates a new particle stamped with that spawner's configured sound module, added to state (and, next frame, to physics via `sync.js`).

**Why rAF-granularity timing is fine here, and the classic WebAudio lookahead-scheduler pattern isn't needed:** in a normal step sequencer, tick-to-sound is instantaneous, so any scheduling jitter is audible as a wobble in the beat. Here, a spawn tick only decides when a *particle is born* — the actual sound happens later, whenever physics delivers it to a trigger, and that fall time already varies by gravity/bounce/collisions far more than a few milliseconds of tick jitter ever would. The physics *is* the humanizer. What still matters is scheduling the audio node itself against `audioCtx.currentTime` once a hit is confirmed (not "right now" wall-clock) — cheap, standard practice, avoids any audio-thread click, and doesn't need the two-clock lookahead complexity since these are one-off asynchronous events, not a pre-scheduled sequence.

---

## 4. Object model in code

One record shape, matching prototype.md §4's "one generic Object, composable modules" literally rather than as three classes. **`src/state/object.js` is the authoritative shape** — its JSDoc typedefs (`HeidrunObject`, `SoundModule`, `SpawnModule`, `GateConfig`) are kept current there; this doc deliberately doesn't re-embed a copy, since that copy drifted out of sync with reality once during the build and nobody noticed until a docs pass caught it. Read the top of that file for the actual current fields.

The shape has grown since the first draft — worth knowing the categories rather than the exact field list: placement (position/rotation/size, plus independent width/height for rect-like shapes), a randomized `colorIndex`, the `physics` module (collides/live/isStatic — `collides` is repurposed on spawners specifically to mean "has a body at all," not solid-vs-sensor), an optional `sound` module (instrument, pitch behavior, key override, a hit-indexed `gate`, and a second `accent` gate+pitch-behavior pair), and an optional `spawn` module (meter, beat-select, a template `particleSound`, and a `particlesHaveSound` toggle for pure-exciter particles).

`sound` and `spawn` are `null` when not present — an object either has a module or it doesn't, no subclassing. "Place a Bouncer / Trigger / Spawner" from a canvas toolbar are just factory functions in `state/object.js` (`createBouncer()`, `createTrigger()`, `createSpawner()`) that return this same shape with different starting module values — presets, not types. This is what keeps "one generic Object" true in code, not just in the concept doc: nothing downstream (physics sync, rendering, popovers) needs to know which preset an object started life as, only which modules it currently has. `createParticle(spawnerObject)` is the one factory that isn't a canvas-toolbar preset — it stamps a spawner's `particleSound` template onto a fresh dynamic object each time, cloned (not shared), so each particle gets its own independently-accumulating gate state (§6 goes into why that independence matters).

---

## 5. Generators — uniform interface

Every generator from prototype.md §8.4 implements the same tiny shape, so any object can swap generators without the rest of the code caring which one it's running, and so both index spaces (clock-tick for spawn modules, hit-count for sound modules, §8.6) can drive the same generator instance uninterested in which one it is:

```js
/** @typedef {Object} Generator
 * @property {(index: number) => boolean} read   // table lookup or live step, given the current index
 * @property {(seed?: number) => void} [reseed]   // only meaningful for the live ones
 */
createGenerator('prime' | 'fibonacci' | 'markov' | 'lfsr' | 'wolfram' | 'euclidean', config) → Generator
```

`prime`, `fibonacci`, and `euclidean` are table-backed (`tables.js` holds the two precomputed binary strings; `euclidean.js` computes its pattern once per N/M/rotation change, per prototype.md §8.3) — `read(index)` is `table[index % table.length]`, `reseed` is a no-op or rotates the table's phase. `markov`, `lfsr`, and `wolfram` hold live internal state and actually advance it on each `read()` call — these are the three prototype.md §8.4 calls out as meant to keep evolving.

`createGenerator` isn't what callers actually reach for, though — **`generators/gate.js`'s `evaluateGate(gate)`** is. It owns the `{ type, config, index, _generator }` `GateConfig` record: lazily creates and caches the right generator instance, advances `index`, and — since 'manual' (a hand-authored step pattern) isn't a generator-chamber member at all, just a plain array read — handles that case inline rather than forcing it through `createGenerator`. Every hit-indexed gate in the app (main gate, spawn beat-select's non-manual/non-none types) goes through this one function.

**`evaluateGateAt(gate, index)`** is the sibling that reads a gate at a caller-supplied index instead of advancing the gate's own counter — used exactly once, to phase-lock the accent gate to the main gate. `main.js`'s `onHit` handler captures `sound.gate.index` *before* calling `evaluateGate(sound.gate)`, then evaluates the accent gate with `evaluateGateAt(sound.accent.gate, hitIndex)` using that captured value. Before this (fixed this session), the accent gate ran its own `evaluateGate` call with its own independently-incrementing `index` — since that call only ever happened on hits the main gate had already let through, the accent's counter advanced on a slower, filtered cadence than the main gate's, so picking matching step numbers in both grids didn't line up in practice (they'd drift in and out of phase depending on how sparse the main gate's pattern was). For the three live generators (markov/lfsr/wolfram), which ignore the index argument and advance their own internal state per call regardless, behavior is unchanged — only the index-addressable types (manual, prime, fibonacci, euclidean) are actually affected by which index gets read.

---

## 6. State ownership rules

- All mutation goes through `state/canvasState.js`'s own setters (`addObject`, `updateObject`, `removeObject`, …) — UI code, render code, and physics-sync code never reach into the object array/map and edit fields directly. This is what makes undo/redo snapshots (`state/history.js`) and localStorage saves trustworthy — they can always just serialize current state and know it's complete and correct.
- Derived data (Matter bodies, audio nodes, canvas pixels) is always safe to throw away and rebuild from state — same pattern `input.html` already uses for `rebuildPegs()`/`rebuildWalls()` on a settings change, just applied consistently everywhere instead of ad hoc.
- `history.js` snapshots full serialized state (not diffs) on each meaningful edit — simplest correct approach at this data size (prototype.md §12), capped at 50 steps.
- **Stateful counters belong to whichever object actually persists through the events being counted — never pre-computed and baked into something shorter-lived.** Concrete case that got this wrong mid-build: a spawner's particle gate was, briefly, evaluated once at spawn time against the spawner's own counter, with the *decision* stamped onto the particle. That's a subtly different bug from the usual "state got cloned" class — the counting was correct, but it was counting the wrong thing (spawn events) for what the gate was actually supposed to track (this particular object's own hit stream, which continues for as long as the particle keeps bouncing around after spawning). The fix was to let each particle's cloned sound module carry its own live, independently-accumulating gate, same as any placed object — not to special-case particles at all. If a future object type is ever tempted toward "evaluate now, apply later," that's the smell to check for.
- **Ephemeral view/UI state that isn't canvas data stays out of canvasState entirely**, same reasoning as `interaction.js`'s own selection `Set` above: `render/camera.js`'s pan/zoom (`{x, y, zoom}`) is a module-local variable, not a canvasState field. It's not serialized, not undo-tracked, and changes on every wheel tick/pan-drag frame — routing that through `notify()` would fire physics reconcile and the piano requantize pass (§ above) for a change neither cares about. `state/canvasState.js`'s own `paused`/`muteUnsent`/`muteAll` are the precedent for "ephemeral, not serialized" within canvasState itself; camera goes one step further and isn't in canvasState at all, since — unlike pause/mute — literally nothing outside `render/draw.js` and `ui/interaction.js`'s own pointer math needs to react to it.
- **A settings change is normally just read fresh next time something resolves — nothing rewrites already-stored object data in response to a setting changing.** The one deliberate exception: the piano note-picker's picked notes (`sound.pianoNotes`, chromatic semitone offsets from an object's own root) transpose with root changes for free this same "read fresh" way, but a *mode* change can make a previously valid pick genuinely invalid (out of the new scale) — there's no "read fresh" answer to that, the stored value has to actually change. Rather than hook every setter that could touch an effective mode (global key, per-object override, project load, undo/redo, duplicate — easy to miss one), this runs as one pass inside `canvasState.js`'s own `notify()`, before listeners are informed, checking each sound module's own effective mode against what it was last checked against and only rewriting when that's actually changed. If another feature is ever tempted toward "mutate stored state in response to a setting," this is the existing pattern to reuse rather than inventing a second one.

---

## 7. Testing

Node's built-in test runner (`node:test`, zero dependency, works directly against plain ES modules — `node --test`), scoped to exactly the parts that are pure and cheap to verify:

- **`test/generators.test.js`** — each generator, given a fixed seed/index sequence, produces the expected bit sequence. This is the highest-value test in the codebase: the prime and Fibonacci tables in particular must be *exactly* right (a wrong table is a silent, hard-to-notice musical bug), and it catches any accidental drift if the tables are ever regenerated.
- **`test/canvasState.test.js`** — serialize → deserialize round-trips to an identical state; undo/redo stack behaves correctly (push, undo, redo, cap at 50); global settings (physics, limiter, instrument sound design, object defaults, key override fallback) patch and round-trip correctly; the piano mode-requantize pass (§6) end-to-end — a pick stays untouched while mode is stable, snaps once mode actually changes, no-ops on a mode change with nothing to snap.
- **`test/theory.test.js`** — pitch/chord resolution: scale-degree math, piano note-set traversal (including the bounce edge cases), nearest-in-scale-degree/quantization tie-breaking, root-transposition-for-free, chord-snap-on-piano-root, empty-selection handling.
- **`test/transport.test.js`** — spawner tick timing: no catch-up burst after a spawner is off for a while or a meter is edited mid-bar, steady ticking fires roughly once per configured step.
- **`test/es9.test.js`** (planned, once `es9/routing.js` exists) — the pure decision logic is headlessly testable same as everything else here: monophonic voice-stealing on a shared channel, legato-vs-staccato-vs-auto-glide selection given the previous note's gate/envelope state, gate-high duration derived from an object's own ADSR. Device connection/`setSinkId`/actual CV output are not automated, same reasoning as physics/audio/rendering above.

Physics, audio, and rendering are **not** automated — verified by running the app in-browser, consistent with the standing practice of checking real UI/audio behavior visually/aurally rather than simulating it.

---

## 8. Coding style principles

- No dependencies beyond Matter.js — reach for a library only when hand-rolling it would be the actual risk (physics is; synthesis, given WebAudio's built-in nodes, isn't).
- Favor small pure functions over classes wherever state doesn't need identity or lifecycle — generators, pitch/chord resolution, serialization are all pure-function territory. Reserve simple factories/closures for things with genuine lifecycle (audio voices, physics body wrappers), never class hierarchies or inheritance — presets are data, not subtypes (§4).
- One-way data flow: UI/physics events → state mutation → next frame's render/audio reads the new state. Nothing reads-and-writes state in the same pass.
- Comments only where the *why* isn't obvious — matters more than usual in `generators/wolfram.js` and `generators/lfsr.js`, where the bitwise tricks are genuinely opaque without one line naming the trick being used.
