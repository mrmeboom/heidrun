# Heiðrún — prototype concept

A standalone test environment for a math/randomization-driven musical instrument. Blank canvas, physics-driven objects, WebAudio synthesis. Built to be molded live via direct on-canvas manipulation, with a small system menu for the handful of settings that aren't tied to a single object.

This is a concept-level plan — no code yet. Coding principles/architecture come next, once this is agreed.

---

## 1. Core idea

The canvas is a "musical Miro board." You place objects freely and manipulate them directly, in-place — drag, resize, rotate, toggle on/off — with settings surfaced right next to each object rather than in a separate panel. A populated, switched-on canvas plays itself: a self-running generative patch, arranged by hand rather than by patch-cables.

Everything in `input.html` (peg box, drag handles, physics sliders, dev drawer) is the seed. We're generalizing it: fixed plinko box → freeform canvas; click-to-spawn button → autonomous spawners; single button row → any number of placeable, instrument-carrying objects; side drawer → mostly inline, on-object controls, with a small system menu left over for global concerns.

---

## 2. Interaction modes

Two modes, one toggle (hamburger menu, top-right):

### Build mode (default)
- This is where placing, molding, and testing happens — not a separate "dev" state layered on top.
- Every object shows its drag/resize/rotate handles directly on canvas, same spirit as `input.html`'s handles.
- Each object has a small **`+` affordance** next to it that expands an inline settings popover: pill-shaped fields/dropdowns for that object's own settings (shape, size, instrument, pitch behavior, timing, generator choice — whatever applies to that object type).
- That popover also holds the object's **on/off toggle** — on means it physically participates (collides, gets pushed, pushes back) *and* is live for sound, so you can test trajectories and interactions immediately while building, without a separate "press play" step. Off means it sits inert — placed, but not yet part of the simulation (useful while you're still positioning something).
- Nothing here is exclusive to a special "dev" state — this *is* the normal way you build.

### Play / clean mode
- Locks all placement (no accidental drags) and hides on-canvas chrome (handles, `+` icons, outlines) for a clean, performative view — just the objects, doing their thing.
- Doesn't change simulation behavior, only what UI is visible/interactive.

### System menu (hamburger, top-right)
Scoped strictly to things that aren't tied to any single object — everything else lives on the object itself in build mode. Order (top to bottom): Undo/redo, Project manager, Global timing (BPM), Global key/mode, Global physics, Palette, JSON export/import.
- Undo/redo.
- Project/canvas manager: open / save / save-as / delete / rename saved canvases (see §10).
- Global timing — BPM (see §9).
- Global key/mode default (note + octave + mode, see §7).
- Global physics settings (gravity, restitution, friction, air friction) — world-wide, same as `input.html`.
- UI color palette (background + 6 pastels, hex/picker, laid out 2×3).
- JSON export/import.

Build ⇄ Play mode is a small toggle switch in the top bar (next to a Pause button — see below), not in this menu. Default sizes per object class are built — a system-menu card edits them, and a freshly-placed object picks up whatever's currently configured (see handoff.md).

**Pause** (top bar, naked icon button, left of the mode toggle): freezes physics stepping and spawner ticking entirely — nothing moves, nothing new sounds. Defaults to **paused** on load, specifically so a freshly-placed object never starts sounding off before you're ready.

---

## 3. Look & UI

This replaces `input.html`'s dark/neon theme entirely — new palette, same underlying interaction language (small pill controls, a dim/bright state pair for hover-and-active). Base rules:

