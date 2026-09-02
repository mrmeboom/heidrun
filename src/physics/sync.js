// State Object ⇄ Matter body — architecture.md §10. Bodies are always derived
// from state and safe to throw away/rebuild (same pattern input.html already
// uses for rebuildPegs()/rebuildWalls()), never the other way around, except
// for dynamic (particle) bodies where physics owns position each frame and we
// write that back into state (§10 of architecture.md).
import { world } from './world.js';
import { listObjects, subscribe, getPhysicsSettings } from '../state/canvasState.js';

const { Bodies, Body, World } = window.Matter;

const RECT_SHAPES = new Set(['square', 'rectangle']);

/** @type {Map<string, { body: any, shape: string, size: number, width: number, height: number, isStatic: boolean, collides: boolean }>} */
const entries = new Map();

function makeBody(obj) {
  const settings = getPhysicsSettings();
  const opts = {
    isStatic: obj.physics.isStatic,
    // Spawners are never physically solid — when they do have a body at all
    // (see rebuild()'s early-return below), it's always a sensor. Their own
    // `collides` toggle controls something different: whether that body
    // exists at all, i.e. whether freshly-spawned particles can overlap and
    // "hit" their own spawner the instant they're born.
    isSensor: obj.preset === 'spawner' ? true : !obj.physics.collides,
    restitution: settings.restitution,
    friction: settings.friction,
    frictionAir: settings.airFriction,
  };
  const half = obj.size / 2;
  let body;
  switch (obj.shape) {
    case 'rectangle':
    case 'square':
      // Width/height drag independently now (feedback: no separate rectangle
      // preset needed) — square just starts life with width === height.
      body = Bodies.rectangle(obj.x, obj.y, obj.width, obj.height, opts);
      break;
    case 'triangle':
      body = Bodies.polygon(obj.x, obj.y, 3, half, opts);
      break;
    case 'asterisk':
      // Visual is an asterisk sprite; physics body is a smaller circle — shapes
      // are deliberately decoupled for performance (architecture.md §11).
      body = Bodies.circle(obj.x, obj.y, half * 0.55, opts);
      break;
    case 'circle':
    default:
      body = Bodies.circle(obj.x, obj.y, half, opts);
  }
  body.heidrunId = obj.id;
  return body;
}

function rebuild(obj) {
  const existing = entries.get(obj.id);
  if (existing) {
    World.remove(world, existing.body);
    entries.delete(obj.id);
  }
  if (!obj.physics.live) return;
  if (obj.preset === 'spawner' && !obj.physics.collides) return; // no body at all — nothing to overlap at spawn
  const body = makeBody(obj);
  entries.set(obj.id, {
    body,
    shape: obj.shape,
    size: obj.size,
    width: obj.width,
    height: obj.height,
    isStatic: obj.physics.isStatic,
    collides: obj.physics.collides,
  });
  World.add(world, body);
}

function needsRebuild(entry, obj) {
  const sizeChanged = RECT_SHAPES.has(obj.shape)
    ? entry.width !== obj.width || entry.height !== obj.height
    : entry.size !== obj.size;
  return (
    entry.shape !== obj.shape ||
    sizeChanged ||
    entry.isStatic !== obj.physics.isStatic ||
    entry.collides !== obj.physics.collides
  );
}

/**
 * Peg field: one object, many peg bodies (a "cluster object").
 * Pegs sit on a hex grid inside the object's own width/height box (x/y is the
 * box's center, same convention as every other object) — same
 * spacing/√3-row-height math as input.html's rebuildPegs(), just centered
 * instead of anchored at a top-left corner. All pegs share the field's own
 * heidrunId so collisions.js routes every peg hit back to the one object
 * without any changes there.
 */
function makePegBodies(obj) {
  const settings = getPhysicsSettings();
  const { spacing, pegRadius } = obj.field;
  const rowH = (spacing * Math.sqrt(3)) / 2;
  // Grid laid out in the field's own *local* space (origin at its center,
  // unrotated), then each point is rotated by obj.rotation and translated to
  // obj.x/y for its actual world position — same idea as the canvas 2D
  // translate+rotate render.js already uses for every other shape, just done
  // by hand here since Matter needs real world coordinates up front rather
  // than a transform stack.
  const cos = Math.cos(obj.rotation);
  const sin = Math.sin(obj.rotation);
  const left = -obj.width / 2;
  const right = obj.width / 2;
  const top = -obj.height / 2;
  const bottom = obj.height / 2;
  const bodies = [];
  let row = 0;
  for (let ly = top; ly <= bottom; ly += rowH) {
    const offset = row % 2 === 0 ? 0 : spacing / 2;
    for (let lx = left + offset; lx <= right; lx += spacing) {
      const x = obj.x + lx * cos - ly * sin;
      const y = obj.y + lx * sin + ly * cos;
      const peg = Bodies.circle(x, y, pegRadius, {
        isStatic: true,
        restitution: settings.restitution,
        friction: settings.friction,
        frictionAir: settings.airFriction,
      });
      // No index/rank tagging needed — main.js derives a peg's up/down/
      // left/right pitch position straight from its own live body.position,
      // normalized against the field's current bounds (an absolute rank
      // exhausts a small pitch range within the first few rows of any
      // reasonably wide field; a normalized position doesn't).
      peg.heidrunId = obj.id;
      bodies.push(peg);
    }
    row += 1;
  }
  return bodies;
}

