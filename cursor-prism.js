// Invisible Voronoi regions only divide pointer input into separate strokes.
// This module never offsets points, clips the rendered trail, or draws a layer.
const SEED_LAYOUT = Object.freeze([
  [.19, .19], [.72, .15], [.46, .48],
  [.14, .84], [.81, .79],
].map(Object.freeze));
export const CURSOR_REGION_COUNT = SEED_LAYOUT.length;
const PARAM_EPSILON = 1e-10;

export function createCursorPrism(canvas, context) {
  let width = 1, height = 1, dprX = 1, dprY = 1, destroyed = false;
  let seeds = Object.freeze([]), regions = Object.freeze([]);
  let traceCount = 0, crossingCount = 0, lastRenderTime = 0;

  function clear() { traceCount = crossingCount = 0; }

  function resize(w, h) {
    if (destroyed) return;
    width = Number.isFinite(w) ? Math.max(1, w) : 1;
    height = Number.isFinite(h) ? Math.max(1, h) : 1;
    dprX = (canvas?.width || width) / width;
    dprY = (canvas?.height || height) / height;
    seeds = Object.freeze(SEED_LAYOUT.map(([x, y], id) =>
      Object.freeze({ id, x: x * width, y: y * height })));
    regions = Object.freeze(seeds.map(seed => Object.freeze({ id: seed.id, seed })));
    clear();
  }

  function regionAt(x, y) {
    if (destroyed || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    let region = null, best = Infinity;
    for (const seed of seeds) {
      const distance = (x - seed.x) ** 2 + (y - seed.y) ** 2;
      // The lower ID wins an exact tie, independent of previous input history.
      if (distance < best) { best = distance; region = seed.id; }
    }
    return region;
  }

  // Clip input, not already-painted history, to a cell inset by CSS pixels.
  // Signed distances to normalized bisectors make the band independent of
  // pointer speed, crossing angle and device-pixel ratio.
  function insetSegment(a, b, region, inset = 0) {
    const seed = seeds[region];
    if (destroyed || !seed || !a || !b ||
      ![a.x, a.y, b.x, b.y, inset].every(Number.isFinite)) return null;
    inset = Math.max(0, inset);
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    for (const other of seeds) {
      if (other === seed) continue;
      const sx = other.x - seed.x, sy = other.y - seed.y;
      const length = Math.hypot(sx, sy);
      const nx = sx / length, ny = sy / length;
      const distance = ((seed.x + other.x) / 2 - a.x) * nx
        + ((seed.y + other.y) / 2 - a.y) * ny;
      const slope = -(dx * nx + dy * ny);
      if (Math.abs(slope) < 1e-10) {
        if (distance < inset - 1e-9) return null;
        continue;
      }
      const t = (inset - distance) / slope;
      if (slope > 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1 + 1e-10) return null;
    }
    if (t1 < 0 || t0 > 1) return null;
    t0 = Math.max(0, t0); t1 = Math.min(1, t1);
    return { t0, t1, region,
      from: { x: a.x + dx * t0, y: a.y + dy * t0 },
      to: { x: a.x + dx * t1, y: a.y + dy * t1 } };
  }

  // Each squared-distance difference is linear along a straight input segment.
  // Testing the intervals between all pairwise bisectors finds every genuine
  // nearest-seed change, including a fast event crossing several entire cells.
  function crossings(a, b, previousRegion) {
    if (destroyed || !seeds.length || !a || !b ||
      ![a.x, a.y, b.x, b.y].every(Number.isFinite)) return [];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 1e-9) return [];
    traceCount++;
    const cuts = [0, 1];
    for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) {
      const p = seeds[i], q = seeds[j];
      const slope = 2 * (dx * (q.x - p.x) + dy * (q.y - p.y));
      if (Math.abs(slope) < 1e-12) continue;
      const start = 2 * (a.x * (q.x - p.x) + a.y * (q.y - p.y))
        + p.x * p.x + p.y * p.y - q.x * q.x - q.y * q.y;
      const t = -start / slope;
      if (t > PARAM_EPSILON && t < 1 - PARAM_EPSILON) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    const unique = cuts.filter((t, index) => !index || t - cuts[index - 1] > PARAM_EPSILON);
    const changes = [];
    let owner = null;
    for (let index = 1; index < unique.length; index++) {
      const start = unique[index - 1], mid = (start + unique[index]) / 2;
      const nextOwner = regionAt(a.x + dx * mid, a.y + dy * mid);
      if (index === 1) {
        // When a previous sample stopped exactly on a boundary, its incoming
        // owner can be supplied. Departing into the other cell then emits t=0
        // once; merely touching the boundary and returning emits nothing.
        const previous = seeds[previousRegion];
        if (previous && previousRegion !== nextOwner) {
          const nearest = seeds[regionAt(a.x, a.y)];
          const previousDistance = (a.x - previous.x) ** 2 + (a.y - previous.y) ** 2;
          const nearestDistance = (a.x - nearest.x) ** 2 + (a.y - nearest.y) ** 2;
          const tolerance = Math.max(1, width * width + height * height) * 1e-10;
          if (Math.abs(previousDistance - nearestDistance) <= tolerance)
            changes.push({ t: 0, x: a.x, y: a.y, fromRegion: previousRegion, toRegion: nextOwner });
        }
      } else if (nextOwner !== owner) {
        changes.push({ t: start, x: a.x + dx * start, y: a.y + dy * start,
          fromRegion: owner, toRegion: nextOwner });
      }
      owner = nextOwner;
    }
    crossingCount += changes.length;
    return changes;
  }

  // Compatibility helpers leave existing renderer coordinates exactly intact.
  function point(x, y) { return { x, y, weight: 0, region: regionAt(x, y) }; }
  function segment(a, b) {
    if (!a || !b || (a.x === b.x && a.y === b.y)) return [];
    return [{ from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y },
      t0: 0, t1: 1, region: null, dispersion: 0 }];
  }
  function beginFrame(now) { lastRenderTime = Number(now) || 0; }
  function render(now) { lastRenderTime = Number(now) || lastRenderTime; }
  function getMetadata() {
    return Object.freeze({ supported: Boolean(context), active: false, destroyed,
      type: 'voronoi', metric: 'euclidean-css-pixels', regionCount: seeds.length,
      width, height, dprX, dprY, seeds, regions,
      boundaryTreatment: 'input-stroke-break', overlapPolicy: 'nearest-seed',
      renderPath: 'input-geometry-only', visibleOverlay: false,
      offset: 0, shear: 0, dispersionAlpha: 0, frameCopies: 0, totalFrameCopies: 0,
      renderedRegions: 0, buffers: Object.freeze({ fullFrame: 0, local: 0 }),
      traceCount, crossingCount, lastRenderTime });
  }
  function destroy() { clear(); destroyed = true; seeds = regions = Object.freeze([]); }

  return Object.freeze({ regionAt, insetSegment, crossings, trace: crossings, point, segment,
    beginFrame, render, resize, clear, destroy, getMetadata,
    get metadata() { return getMetadata(); } });
}
