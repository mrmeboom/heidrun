// Pan/zoom view state — a screen-space viewport into a fixed, generous world
// rect that objects live in. Deliberately NOT part of canvasState: this is pure view state, not
// canvas data — it isn't serialized, isn't undo-tracked, and changes on
// every wheel tick or pan-drag frame, which would be wasteful to route
// through notify() (physics reconcile, piano requantize, etc. all listen
// there and have nothing to do with where the camera happens to be pointed).
//
// World is fixed and finite, not infinite — an unbounded canvas paired with
// an unbounded peg field lets someone build a patch that quietly grinds the
// browser to a halt. The live-body/voice-count target (and
// the object cap in the physics card) is the real backstop against that;
// this just keeps the world (and therefore off-canvas particle despawn,
// main.js's cleanupOffCanvas) a well-defined, generous rectangle rather than
// literally endless. Tune freely — nothing else assumes this exact size.
export const WORLD = { minX: -2000, minY: -2000, maxX: 4000, maxY: 3000 };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

// camera.x/y = world coordinates visible at the viewport's top-left corner.
// zoom 1 + camera at (0,0) reproduces the exact screen==world mapping every
// object's x/y already assumed before pan/zoom existed, so nothing already
// on a saved project moves or looks different until someone actually pans.
let camera = { x: 0, y: 0, zoom: 1 };

export function getCamera() {
  return camera;
}

export function screenToWorld(sx, sy) {
  return { x: camera.x + sx / camera.zoom, y: camera.y + sy / camera.zoom };
}

export function worldToScreen(wx, wy) {
  return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom };
}

/** Shifts the camera so on-screen content moves by (dxScreen, dyScreen) — the "grab and drag the canvas" feel. */
export function panBy(dxScreen, dyScreen) {
  camera = { ...camera, x: camera.x - dxScreen / camera.zoom, y: camera.y - dyScreen / camera.zoom };
}

/** Zooms by `factor`, keeping the world point under (sx, sy) fixed on screen — standard "zoom at cursor" feel. */
export function zoomAt(sx, sy, factor) {
  const before = screenToWorld(sx, sy);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  camera = { ...camera, zoom };
  const after = screenToWorld(sx, sy);
  camera = { ...camera, x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y) };
}