- **Background**: soft cream, not white — a warm, slightly desaturated off-white, closer to paper than to a device screen.
- **Objects**: simple geometry (circle, triangle, square, asterisk — the shared shape set, §4), filled in **hard, semi-saturated pastel colors**, randomly assigned per object rather than by instrument — readable and distinct from each other at a glance, but soft rather than neon; the opposite direction from `input.html`'s cyan/magenta glow system. (Rectangle isn't a separate picker option — square drags into any width/height independently via a single corner handle, so it covers both; the shape stays in the model for legacy/particle rendering.)
- **Controls**: small **pill-shaped fields** (text inputs and dropdowns alike) — background-color fill, a thin/tiny border, rounded fully to a pill. No heavy chrome.
- **Highlight state**: when a pill is focused, active, or otherwise relevant (e.g. the currently-dragged handle, an object mid-edit), it picks up a soft highlight drawn from one of the base pastel colors — same role `input.html`'s cyan glow plays for hover/active, just softer and warmer.
- **Overall density**: minimal and minimalistic, on the *smaller* side deliberately — compact paddings, small type (`input.html`'s ~0.68–0.82rem label sizing is a reasonable starting point), so a canvas with many placed objects doesn't drown in chrome. The canvas content is the point; controls should recede until touched.
- **Editability**: the base pastel set + cream background are hex/picker-adjustable from the system menu (§2) — everything downstream (pill fills, highlights, object colors) derives from that small base set rather than being hardcoded per-component, so a palette change reflows the whole UI at once.

---

## 4. Object model

Rather than three rigid, hardcoded classes, there's really **one generic Object** made of a few composable parts. "Spawner," "Bouncer," and "Trigger" become presets/starting configurations of the same underlying thing, not separate code paths:

1. **Placement/physics module** (every object has this) — position, rotation, size (or independent width/height for square, dragged from one corner handle), shape (circle / triangle / square / asterisk, from the shared shape set), static or dynamic, and the on/off toggle from §2 that controls whether it participates in collisions at all. An object with collision *off* but still "live" is effectively a pass-through sensor zone — this is what used to be called a "Trigger." An object with collision *on* is what used to be called a "Bouncer." Same object, one flag. Spawners repurpose this same flag as **Collide**: whether the spawner has a physics body at all, which controls whether its own freshly-spawned particles immediately overlap and "hit" it at the instant they're born (on by default — that accidental-but-liked "sound on spawn" behavior — off gives particles no sound until they hit something else).
2. **Sound module** (optional, opt-in per object) — instrument assignment (kick / snare / hat / bass / pad / melody) + pitch behavior (§7), plus an **optional hit-indexed gate** (§8.6) that can thin down how often an interaction actually produces sound, and an **accent gate**: a second, independent hit-indexed gate that only evaluates on interactions the main gate already let through — when it fires, it swaps in an alternate pitch behavior/degree for that one note instead of adding an extra note (default: sparse, via the prime generator, so a fresh object accents occasionally out of the box). Default gate: always-on (every hit sounds). Any object can carry a sound module — static or moving, **including a spawner's particles**, each with its own fully independent, live, accumulating gate state (a particle can bounce through several bouncers/triggers before leaving the canvas, so it genuinely experiences a stream of hits over its lifetime, same as anything else — see §8.6 for why baking that decision at spawn time instead was tried and reverted). Particles can also opt out of carrying a sound module entirely (a **Sound on/off toggle**, same shape as any other object's) — off makes them pure exciters, physical-only, so a downstream bouncer or trigger's own gate/accent does all the patterning instead.
3. **Spawn module** (optional, opt-in, only meaningful on objects meant to emit) — rhythm + a **clock-tick-indexed gate** (§8) tying it to the global transport, object choice/size for what it emits, and the **sound-module configuration that every emitted particle is born with**: instrument (kick / snare / melody / etc.), key/mode/octave, and pitch behavior (fixed / random / cycle, §7), set once on the spawner and stamped onto each particle it emits (a fresh clone each time, so each particle's own gate starts independently, same as placing a new object would). Particles aren't blank — they arrive already knowing what they are; a spawner is where you decide "this one makes randomized melody notes in D dorian" and every particle it emits just carries that out.

This keeps the mental model to one thing (place an Object, configure its modules) instead of three parallel systems that each need their own logic. Only the **spawn module** is tied to the global clock — see §8.6 for why sound modules deliberately are not.

### Particle lifecycle
Spawner-emitted particles are temporary by nature — once one drifts off the canvas bounds (with a small margin, same idea as `input.html`'s landing line), it's removed from both the physics world and any audio bookkeeping. This is cleanup, not a gameplay rule: it's what keeps the live physics-body and voice counts (§11) bounded during a long-running session instead of silently climbing forever. Deliberately **placed** objects (bouncers, trigger-zones, peg fields) are never auto-destroyed — only things a spawner created.

### Plinko peg field — built
A special *cluster* object — many small pegs placed and configured as a unit (spacing/radius drag handles, plus drag/resize/rotate like any other object), where the sound module's pitch behavior is set **once at the field level** and applied across all pegs: Up/Down/Left→Right/Right→Left (the struck peg's own position, normalized against the field's own bounds) or Random. One setting on the field, not per-peg configuration. Its hit-indexed gate is likewise field-level: one shared hit-counter across all pegs (every peg shares the field object's own id), symmetric with how pitch behavior works. See handoff.md for current status/gaps.

---

## 5. Bouncers (as an Object preset)

- Shapes to start: circle, triangle, square (freely resizable to a rectangle or a thin block/line via its own corner handle), plus the plinko peg field as its own preset (not yet built).
- Collision on by default (that's what makes it a "bouncer" preset rather than a "trigger" preset) — sound module optional on top, so any bouncer can double as an instrument or stay silent and purely physical.
- Like any object with a sound module, a bouncer can carry a hit-indexed gate (§8.6) — e.g. a bouncer that only actually sounds on every 3rd or 7th (or prime-numbered) collision, rather than every single one.
- Shape list stays open/extensible — more shapes later without changing the underlying model.

## 6. Triggers (as an Object preset)

- Same underlying object, collision *off*, sound module *on* — a zone that senses passage without physically interacting.
- "Passing through the zone is a hit" is the only *detection* rule for the prototype — no directional logic, no special zone shapes. What happens *after* a hit is detected — whether it actually sounds — is governed by the sound module's hit-indexed gate (§8.6), same as bouncers and peg fields. So "Nth hit sounds" is available on triggers, just implemented as that shared gate rather than as trigger-specific logic.

---

## 7. Pitch, key/mode, and chords

### Global key/mode with per-object override
- One **global key** (note + octave) **+ mode** setting, in the system menu — changes the whole instrument's tonal center in one place.
- Any sound-carrying object can optionally override it with its own note/octave/mode (three pills, defaulting to "none" — inherits global until a note is actually picked); otherwise it just inherits the global value. Cheap to implement (one inherited value, optionally shadowed) and matches how you'd actually want to work — tweak the whole piece by default, break out individual objects only when you want a deliberate clash.

### Pitch behavior (per sound-carrying object)
Same small vocabulary everywhere a note needs choosing: **Fixed** (always the same note), **Random-in-key**, **Cycle-up**, **Cycle-down**, **Piano** (hand-pick a specific set of notes from a small on-canvas keyboard widget, then cycle/random through just those — built, see handoff.md), and **Positional** (left-to-right / by row — peg fields only, set programmatically, not offered in the general per-object dropdown). All draw from the object's effective key/mode (global or overridden); Piano's picks additionally transpose with root changes and re-snap to the scale on mode changes, rather than staying fixed pitches.

### Chords (pad auto-chord)
Three complexity tiers, kept deliberately small so it doesn't sprawl:
- **Triad** — root + 3rd + 5th.
- **7th** — triad + 7th.
- **Extended** — adds tensions (9th/11th/13th) drawn from the active scale, one "spicier" tier rather than a long menu of named chord types.

Plus a **Chord** toggle: the root always follows whichever pitch behavior is selected above, regardless of this toggle — off plays that root alone (a single note, same as any other voice); on stacks the chosen complexity tier's extra intervals on top of it. The *root* itself is always chosen via the same pitch-behavior vocabulary (random-in-key / cycle-up / Piano / etc.) — this reuses machinery already needed elsewhere instead of inventing chord-specific logic.

---

## 8. Timing & math generators

Two index spaces, kept strictly separate: **clock-ticks** (what a spawn module counts against) and **hits** (what a sound module counts against, if it bothers to gate at all). Same generator "chamber" feeds both — only what it's counting differs.

### 8.1 Global clock — spawn modules only
- One shared BPM/transport drives all spawn-module timing, per your call — simplest to keep spawners musically locked together. Revisit independent per-spawner clocks later only if this feels too rigid in practice.
- **Only spawn modules are tied to this clock.** Nothing else on the canvas has any notion of "what beat is it" — see §8.6.

### 8.2 Time signature — spawner rhythm meter
- Per spawner: numerator + denominator fields, uncapped (4/4, 9/7, 13/8, whatever).
- **Automated drift, independently per value**: numerator and denominator each get their own drift-max number field — 0 (or empty) means no drift, any positive number enables it with that as the ceiling. You can drift just the numerator, just the denominator, both, or neither. Whichever value(s) have a nonzero max get re-picked (within their own limit) once the current full cycle completes.

### 8.3 Beat selection within the cycle — spawner only
One flat dropdown per spawner picks how beats in the cycle fire an emission — no separate "mode" selector, just a single list:
- **None** — every eligible beat fires (the default; equivalent to no filtering).
- **Manual** — a hand-toggled step grid (4/8/16), the deliberate "drum computer" input for exact patterns like "beat 1 and 3." Resolution is a *note subdivision* (quarter/eighth/sixteenth), not a fixed step count — total steps = numerator × (resolution/4), so a 7/4 meter at "quarter" resolution gives 7 steps (one per beat) and at "eighth" gives 14, rather than cutting the bar into a fixed number of equal pieces regardless of meter. Changing the numerator reshapes the grid to match.
- **Euclidean** (deterministic) — classic "N hits spread evenly across M beats" pattern (Bjorklund's algorithm), plus a **rotation** parameter to shift the phase of the pattern. Directly answers the "x-per-y" case (2-per-4, 3-per-3, etc.). Cheap: computed once whenever N/M/rotation changes, then just read off tick-by-tick.
- **Prime / Fibonacci / Markov / LFSR / Wolfram** — the math generators below, indexed by clock tick, decide fire/don't-fire per beat.

These are either/or, not layered — picking one replaces whichever was active, deliberately kept simple rather than stacking multiple filters on a spawner's own emission.

### 8.4 The generator "chamber"
A small, fixed set of interchangeable generators — shared machinery, usable against *either* index space (§8.6). Every one below is O(1) (or amortized O(1)) per index step — table lookups, a bit-shift, or a single comparison. None of this is where compute risk lives; see the verdict at the end of this section.

1. **Prime lookup** — a hardcoded 128-entry table (position *i* marks whether *i* is prime). Reads `table[index % 128]`. Free.
2. **Fibonacci-mod-6, read as gap lengths** — the raw 24-value sequence `[0,1,1,2,3,5,2,1,3,4,1,5,0,5,5,4,3,1,4,5,3,2,5,1]` isn't used as the gate values directly (that would just be a string of near-constant "on"s, not musically useful). Instead each value *vᵢ* means "*vᵢ* zeros, then a one" — the sequence becomes a rule for gap width between hits, not the hits themselves. Expanding all 24 values this way (e.g. the run `1,1,2,3,5,...` becomes `10 10 100 1000 100000 ...` concatenated) gives one long, fixed binary string. This expansion happens **once, offline**, and only the *result* — the already-expanded binary string — is stored, exactly like the prime table. No run-length math happens at runtime; an index just reads `table[index % length]`, identical in shape and cost to generator 1.
3. **2-state on/off chain** — exactly your proposal: currently-on → 30% stay on / 70% turn off; currently-off → 60% turn on / 40% stay off (values tunable pills). This *is* a Markov chain — the simplest possible one (2 states, order 1) — so "obsolete" undersells it: it's the cheapest thing on this list. One `Math.random()` compare per index step. Keep it, drop the more elaborate multi-state Markov idea — it doesn't earn its complexity here.
4. **LFSR** (linear feedback shift register) — classic cheap pseudo-random bit stream via shift + XOR feedback taps, the trick chiptune hardware used for noise/hats. O(1) per step, reseedable. Good fit, adds real "digital/glitchy" character distinct from the others.
5. **Wolfram elementary CA (rule 30/90/110/150)** — genuinely as light as it looks: store the row as a **32-bit integer** (each bit a cell), compute the next generation with a handful of bitwise ops (shift, XOR/AND per the rule's lookup), wrapping the edges circularly. A fixed, tiny number of machine-word operations per generation regardless of row width (up to 32 cells) — realistically sub-microsecond. It doesn't "run out" in the sense of stopping — it's chaotic but will eventually cycle within its finite 32-bit state space; reseed with a fresh random 32-bit start whenever fresh material is wanted, rather than waiting for a natural cycle.
6. **Euclidean/Bjorklund pattern** — see §8.3; also usable standalone as a generator (not just for spawner beat-selection), with a rotation parameter for phase offset.

Deliberately **not included**: a general multi-state Markov chain, and general-modulus Fibonacci — both are strictly more machinery for a result the simpler options above already cover for this use case. Easy to add later if a specific musical need shows up that these six don't cover.

### 8.5 How a generator becomes an on/off decision
Every generator reduces one index step to a single on/off gate: **1 fires an event, 0 skips it.** Generators 3–6 emit that natively, step by step. Generators 1 and 2 get there by being pre-baked into a fixed binary string *before* runtime rather than interpreted live — a tick's/hit's index is either prime or not (table 1), or falls on a `1` in the pre-expanded Fibonacci-gap string (table 2). By the time anything is actually running, there's no meaningful difference in shape between any of the six — every one hands over a `0`/`1` per index, whether that bit came from a static table (1, 2, and the Euclidean/Bjorklund pattern, which is likewise computed once per N/M/rotation and then just read off) or is produced live step-by-step (the 2-state chain, LFSR, and Wolfram CA — the three that are *meant* to keep evolving or be reseedable, which is their whole musical point, so they're the only ones that can't be flattened into one fixed loop).

### 8.6 Two different index spaces — this is the important distinction
- **Spawn modules index by clock tick.** This is the only place a "beat" exists at all. The time signature (§8.2) defines which tick positions are eligible; the generator chamber, indexed by tick, decides which of those actually fire. This is what "musical timing" means in Heiðrún — it's inherently a spawner concept.
- **Sound modules index by their own private hit-counter**, not by clock tick. Every physical interaction the object experiences (a collision for a bouncer, a pass-through for a trigger, a landing for a peg) increments that counter by one; the same six generators can be attached here too, but reading `table[hitCount % length]` instead of `table[tick % length]` (or stepping once per hit instead of once per tick, for the three live ones). Crucially, this is **not clock-aligned** — a bouncer getting struck by particles arriving irregularly produces an irregular sequence of "is this the Nth hit" checks. It's an interaction-density filter, not a rhythm.
- **Default gate on any sound module is always-on** (every hit sounds, no filtering at all). This is deliberate, and it's the answer to "how do I make a static object sound at a precise musical rate": you don't gate the object itself — you build the exact rhythm into a spawner's clock-tick gate, aim its particles at the target object(s), and leave the target's own gate at always-on so every arrival just passes straight through untouched. The spawner is the only thing that ever needed to know what beat it is; the receiving object just relays whatever reaches it. A hit-indexed gate is only for when you want *additional*, non-beat-aligned thinning layered on top of whatever already arrives — a different, still useful, but not equivalent kind of sparsity.
- **A particle is not exempt from any of this.** It was tempting, mid-build, to treat a spawner's particles as one-shot and evaluate their gate once at spawn time against the spawner's own counter instead — that was tried and reverted. It's wrong because a particle can bounce through several bouncers/triggers before it leaves the canvas, so it genuinely experiences its own stream of hits, same as a placed object; the fix collapsed that into a single frozen decision and lost the "keeps accumulating across hits" property entirely. The correct (and simpler) rule: a particle's sound module is a normal sound module, cloned fresh per particle so each one gets its own independently-accumulating gate, exactly like placing a new object would. If you want gate/accent patterning to accumulate across a whole *stream* of particles instead of within one particle's own bounces, that's what routing particles as pure exciters (sound off) into a persistent bouncer/trigger's gate is for — the receiving object is the thing built to count a long stream, not the particle.
- **Accent gate**: a second, independent hit-indexed gate on any sound module, evaluated only on interactions that the main gate already let through. When it fires, it swaps in an alternate pitch behavior/degree for that one note instead of spawning a second, competing note — the mechanism the "extra trigger just adds another note" workaround was missing. Same generator chamber, same either/or manual-or-generator choice as the main gate.

**Performance verdict**: no, this doesn't come close to "overdoing it," and it doesn't summon the old crash-dragon. Every generator above costs a lookup, a shift, or a comparison — literally nothing compared to a single WebAudio voice's per-sample DSP or a single Matter.js physics step, and both of those are themselves cheap at the scale you described (steady 4/4, one bass pattern, randomized melody, occasional pads, steady 1/8 hats). Giving *every object its own independent generator instance*, on either index space, is fine even heavily stacked — the actual budget-relevant costs are (a) how many physics bodies are alive at once and (b) how many concurrent audio voices/effect sends are ringing, not which of these six math functions each object happens to be running, or which counter it's reading. Hardcoding the prime and Fibonacci tables isn't cheating, either — the math is what produced the table; hardcoding is just caching that result instead of recomputing it every step, which is a normal, correct optimization, not a shortcut around "real" math.

---

## 9. Sound engine & effects

- Pure WebAudio synthesis (oscillators, noise sources, simple filters, ADSR-style envelopes) — no sample loading for this test version.
- Six instrument voices to start: bass, kick, snare, hats, pad (+ auto-chord, §7), melody. Snare and hat are deliberately separated in frequency (snare: tonal thump + mid-band ~2800Hz crack; hat: pure noise above ~9500Hz) so they read as distinct percussion rather than two flavors of the same hit.
- Effects as shared **return channels**, not placeable objects (your Ableton-style call): a small fixed number of send buses (one reverb, one delay to start) that any sound-carrying object can send to with its own gain/send-amount. Keeps the object model simple (one object type, composable modules) and keeps effect processing centralized — only ever N reverb/delay instances regardless of how many objects use them.
- **Per-instrument sound-design tunables are built** — a system-menu section, same pattern as the physics/palette sections: kick/snare/hat get a shared Decay/Tone/Pitch baseline; bass/pad/melody get a deeper tier — a full ADSR-shaped amplitude envelope (Attack/Decay/Sustain level/Sustain time/Release), tone, waveform, resonance, filter envelope, unison, vibrato, noise, and bass gets a sub oscillator. `Sustain time` exists because every note here is a one-shot physics-triggered hit rather than a held key — Attack→Decay ramps to Sustain level, holds for `sustainTime` seconds (0 default), then Release fades, faking a longer held note on demand. Global only, not per-object — see handoff.md for play-test status.
- **Output limiter is built** — a compressor after the master bus, on by default, adjustable/removable with an at-your-own-risk warning (see handoff.md) — not part of the original concept plan, added once the app was actually loud enough to need one.
- **Global BPM** lives in the system menu ("Global timing" section) — the one thing that actually is global across every spawner; time signature stays per-spawner by design (§8.2).

---

## 10. Persistence

- **localStorage as a real project store**, not just a single autosave slot: an index (list of saved canvas names/IDs) plus one stored JSON blob per canvas, giving you actual **open / save / save-as / delete / rename** — exposed from the system menu (hamburger). localStorage's typical ~5–10MB origin quota is enormously more than a few dozen JSON canvas layouts need, so yes, it can comfortably be "the go-to" for this without a backend.
- Keep **JSON export/import** alongside it (copy-to-clipboard / paste-to-load, same pattern as `input.html`'s "copy settings JSON") — useful for backup, moving a layout between browsers/machines, or sharing a layout with me, since localStorage alone is trapped in one browser/origin.
- **Later** (once this lives in the git repo / becomes the real app): promote to file-based or app storage. Not needed for the prototype.

---

## 11. Scope / performance target

Rough design ceiling, sized comfortably above the example patch you described (steady 4/4, a bass pattern, randomized melody, occasional pads, steady 1/8 hats — all together, "hardly breaking a sweat"): design around on the order of **50–100 simultaneously live physics bodies** and **~30 concurrent audio voices** (including effect sends) as the point where we'd start actually thinking about optimization, not where problems begin. The example patch you described is well under 20 of each. Physics stepping and audio voice count are the real cost centers — see the generator verdict in §8.6 for why the math layer isn't one.

**Canvas size vs. object count vs. audio load — three separate axes, don't conflate them.** The canvas itself (§16) is a fixed, generous world rect, not infinite — but world *size* costs nothing on its own; a huge sparse world is as cheap as a small one. Object/body count itself turns out to be cheap too, well past this section's original 50-100 target — user testing found a screen-filling peg field clears 4000+ live bodies with zero trouble. **The real cost is concurrent audio voices** — many particles sounding within the same stretch of time — which only tracks body count when particles are concentrated onto a few sound-producing objects (a couple of bouncers) rather than spread across a wide field. The optional object cap (§16) is a body-count proxy failsafe for that, off by default on purpose — it's not meant to stop anyone from pushing past this section's original target, since that target turned out to describe the wrong bottleneck.

---

## 12. Undo/redo

Worth having even in the prototype — canvas edits are exactly the kind of thing you want to back out of while molding. Simplest correct approach for this scale: a circular buffer of full canvas-state snapshots (the same JSON structure as export/save) rather than a command/diff system — layouts are small, so snapshotting the whole thing on every meaningful edit is cheap and much less code than tracking individual diffs. **50 steps** as a reasonable default depth (cheap in memory at this JSON size, generous for a building session); easy to tune once it's actually in use.

---

## 13. Resolved

- Spawners define the sound-module configuration (instrument, key/mode, pitch behavior) that every particle they emit is born with — see §4.
- Peg-field pitch behavior is field-level, no per-peg override, indefinitely — and its optional hit-indexed gate is field-level too, for the same reason. Peg field itself is built — see §4.
- Spawner-emitted particles are destroyed once they leave canvas bounds, to keep physics/audio load bounded — see §4, Particle lifecycle.
- **Only spawn modules are tied to the global clock.** Sound modules (on bouncers, triggers, peg fields, and particles) gate off their own private hit-counter instead, using the same generator chamber but a different index — see §8.6.
- Default gate on a sound module is **always-on**. Precise musical rate on a static object is achieved by building that rhythm into an upstream spawner and letting it pass straight through, not by gating the receiving object itself.
- Look & UI base rules — cream background, hard semi-saturated pastel objects, tiny-bordered pill controls with pastel-drawn highlight states, compact/minimal sizing throughout — see §3.
- **A particle's sound module must be cloned live, not evaluated once and baked at spawn time** — see §8.6. Tried the opposite during the build, confirmed wrong, reverted.
- **Accent gate**: a second hit-indexed gate per sound module, evaluated only after the main gate passes, swapping in an alternate pitch instead of adding a note — see §8.6.
- **Particles can opt out of sound entirely** (pure exciter) via the same on/off shape as any other object's Sound toggle — see §4.
- Manual beat-select resolution is a note-subdivision scaled by the spawner's own numerator, not a fixed step count — see §8.3.
- **Piano pitch behavior**: hand-pick a set of notes from a small keyboard widget, then cycle/random through just those — follows the object's own root/mode (transposes with root changes, re-snaps to scale on mode changes) rather than being an independent absolute-pitch system. See §7 and handoff.md.
- **Global key override decoupled**: an object's note/octave/mode override are each independently settable — overriding just the octave no longer requires also overriding the note.
- **Multi-select**: drag-select (marquee) on the canvas, for moving or deleting several objects at once — not in the original concept doc, added once the canvas started accumulating enough objects that one-at-a-time cleanup became tedious.

This doc now trails actual behavior rather than leading it — architecture.md and handoff.md are the current sources of truth for anything that's shipped; treat sections above as "what we set out to build and mostly did," not a live spec.

---

## 14. Direct lineage from `input.html`

| `input.html` | Heiðrún |
|---|---|
| Fixed peg box + click-to-spawn button | Freeform-placed spawner objects, auto-emitting on rhythm |
| Single row of 5 landing buttons | Any number of placeable sound-carrying objects (trigger-preset or bouncer-preset) |
| Peg field with drag handles for bounds/spacing | Plinko peg-field cluster object, same drag UX, placeable anywhere, field-level pitch behavior + gate |
| Global physics sliders (gravity, restitution, friction, air friction) | Same, unchanged in spirit, in the system menu |
| Dark background, cyan/magenta neon accents | Cream background, hard semi-saturated pastel accents (§3) |
| Dev drawer (side panel) | Inline per-object popovers (build mode) + small system menu (hamburger, global-only settings) |
| "Copy settings JSON" | JSON export/import + localStorage project manager (open/save/save-as/delete/rename) |
| Click to spawn one sheep | On/off toggle per object — live physics/audio participation while still in build mode |
| (no equivalent — single fixed patch) | Global BPM in the system menu; per-spawner time signature, independently driftable |
| (no equivalent) | Pause button, defaults on, freezes physics + spawning entirely |

---

## 15. Hardware output — ES-9 Eurorack interface

Not part of the original concept — added once the WebAudio prototype layer was far enough along to think about what it's actually standing in for: sending pitch/gate/envelope/audio signals out over USB to an Expert Sleepers ES-9 Eurorack interface, patched from there into whatever modular gear is at hand. Connection is plain multichannel WebAudio (a `ConstantSourceNode` pair per note-voice feeding a 16-channel merger, routed to the ES-9 via `AudioContext.setSinkId`), **not MIDI** — the earlier "WebMIDI" description in this doc's history was wrong; see architecture.md for the technical shape. Of the ES-9's 16 device-level channels, only 8 (its DC-coupled 3.5mm Eurorack jacks) are usable for this; those 8 are what "channel 1–8" means everywhere in this app's UI.

### Per-object routing
Lives inside each object's sound module — an object needs a sound module to route to ES-9 (a bare physics-only trigger can't yet, see §13 open items if that's ever wanted). One or more **routing lines**, each a channel (1–8) + signal type pair:
- **Pitch** — 1V/octave CV, the object's own resolved pitch (same pitch-behavior machinery as its normal WebAudio voice).
- **Gate** — on/off trigger, high for the duration of the object's own internal ADSR envelope (Attack→Decay→Sustain-hold), low at Release. Reuses the existing per-instrument ADSR knobs directly — no separate gate-length control.
- **ADSR** — the same envelope shape, sent as CV instead of a flat on/off, for patching into a module's VCA/filter CV input. **Alternative to Gate, not additional** — a "note" only ever costs 2 outs (pitch + one of gate/adsr), never 3.
- **Audio signal** — the object's actual synthesized audio, sent at audio rate instead of through the app's own speakers. Selecting this **replaces** that object's local playback; pitch/gate/adsr-only routing leaves local playback untouched.

Channels are **not exclusive** — routing several objects to the same channel is allowed and useful for testing (the mental model is patch-cable stacking: one ES-9 output can already feed several modules at once in the real modular, so contention on a channel is expected, not a bug to prevent). The ES-9 settings card shows an **"x/8 channels patched"** readout so it's never a surprise how much headroom is left.

### Voice stealing & glide
Each channel is monophonic in practice — a physical CV/gate pair can only carry one voltage at a time. Whichever object last triggered a note on a given channel simply takes it over (cut or glide, never overlapped/mixed). **Legato/staccato/auto-glide (plus a glide-time value) is a per-object setting**, not per-channel or global: an object already knows whether it's a short pluck or a long pad, so it's in the best position to decide how its own notes retrigger — including when it's the one stealing a channel from a different object; the winning note's own settings apply. Auto-glide (303-style): if the previous note on that channel is still gated/enveloping when a new note fires, glide + legato; if the channel was already idle, a fresh staccato retrigger.

### Calibration & connection
Global, not per-channel: full-scale voltage, gate-high voltage, root note (0V reference) — one interface, one calibration. Connecting is a user-gesture-gated flow (scan devices → pick output → connect), same shape as the recovered `test.html` test rig, opened in **its own dedicated `AudioContext`**, entirely separate from the app's normal listening context.

### Muting layers
Three independent, non-destructive controls, next to the mode toggle (now labeled **Clean** rather than Play, to avoid clashing with this vocabulary):
- **Pause** (existing) — freezes physics/spawning entirely; not for cutting sound mid-performance, since it desyncs the app from anything else it's playing alongside.
- **Mute Unsent** — mutes the app's own local `AudioContext` output only. Everything already routed to the ES-9 (its separate context) keeps sounding — since audiosignal-routed objects never played locally anyway, muting the whole app context *is* "mute everything except what's going to the modular," with no per-object bookkeeping needed.
- **Mute All** — mutes both contexts (app + ES-9), full silence, but — like Mute Unsent — keeps physics/spawning/scheduling running underneath, so un-muting resumes exactly in phase rather than re-triggering a paused simulation.

Built — see architecture.md for the module layout and handoff.md for status/what's not yet click/listen-tested.

---

## 16. Pan/zoom canvas & object cap

Resolves handoff.md's "canvas is viewport-bounded" gap. Two separate things, deliberately not conflated (see §11's amendment above for why):

**Camera (pan/zoom).** The canvas is now a viewport into a fixed, generous world rect (`render/camera.js`'s `WORLD` — currently a 6000×5000 area centered roughly on where the viewport used to sit, tune freely), not literally infinite — an unbounded world paired with an unbounded peg field is exactly the runaway-density failure mode this section's cap exists to prevent, so "endless" was rejected in favor of "big enough that it practically never binds." At default camera position/zoom (load time), the view looks pixel-identical to before pan/zoom existed — nothing about an existing saved project changes until someone actually pans. Panning: hold space and drag, middle-click drag, or trackpad two-finger scroll. Zooming: ctrl/cmd+scroll (also how a trackpad pinch gesture is reported), centered on the pointer. A dashed outline (build mode only) shows the world edge. Physics itself needed no changes — Matter bodies were always in "world" coordinates, it's only rendering (`render/draw.js`) and pointer math (`ui/interaction.js`) that used to assume world == screen.

**Object cap.** A plain-text live counter next to the toolbar's Peg field button (physics/sync.js's `getLiveBodyCount` — every peg counts individually, not "1 per field") shows the current live-body total at a glance, right where density is most likely to run away. An optional hard cap lives in its own small "Object cap" card (off by default, one line: toggle + number): when on, a spawner simply stops emitting new particles once the live body count reaches the configured number, silently (existing particles keep living/dying normally) — same "quietly cap rather than burst" instinct as the spawner's own edge-triggered timing (§8.6). The counter turns red once the cap is on and reached.

(Prompted by a real stutter/audio-cutout incident, since diagnosed to concurrent audio voices, not body count — see §11's amendment. The cap is a proxy failsafe for that, deliberately off by default.)
