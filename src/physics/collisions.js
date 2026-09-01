// Matter collision events → hit events. A hit is dispatched once per object in
// the pair (each treated in turn as "the one that got hit"), so a bouncer with
// a sound module and the particle that struck it can each react independently.
// The handler also gets the specific body that was struck (not just its
// object id) — for most objects that's redundant (one body per object), but a
// peg field's many pegs all share one id, and this is how main.js reads the
// specific peg's own `position` for up/down/left/right pitch behavior.
//
// Guards against a resting/settled pair re-firing 'collisionStart' repeatedly
// (Matter can occasionally re-flag still-touching bodies as a "new" pair
// across steps) — without this, a particle that comes to rest on a bouncer
// could spam its hit-gate with dozens of rapid-fire reads instead of the one
// genuine hit, which skews low-density gates (e.g. prime near index 0) one
// way and high-density ones the other.
import { engine } from './world.js';

const { Events } = window.Matter;

let handler = null;
export function onHit(fn) {
  handler = fn;
}

const activePairs = new Set();

Events.on(engine, 'collisionStart', (event) => {
  if (!handler) return;
  for (const pair of event.pairs) {
    if (activePairs.has(pair.id)) continue;
    activePairs.add(pair.id);
    const idA = pair.bodyA.heidrunId;
    const idB = pair.bodyB.heidrunId;
    if (!idA || !idB) continue;
    handler(idA, idB, pair.bodyA);
    handler(idB, idA, pair.bodyB);
  }
});

Events.on(engine, 'collisionEnd', (event) => {
  for (const pair of event.pairs) activePairs.delete(pair.id);
});
