// Pointer events → drag/resize/rotate/place → state mutations. This is the
// only place UI code is allowed to touch object transforms directly, and it
// always goes through canvasState's own setters (architecture.md §10).
import { listObjects, addObject, updateObject, getObject, getObjectDefaults } from '../state/canvasState.js';
import { createBouncer, createTrigger, createSpawner, createPegField, duplicateObject } from '../state/object.js';
import { getHandlePositions, hitTestBody, halfExtents } from '../render/draw.js';
import { togglePopover, closePopover, isOpen, getOpenId, refreshPopoverPosition } from './objectPopover.js';
import { screenToWorld, worldToScreen, panBy, zoomAt } from '../render/camera.js';
import * as history from '../state/history.js';
import { resumeAudio } from '../audio/context.js';

let canvas = null;
let placementTool = null; // 'bouncer' | 'trigger' | 'spawner' | 'pegfield' | null
let selectedIds = new Set();
let drag = null;
let spaceHeld = false;

// Below this many pixels of pointer travel, a marquee drag is treated as a
// plain click (clears/leaves selection alone) instead of a select-nothing box.
const MARQUEE_CLICK_THRESHOLD = 4;

/** Collapses selection to a single object (or clears it) — used by main.js's
 * undo/redo hotkeys and Backspace/Delete, which just want "select only this"
 * or "clear whatever's selected". */
export function setSelectedId(id) {
  selectedIds = id ? new Set([id]) : new Set();
}
/** Full multi-selection — used for the marquee highlight and mass delete. */
export function getSelectedIds() {
  return [...selectedIds];
}
/** The live marquee rect while a drag-select is in progress, or null — read
 * by main.js's draw() call each frame to paint the selection box. */
export function getMarqueeRect() {
  if (!drag || drag.type !== 'marquee') return null;
  return normalizeRect(drag.startX, drag.startY, drag.curX, drag.curY);
}
export function setPlacementTool(tool) {
  placementTool = tool;
}
export function getPlacementTool() {
  return placementTool;
}

function normalizeRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** Axis-aligned overlap test between the marquee rect and an object's own
 * (also axis-aligned, rotation-ignoring — see draw.js's halfExtents) bounds. */
function rectIntersectsObject(rect, obj) {
  const { hw, hh } = halfExtents(obj);
  return obj.x + hw >= rect.x && obj.x - hw <= rect.x + rect.w && obj.y + hh >= rect.y && obj.y - hh <= rect.y + rect.h;
}

function toCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}

/** Keeps an open popover glued to its object's *screen* position whenever the
 * camera pans/zooms — otherwise it stays put in screen space while the
 * object it belongs to visibly slides out from under it. */
function refreshPopoverForCamera() {
  const id = getOpenId();
  if (!id) return;
  const o = getObject(id);
  if (!o) return;
  refreshPopoverPosition(worldToScreen(o.x, o.y));
}

function findHandleHit(x, y) {
  const objs = listObjects();
  for (let i = objs.length - 1; i >= 0; i--) {
    const obj = objs[i];
    const h = getHandlePositions(obj);
    if (Math.hypot(x - h.popover.x, y - h.popover.y) <= h.popover.r + 4) return { type: 'popover', obj };
    if (Math.hypot(x - h.resize.x, y - h.resize.y) <= h.resize.r + 4) return { type: 'resize', obj };
    if (Math.hypot(x - h.rotate.x, y - h.rotate.y) <= h.rotate.r + 4) return { type: 'rotate', obj };
  }
  return null;
}

function findBodyHit(x, y) {
  const objs = listObjects();
  for (let i = objs.length - 1; i >= 0; i--) {
    if (hitTestBody(objs[i], x, y)) return objs[i];
  }
  return null;
}

