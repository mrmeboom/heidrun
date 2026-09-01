// The one generic Object record + preset factories — architecture.md §4,
// prototype.md §4. No class hierarchy: "Bouncer"/"Trigger"/"Spawner" are just
// different starting module values on the same shape.

let counter = 0;
export function generateId(prefix = 'obj') {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

const PASTEL_COUNT = 6;
function randomColorIndex() {
  return Math.floor(Math.random() * PASTEL_COUNT);
}

/** @typedef {'circle'|'triangle'|'square'|'rectangle'|'asterisk'} ShapeType */
// 'rectangle' stays a valid renderable/physics shape (old saves, particles)
// but is retired from the picker — 'square' now drags into any width/height,
// so a separate rectangle preset is redundant (feedback: "big blocks and
// thin lines just with a very simple gesture").
export const SHAPES = ['circle', 'triangle', 'square', 'asterisk'];
export function randomShape() {
  return SHAPES[Math.floor(Math.random() * SHAPES.length)];
}

/**
 * @typedef {Object} GateConfig
 * @property {string|null} type   null = always-on (every hit sounds/fires)
 * @property {Object} config
 * @property {number} index       running counter this gate reads against
 */
function createGate(type = null, config = {}) {
  return { type, config, index: 0 };
}

/**
 * @typedef {Object} Es9RoutingLine
 * @property {number} channel  1–8, which ES-9 Eurorack jack this line drives
 *   (architecture.md's es9/context.js maps this to the ES-9's actual
 *   DC-coupled device channels 9–16). Channels are not exclusive — the same
 *   channel can be picked by several lines/objects at once, prototype.md §15.
 * @property {'pitch'|'gate'|'adsr'|'audiosignal'} signal
 *   pitch: 1V/oct CV of this object's resolved note. gate: on/off, high for
 *   this object's own internal ADSR duration (Attack→Decay→Sustain-hold).
 *   adsr: the same envelope as shaped CV instead of flat on/off — alternative
 *   to gate, not additional (a note only ever costs 2 outs). audiosignal: the
 *   object's actual audio, sent at audio rate instead of through the app's
 *   own speakers — replaces this object's local playback.
 */

/**
 * @typedef {Object} Es9Module
 * @property {boolean} enabled
 * @property {Es9RoutingLine[]} lines
 * @property {'legato'|'staccato'|'auto'} glideMode
 *   Per-object (prototype.md §15) — applies whenever this object's own note
 *   steals a channel, regardless of which object held it before. 'auto' is
 *   303-style: glide+legato only if the channel's previous note is still
 *   gated/enveloping when this one fires, staccato retrigger otherwise.
 * @property {number} glideTime  seconds, pitch-ramp time for legato/auto-glide notes
 */
export function createEs9Module(overrides = {}) {
  return {
    enabled: false,
    lines: [],
    glideMode: 'staccato',
    glideTime: 0.08,
    ...overrides,
  };
}

/**
 * @typedef {Object} SoundModule
 * @property {string|null} instrument  'kick'|'snare'|'hat'|'bass'|'pad'|'melody'|null
 * @property {{ note: string|null, octave: number|null, mode: string|null }} keyOverride
 *   Each of the three is independently `null` = "inherit global" — overriding
 *   just the octave (say, to drop a bass object down without also breaking
 *   its note/mode away from the global key) doesn't require overriding the
 *   other two as well.
 * @property {'fixed'|'random'|'up'|'down'|'positional'|'piano'} pitchBehavior
 * @property {number} fixedDegree
 * @property {number} pitchRange
 * @property {number[]} pianoNotes
 *   Only meaningful when `pitchBehavior === 'piano'`. Chromatic semitone
 *   offsets *from the object's own effective root* (`canvasState.js`'s
 *   `effectiveKeyFor`) — not absolute MIDI, not scale degrees — so a root
 *   (note or octave) change transposes every entry for free just by being
 *   added back on at resolve time, with nothing stored here needing to
 *   change. A mode change is the one case that *does* rewrite this array:
 *   `canvasState.js` snaps any now-out-of-scale entry to its nearest in-scale
 *   neighbor whenever this sound module's effective mode changes. Selected by
 *   clicking keys on the popover's piano widget; an empty array means no note
 *   plays at all (same as an empty manual gate pattern), not a fallback note.
 * @property {'up'|'down'|'updown'|'downup'|'random'} pianoCycle
 *   Traversal order over `pianoNotes` (sorted ascending) — `updown`/`downup`
 *   bounce at the ends instead of wrapping. Own cursor state
 *   (`_pianoCursor`/`_pianoDirection`), separate from `up`/`down`'s `_cursor`
 *   since bounce needs to remember direction and wrap doesn't.
 * @property {GateConfig} gate   hit-indexed (prototype.md §8.6), default always-on — gate.index doubles as the hit counter
 * @property {{ auto: boolean, complexity: 'triad'|'seventh'|'extended' }} chord
 *   Pad only. The root is always resolved via `pitchBehavior` above, same as
 *   every other voice — `auto` doesn't gate that, it only decides whether
 *   `complexity`'s extra intervals get stacked on top of that root (a real
 *   chord) or the root plays alone (a single note, off by default). With
 *   Piano, the root's chromatic pick snaps to its nearest scale degree only
 *   at the moment chord tones are stacked on top of it — chords are always
 *   in-key in this app regardless of pitch source, matching every other
 *   pitch behavior's chords, which were already scale-relative.
 * @property {number} sendReverb  @property {number} sendDelay
 * @property {Es9Module} es9  hardware routing, prototype.md §15 — needs a sound module to exist (see createEs9Module)
 * @property {{ gate: GateConfig, pitchBehavior: string, fixedDegree: number, pitchRange: number, pianoCycle: string }} accent
 *   Evaluated only on notes that already sound (after `gate` passes) — when it
 *   fires, this pitch behavior replaces the normal one for that one note
 *   instead of adding an extra note. Default gate type 'off' — accents are
 *   opt-in per object, not switched on by default. Accent's own `'piano'`
 *   reuses the parent sound module's `pianoNotes` (there's no separate accent
 *   note-picker widget) — only `pianoCycle` differs, so the accent can walk
 *   the same picked notes in a different order (e.g. main cycles up, accent
 *   picks randomly among the same notes).
 */
export function createSoundModule(overrides = {}) {
  return {
    instrument: 'melody',
    keyOverride: { note: null, octave: null, mode: null },
    pitchBehavior: 'random',
    fixedDegree: 0,
    pitchRange: 14,
    pianoNotes: [],
    pianoCycle: 'up',
    gate: createGate(null),
    chord: { auto: false, complexity: 'triad' },
    sendReverb: 0.15,
    sendDelay: 0,
    es9: createEs9Module(),
    accent: {
      gate: createGate('off'),
      pitchBehavior: 'fixed',
      fixedDegree: 12,
      pitchRange: 14,
      pianoCycle: 'up',
    },
    ...overrides,
  };
}

/**
 * @typedef {Object} SpawnModule
 * @property {{ numerator: number, denominator: number, numeratorDriftMax: number, denominatorDriftMax: number }} meter
 *   numerator/denominatorDriftMax === 0 means "no drift" (null/empty in the UI).
 * @property {{ type: 'none'|'manual'|'euclidean'|'prime'|'fibonacci'|'markov'|'lfsr'|'wolfram',
 *   manual: { resolution: 4|8|16, steps: boolean[] },
 *   euclid: { hits: number, steps: number, rotation: number } }} beatSelect
 * @property {ShapeType|'random'} emitShape
 * @property {number} emitSize
 * @property {boolean} particlesHaveSound  off = spawned particles are pure exciters (sound: null),
 *   same as a bouncer with Sound off — the template below is kept either way so toggling doesn't lose settings
 * @property {SoundModule} particleSound  stamped onto every emitted particle (cloned fresh — each particle
 *   gets its own live, independently-accumulating gate/accent, exactly like any other object)
 * @property {GateConfig} gate   caches the active math-generator instance (clock/transport.js owns the actual indexing — prototype.md §8.6)
 */
export function createSpawnModule(overrides = {}) {
  return {
    meter: {
      numerator: 4,
      denominator: 4,
      numeratorDriftMax: 0,
      denominatorDriftMax: 0,
    },
    beatSelect: {
      type: 'none',
      manual: { resolution: 8, steps: new Array(8).fill(false) },
      euclid: { hits: 3, steps: 8, rotation: 0 },
    },
    emitShape: 'asterisk',
    emitSize: 10,
    particlesHaveSound: true,
    particleSound: createSoundModule({ instrument: 'melody' }),
    gate: createGate(null),
    ...overrides,
  };
}

/**
 * @typedef {Object} FieldModule
 * @property {number} spacing    peg-to-peg distance; also drives row height (spacing * sqrt(3)/2, hex packing)
 * @property {number} pegRadius
 * @property {SoundModule|null} sound  field-level, shared by every peg — one instrument/gate/accent for
 *   the whole field (prototype.md §4/§13: "one shared hit-counter across all pegs in the field, not one
 *   per peg"), which falls out for free from every peg body sharing the field object's own heidrunId.
 * @property {'up'|'down'|'left'|'right'|'random'} pitchMode  how a peg hit resolves to a scale degree —
 *   main.js turns this into `sound.pitchBehavior`/`positionIndex` per hit using the struck peg's own
 *   position, normalized against the field's current bounds (0 at one edge, 1 at the other — NOT an
 *   absolute peg count, which would exhaust a small `sound.pitchRange` within the first few rows of any
 *   reasonably wide field), not `sound.pitchBehavior` directly (hidden in the popover for a peg field —
 *   see objectPopover.js). 'up': field's top edge is the lowest note, bottom is highest, so a particle
 *   falling through hears pitch climb; 'down'/'left'/'right' mirror it across the same or the horizontal
 *   axis. 'random' just reuses the existing 'random' pitchBehavior as-is, re-rolled per hit.
 * Peg count is never stored — it's re-derived from spacing + the object's own
 * width/height every time either changes (architecture.md's "derived data is
 * always safe to throw away and rebuild from state", same as input.html's
 * rebuildPegs()).
 */
function createFieldModule(overrides = {}) {
  return { spacing: 80, pegRadius: 10, sound: null, pitchMode: 'up', ...overrides };
}

/**
 * @typedef {Object} HeidrunObject
 * @property {string} id
 * @property {'bouncer'|'trigger'|'spawner'|'particle'|'pegfield'} preset
 * @property {ShapeType} shape
 * @property {number} x @property {number} y @property {number} rotation @property {number} size
 * @property {number} width @property {number} height  independent size for square/rectangle only — everything else uses `size`
 * @property {number} colorIndex  index into the palette's pastel set, randomized per object
 * @property {{ collides: boolean, live: boolean, isStatic: boolean }} physics
 * @property {SoundModule|null} sound
 * @property {SpawnModule|null} spawn
 * @property {FieldModule|null} field  only on a 'pegfield' preset — see createFieldModule
 */
function createObject(overrides = {}) {
  const merged = {
    id: generateId(),
    preset: 'bouncer',
    shape: 'circle',
    x: 0,
    y: 0,
    rotation: 0,
    size: 24,
    width: 24,
    height: 24,
    colorIndex: randomColorIndex(),
    physics: { collides: true, live: true, isStatic: true },
    sound: null,
    spawn: null,
    field: null,
    ...overrides,
  };
  // A caller that only specifies `size` (every existing factory call) still
  // gets a square-shaped width/height matching it, without every call site
  // needing to know about the new fields.
  if (overrides.size != null && overrides.width == null && overrides.height == null) {
    merged.width = overrides.size;
    merged.height = overrides.size;
  }
  return merged;
}

export function createBouncer({ x = 0, y = 0, shape = 'circle', size = 80, withSound = false } = {}) {
  return createObject({
    preset: 'bouncer',
    shape,
    x,
    y,
    size,
    physics: { collides: true, live: true, isStatic: true },
    sound: withSound ? createSoundModule() : null,
  });
}

export function createTrigger({ x = 0, y = 0, shape = 'square', size = 80 } = {}) {
  return createObject({
    preset: 'trigger',
    shape,
    x,
    y,
    size,
    physics: { collides: false, live: true, isStatic: true },
    sound: createSoundModule(),
  });
}

export function createSpawner({ x = 0, y = 0, shape = 'asterisk', size = 80 } = {}) {
  return createObject({
    preset: 'spawner',
    shape,
    x,
    y,
    size,
    // For a spawner, `collides` means "does this spawner have a body at
    // all" — on (default) preserves the existing sound-on-spawn behavior
    // (a fresh particle overlaps its spawner's own body); off gives it no
    // body, so particles can only sound once they hit something else.
    physics: { collides: true, live: true, isStatic: true },
    sound: null,
    spawn: createSpawnModule(),
  });
}

/**
 * Plinko peg field (prototype.md §4) — one HeidrunObject, many derived peg
 * bodies (physics/sync.js expands it). `shape: 'square'` deliberately reuses
 * the existing rect-shape move/resize/hit-test math as-is (x/y stay the
 * *center* of the field, same convention as every other object, half-extents
 * from width/height) — a peg field is just a box whose interior auto-fills
 * with pegs on a hex grid, so it gets that behavior for free instead of a
 * parallel implementation. No `sound` module yet — field-level pitch
 * behavior/gate is a deliberately separate follow-up (handoff.md).
 */
export function createPegField({ x = 0, y = 0, width = 240, height = 240, spacing = 80, pegRadius = 10 } = {}) {
  return createObject({
    preset: 'pegfield',
    shape: 'square',
    x,
    y,
    width,
    height,
    size: Math.max(width, height),
    physics: { collides: true, live: true, isStatic: true },
    sound: null,
    field: createFieldModule({ spacing, pegRadius }),
  });
}

/**
 * Spawner → particle: a normal dynamic object stamped with the spawner's
 * configured sound module. Each particle gets its own cloned sound module
 * with a live, independently-accumulating gate/accent — a particle can
 * bounce through several bouncers/triggers before leaving the canvas, so it
 * genuinely experiences a stream of hits over its lifetime just like any
 * other object; there's nothing about being spawned that should special-case
 * how its gate counts. `particlesHaveSound: false` gives pure exciters
 * instead (sound: null) — same on/off shape as a bouncer's Sound toggle.
 */
export function createParticle(spawnerObject) {
  const spawn = spawnerObject.spawn;
  return createObject({
    id: generateId('particle'),
    preset: 'particle',
    shape: spawn.emitShape === 'random' ? randomShape() : spawn.emitShape,
    x: spawnerObject.x,
    y: spawnerObject.y,
    size: spawn.emitSize,
    physics: { collides: true, live: true, isStatic: false },
    sound: spawn.particlesHaveSound ? cloneSoundModule(spawn.particleSound) : null,
  });
}

/** Alt-drag duplication (prototype.md-adjacent UI feedback) — same shape, fresh id, dropped in place. */
export function duplicateObject(obj) {
  const clone = JSON.parse(JSON.stringify(obj));
  clone.id = generateId(obj.preset);
  return clone;
}

export function cloneSoundModule(sound) {
  if (!sound) return null;
  return JSON.parse(JSON.stringify(sound));
}
