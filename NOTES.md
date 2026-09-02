# Heiðrún — known limitations & open questions

Things worth knowing before extending this that aren't otherwise obvious from the code. See [ARCHITECTURE.md](ARCHITECTURE.md) for how everything works; this doc is just the gaps and unresolved calls.

---

## Known limitations

- **Rotated-rect hit-testing/resize is axis-aligned.** For any rect-shaped object (`square`, peg fields), clicking near a visually-rotated corner or dragging its resize handle is measured against an unrotated bounding box — physics itself rotates the actual body correctly, only the on-canvas interaction math doesn't account for tilt. Doesn't affect physics, only click/drag precision on a rotated object's corners. Not currently worth fixing further.
- **Concurrent audio voice count, not object/body count, is the real performance ceiling.** A dense-but-spread-out peg field handles 4000+ live physics bodies fine; particles funneled through a few sound-producing objects can choke the audio graph around ~125 concurrent voices. The optional object cap (ARCHITECTURE.md §7) is a body-count proxy failsafe for this, not a direct fix — a real concurrent-voice throttle doesn't exist yet.
- **ES-9 `audiosignal` routing uses a simplified voice.** It doesn't reuse the actual kick/snare/bass/pad/melody voice modules (those are wired only to the app's own listening context) — it's a separate oscillator+ADSR-shaped-envelope voice in `es9/routing.js`, using the object's resolved pitch and instrument settings but not each voice's own unison/filter-sweep/sub-oscillator character. Revisit if a specific voice's exact timbre needs to reach the ES-9 output too.
- **A purely physical (no sound module) object can't route to ES-9.** Whether a bare-physics object should ever be able to fire an ES-9 gate hasn't been decided.
- **ES-9 calibration is global, not per-channel.** One full-scale-voltage/gate-voltage/root-note calibration for all 8 channels; no per-channel scaling if a specific module ever needs something other than 1V/oct.

## Deliberate trade-offs (not bugs)

- **Spawner ticking has no catch-up/replay mechanism.** At BPM/subdivision combos faster than one rendered frame, firing rate silently caps at one particle/frame instead of staying locked to tempo. Chosen because a burst (the old failure mode) is worse than a very-slightly-under-tempo edge case.
- **Kick/snare/hat use a simple 3-knob baseline (Decay/Tone/Pitch), not the bass/pad/melody-style full ADSR.** Confirmed as the right call for now; revisit only if that changes.

## Open design question

**Should autosave extend further than it already does?** Autosave (ARCHITECTURE.md §9) currently persists the whole canvas — layout and settings both — silently, on every change. Nothing further is pending here; noted in case a future session wants to reconsider scope (e.g. multiple autosave slots, versioned snapshots) rather than the single ambient layer that exists today.
