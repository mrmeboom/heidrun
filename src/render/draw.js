// Per-frame canvas 2D draw — reads state (+ live physics positions already
// written back into it) and paints; never mutates state (architecture.md §3).
import { listObjects, getPalette, getMode } from '../state/canvasState.js';
import { colorForObject } from './palette.js';
import { getCamera, WORLD } from './camera.js';

const RECT_SHAPES = new Set(['square', 'rectangle']);
function isRectShape(obj) {
  return RECT_SHAPES.has(obj.shape);
}
/** Axis-aligned half-width/height, ignoring rotation — same simplification
 * hitTestBody and the resize handle already make for rect shapes (handoff.md
 * §5's "known, accepted wrinkle"), reused by interaction.js's marquee-select
 * so a rotated object's selection box matches what you'd already expect from
 * clicking/dragging its handles. */
export function halfExtents(obj) {
  return isRectShape(obj) ? { hw: obj.width / 2, hh: obj.height / 2 } : { hw: obj.size / 2, hh: obj.size / 2 };
}

/** World-space hit areas for the on-canvas handles — shared by draw.js and interaction.js. */
export function getHandlePositions(obj) {
  const { hw, hh } = halfExtents(obj);
  const r = Math.max(hw, hh) + 8;
  // For rect shapes the resize handle sits exactly at the corner (rather than
  // a fixed 45° ring position) so one drag can set width and height
  // independently, in a single gesture — no separate width/height handles.
  const resizePos = isRectShape(obj)
    ? { x: obj.x + hw + 8, y: obj.y + hh + 8 }
    : { x: obj.x + r * Math.cos(Math.PI / 4), y: obj.y + r * Math.sin(Math.PI / 4) };
  return {
    ring: r,
    resize: { ...resizePos, r: 7 },
    rotate: { x: obj.x, y: obj.y - r - 14, r: 7 },
    popover: { x: obj.x + r * Math.cos(-Math.PI / 4), y: obj.y + r * Math.sin(-Math.PI / 4), r: 9 },
  };
}

export function hitTestBody(obj, x, y) {
  if (isRectShape(obj)) {
    const { hw, hh } = halfExtents(obj);
    return Math.abs(x - obj.x) <= hw + 4 && Math.abs(y - obj.y) <= hh + 4;
  }
  const r = obj.size / 2 + 4;
  return Math.hypot(x - obj.x, y - obj.y) <= r;
}

export function draw(ctx, size, { selectedIds = null, marqueeRect = null } = {}) {
  const palette = getPalette();
  const mode = getMode();
  const camera = getCamera();

  // Background clear/fill happens in plain screen space (before the camera
  // transform) so it always covers the full viewport regardless of pan/zoom;
  // everything else below draws in world coordinates, same as before pan/
  // zoom existed — the camera transform is the only thing that changed.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, size.w, size.h);

  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  if (mode === 'build') drawWorldEdge(ctx);

  for (const obj of listObjects()) {
    drawObject(ctx, obj);
  }
  if (mode === 'build') {
    for (const obj of listObjects()) {
      drawChrome(ctx, obj, !!selectedIds?.has(obj.id));
    }
    if (marqueeRect) drawMarquee(ctx, marqueeRect);
  }
  ctx.restore();
}

/** Faint outline of the fixed world rect (build mode only) — a visual cue for
 * where despawn/panning limits actually are, since they're no longer "the
 * edge of the screen" now that the world can extend past the viewport. */