export function initInteraction(canvasEl) {
  canvas = canvasEl;

  canvas.addEventListener('pointerdown', (e) => {
    resumeAudio();

    // Middle-click or space-held drag pans the camera — checked before any
    // placement/handle/body/marquee logic so it works no matter what's under
    // the pointer (a common canvas-app convention, e.g. Figma's spacebar pan).
    if (e.button === 1 || spaceHeld) {
      drag = { type: 'pan', lastX: e.clientX, lastY: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    const p = toCanvasPoint(e);

    if (placementTool) {
      const factory = { bouncer: createBouncer, trigger: createTrigger, spawner: createSpawner, pegfield: createPegField }[placementTool];
      addObject(factory({ x: p.x, y: p.y, ...getObjectDefaults(placementTool) }));
      history.commit();
      placementTool = null;
      return;
    }

    const handleHit = findHandleHit(p.x, p.y);
    if (handleHit) {
      // Grabbing a handle always operates on that one object — collapses any
      // existing multi-selection, same as clicking a fresh object would.
      selectedIds = new Set([handleHit.obj.id]);
      if (handleHit.type === 'popover') {
        togglePopover(handleHit.obj.id, worldToScreen(handleHit.obj.x, handleHit.obj.y));
        return;
      }
      drag = { type: handleHit.type, id: handleHit.obj.id, startX: p.x, startY: p.y, startObjX: handleHit.obj.x, startObjY: handleHit.obj.y };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const bodyHit = findBodyHit(p.x, p.y);
    if (bodyHit) {
      // Alt-drag: duplicate in place, then drag the copy — the original stays
      // put. Always single-object, even mid-multi-select (duplicating a whole
      // selection isn't what alt-drag is for here).
      if (e.altKey) {
        const target = addObject(duplicateObject(bodyHit));
        selectedIds = new Set([target.id]);
        drag = { type: 'move', ids: [target.id], starts: [{ id: target.id, x: target.x, y: target.y }], startX: p.x, startY: p.y };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // Shift-click toggles one object in/out of the selection. A plain
      // click on an object already inside a multi-selection keeps the whole
      // selection intact (so you can drag the group by any member); a plain
      // click on an object outside it replaces the selection with just that one.
      if (e.shiftKey) {
        const next = new Set(selectedIds);
        if (next.has(bodyHit.id)) next.delete(bodyHit.id);
        else next.add(bodyHit.id);
        selectedIds = next;
      } else if (!selectedIds.has(bodyHit.id)) {
        selectedIds = new Set([bodyHit.id]);
      }

      if (selectedIds.has(bodyHit.id)) {
        const ids = [...selectedIds];
        drag = {
          type: 'move',
          ids,
          starts: ids.map((id) => {
            const o = getObject(id);
            return { id, x: o.x, y: o.y };
          }),
          startX: p.x,
          startY: p.y,
        };
      }
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Empty canvas: start a marquee drag. Whether it ends up clearing,
    // replacing, or adding to the selection is decided on pointerup/pointermove
    // — a plain click here (no real movement) shouldn't wipe a shift-held
    // selection just because it landed on empty space.
    drag = { type: 'marquee', startX: p.x, startY: p.y, curX: p.x, curY: p.y, additive: e.shiftKey, baseSelection: new Set(selectedIds) };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;

    if (drag.type === 'pan') {
      panBy(e.clientX - drag.lastX, e.clientY - drag.lastY);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      refreshPopoverForCamera();
      return;
    }

    const p = toCanvasPoint(e);

    if (drag.type === 'marquee') {
      drag.curX = p.x;
      drag.curY = p.y;
      const rect = normalizeRect(drag.startX, drag.startY, p.x, p.y);
      const hits = listObjects().filter((o) => rectIntersectsObject(rect, o)).map((o) => o.id);
      selectedIds = drag.additive ? new Set([...drag.baseSelection, ...hits]) : new Set(hits);
      return;
    }

    if (drag.type === 'move') {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      for (const s of drag.starts) updateObject(s.id, { x: s.x + dx, y: s.y + dy });
      if (drag.ids.length === 1 && isOpen(drag.ids[0])) {
        const o = getObject(drag.ids[0]);
        refreshPopoverPosition(worldToScreen(o.x, o.y));
      }
      return;
    }

    // resize/rotate always target the single object the handle belongs to.
    const obj = listObjects().find((o) => o.id === drag.id);
    if (!obj) return;
    const isRect = obj.shape === 'square' || obj.shape === 'rectangle';

    if (drag.type === 'resize' && isRect) {
      // One corner handle, width from horizontal offset and height from
      // vertical offset independently — no separate width/height handles.
      const width = Math.max(6, Math.round(Math.abs(p.x - obj.x) * 2 - 8));
      const height = Math.max(6, Math.round(Math.abs(p.y - obj.y) * 2 - 8));
      updateObject(obj.id, { width, height });
    } else if (drag.type === 'resize') {
      const dist = Math.hypot(p.x - obj.x, p.y - obj.y);
      const newSize = Math.max(6, Math.round(((dist - 8) * 2) / Math.SQRT2));
      updateObject(obj.id, { size: newSize });
    } else if (drag.type === 'rotate') {
      const angle = Math.atan2(p.y - obj.y, p.x - obj.x) + Math.PI / 2;
      updateObject(obj.id, { rotation: angle });
    }
    if (isOpen(obj.id)) refreshPopoverPosition(worldToScreen(obj.x, obj.y));
  });

  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.type === 'pan') {
      drag = null;
      canvas.style.cursor = spaceHeld ? 'grab' : '';
      return;
    }
    if (drag.type === 'marquee') {
      const dist = Math.hypot(drag.curX - drag.startX, drag.curY - drag.startY);
      if (dist < MARQUEE_CLICK_THRESHOLD) {
        // A click, not a drag — plain click clears selection, shift-click on
        // empty space is a no-op (selection was never touched by pointermove).
        selectedIds = drag.additive ? drag.baseSelection : new Set();
        if (!drag.additive) closePopover();
      }
      drag = null;
      return;
    }
    drag = null;
    history.commit();
  });

  // Trackpad two-finger scroll pans by default; ctrl/cmd+wheel (also how
  // browsers report a trackpad pinch gesture) zooms centered on the pointer
  // instead — same split as Figma/Miro, chosen so a plain scroll never
  // surprises a mouse-and-scrollwheel user by zooming instead of panning.
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01));
      } else {
        panBy(-e.deltaX, -e.deltaY);
      }
      refreshPopoverForCamera();
    },
    { passive: false },
  );

  // Spacebar-held pan (checked in pointerdown above) — guarded against text
  // inputs so holding space while typing in a popover/system-menu field
  // doesn't hijack the keystroke into a pan-hold.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || spaceHeld) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    spaceHeld = true;
    canvas.style.cursor = 'grab';
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    if (!drag || drag.type !== 'pan') canvas.style.cursor = '';
  });
}
