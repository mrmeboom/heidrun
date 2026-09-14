// Matter.js engine/world setup — Matter is loaded globally via CDN script tag
// in index.html, not an npm import, per the no-build-step decision in
// architecture.md §11.
//
// Stepped manually from main.js's own rAF loop (Engine.update) rather than
// Matter's own Runner — that's what gives the pause button a single, simple
// on/off switch instead of a second independent timing source to fight.
const { Engine } = window.Matter;

export const engine = Engine.create();
export const world = engine.world;

export function applyPhysicsSettings(settings) {
  engine.gravity.y = settings.gravity;
}

/** @param {number} deltaMs */
export function stepPhysics(deltaMs) {
  Engine.update(engine, deltaMs);
}