function rebuildField(obj) {
  const existing = entries.get(obj.id);
  if (existing) {
    World.remove(world, existing.bodies);
    entries.delete(obj.id);
  }
  if (!obj.physics.live) return;
  const bodies = makePegBodies(obj);
  entries.set(obj.id, {
    bodies,
    spacing: obj.field.spacing,
    pegRadius: obj.field.pegRadius,
    width: obj.width,
    height: obj.height,
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    isStatic: true,
  });
  World.add(world, bodies);
}

function fieldNeedsRebuild(entry, obj) {
  return entry.spacing !== obj.field.spacing || entry.pegRadius !== obj.field.pegRadius || entry.width !== obj.width || entry.height !== obj.height;
}

export function reconcile() {
  const seen = new Set();
  for (const obj of listObjects()) {
    seen.add(obj.id);
    const entry = entries.get(obj.id);

    if (obj.preset === 'pegfield') {
      if (!entry) {
        if (obj.physics.live) rebuildField(obj);
        continue;
      }
      if (!obj.physics.live || fieldNeedsRebuild(entry, obj)) {
        rebuildField(obj);
        continue;
      }
      // Move/rotate only (no spacing/size change): transform every peg in
      // place instead of tearing down and re-deriving the whole grid — same
      // idea as the single-body static-object path below, just applied to a
      // whole array of bodies. Order (translate then rotate-around-the-new-
      // center) only matters if both change in the same tick, which a single
      // drag gesture never does (move and rotate are separate drag types),
      // but stays correct either way for e.g. undo/redo restoring both at once.
      if (entry.x !== obj.x || entry.y !== obj.y) {
        const dx = obj.x - entry.x;
        const dy = obj.y - entry.y;
        for (const body of entry.bodies) Body.translate(body, { x: dx, y: dy });
        entry.x = obj.x;
        entry.y = obj.y;
      }
      if (entry.rotation !== obj.rotation) {
        const dAngle = obj.rotation - entry.rotation;
        for (const body of entry.bodies) Body.rotate(body, dAngle, { x: obj.x, y: obj.y });
        entry.rotation = obj.rotation;
      }
      continue;
    }

    if (!entry) {
      if (obj.physics.live) rebuild(obj);
      continue;
    }
    if (!obj.physics.live || needsRebuild(entry, obj)) {
      rebuild(obj);
      continue;
    }
    // Static objects: state (drag/popover edits) drives the body's transform.
    if (obj.physics.isStatic) {
      if (entry.body.position.x !== obj.x || entry.body.position.y !== obj.y) {
        Body.setPosition(entry.body, { x: obj.x, y: obj.y });
      }
      if (entry.body.angle !== obj.rotation) Body.setAngle(entry.body, obj.rotation);
    }
  }
  for (const id of [...entries.keys()]) {
    if (!seen.has(id)) {
      const entry = entries.get(id);
      World.remove(world, entry.bodies ?? entry.body);
      entries.delete(id);
    }
  }
}

/** Dynamic (particle) bodies: physics owns position — call once per frame to write it back into state. */
export function writeBackDynamicPositions(updateFn) {
  for (const [id, entry] of entries) {
    if (entry.isStatic) continue;
    updateFn(id, { x: entry.body.position.x, y: entry.body.position.y, rotation: entry.body.angle });
  }
}

export function getBody(id) {
  const entry = entries.get(id);
  return entry?.body ?? entry?.bodies?.[0] ?? null;
}

/** Total live Matter bodies across every entry — a peg field counts every
 * individual peg, not once per field, since peg count is exactly what makes
 * a dense field expensive (physics stepping cost). Backs
 * both the toolbar's live counter and the physics card's object cap. */
export function getLiveBodyCount() {
  let count = 0;
  for (const entry of entries.values()) count += entry.bodies ? entry.bodies.length : 1;
  return count;
}

subscribe(reconcile);