function drawWorldEdge(ctx) {
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(60,50,40,0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(WORLD.minX, WORLD.minY, WORLD.maxX - WORLD.minX, WORLD.maxY - WORLD.minY);
  ctx.restore();
}

/** Drag-select rectangle (interaction.js) — a plain dashed selection box, same
 * visual language as the per-object chrome. */
function drawMarquee(ctx, rect) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(60,50,40,0.6)';
  ctx.fillStyle = 'rgba(60,50,40,0.08)';
  ctx.lineWidth = 1;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawObject(ctx, obj) {
  if (obj.preset === 'pegfield') {
    drawPegField(ctx, obj);
    return;
  }
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.rotation);
  ctx.globalAlpha = obj.physics.live ? 1 : 0.35;
  ctx.fillStyle = colorForObject(obj);
  ctx.strokeStyle = 'rgba(50,40,30,0.25)';
  ctx.lineWidth = 1.5;
  if (obj.preset === 'trigger') ctx.setLineDash([4, 3]);

  const s = obj.size;
  switch (obj.shape) {
    case 'square':
    case 'rectangle':
      ctx.beginPath();
      ctx.rect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
      ctx.fill();
      ctx.stroke();
      break;
    case 'triangle': {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * ((2 * Math.PI) / 3);
        const px = (s / 2) * Math.cos(a);
        const py = (s / 2) * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'asterisk':
      drawAsterisk(ctx, s);
      break;
    case 'circle':
    default:
      ctx.beginPath();
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
  }
  ctx.restore();
}

/**
 * Same spacing/hex-grid math as physics/sync.js's makePegBodies — kept as a
 * separate read here rather than sharing a function, since one reads from
 * live Matter body positions post-physics and the other just needs the same
 * derivation for a paint pass; duplicating the (cheap, pure) math is simpler
 * than plumbing body positions through the render module.
 */
function drawPegField(ctx, obj) {
  ctx.save();
  // Same translate+rotate transform every other shape uses — draw everything
  // in local coordinates (origin at the field's own center) and let the
  // canvas transform place/rotate it, instead of computing world coordinates
  // by hand (physics/sync.js's makePegBodies does that by hand since Matter
  // needs real world coordinates up front; the canvas doesn't).
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.rotation);
  ctx.globalAlpha = obj.physics.live ? 1 : 0.35;
  ctx.strokeStyle = 'rgba(50,40,30,0.18)';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
  ctx.setLineDash([]);
  ctx.fillStyle = colorForObject(obj);
  const { spacing, pegRadius } = obj.field;
  const rowH = (spacing * Math.sqrt(3)) / 2;
  const left = -obj.width / 2;
  const right = obj.width / 2;
  const top = -obj.height / 2;
  const bottom = obj.height / 2;
  let row = 0;
  for (let y = top; y <= bottom; y += rowH) {
    const offset = row % 2 === 0 ? 0 : spacing / 2;
    for (let x = left + offset; x <= right; x += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, pegRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    row += 1;
  }
  ctx.restore();
}

function drawAsterisk(ctx, size) {
  const r = size / 2;
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI / 3);
    ctx.moveTo(-r * Math.cos(a), -r * Math.sin(a));
    ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  ctx.stroke();
}

function drawChrome(ctx, obj, hot) {
  const palette = getPalette();
  const highlight = palette.pastels[0];
  const { ring, resize, rotate, popover } = getHandlePositions(obj);

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = hot ? highlight : 'rgba(60,50,40,0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(obj.x, obj.y, ring, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(60,50,40,0.3)';
  ctx.beginPath();
  ctx.moveTo(obj.x, obj.y - ring);
  ctx.lineTo(rotate.x, rotate.y);
  ctx.stroke();
  drawHandleDot(ctx, rotate, hot, highlight);

  if (isRectShape(obj)) drawHandleSquare(ctx, resize, hot, highlight);
  else drawHandleDot(ctx, resize, hot, highlight);
  drawPopoverBadge(ctx, popover);
  ctx.restore();
}

function drawHandleDot(ctx, pos, hot, highlight) {
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, pos.r, 0, Math.PI * 2);
  ctx.fillStyle = hot ? highlight : '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.5)';
  ctx.stroke();
}

/** Square resize handle for rect shapes, visually distinct from the round rotate dot. */
function drawHandleSquare(ctx, pos, hot, highlight) {
  ctx.beginPath();
  ctx.rect(pos.x - pos.r, pos.y - pos.r, pos.r * 2, pos.r * 2);
  ctx.fillStyle = hot ? highlight : '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.5)';
  ctx.stroke();
}

function drawPopoverBadge(ctx, pos) {
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, pos.r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.5)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(60,50,40,0.85)';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('+', pos.x, pos.y + 0.5);
}
