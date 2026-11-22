/* Actual alpha compositing, not a colored overlay. A small looping procedural
   mask reveals the existing page background through cross-origin players. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const WIDTH = 192, HEIGHT = 108, FRAME_COUNT = 96, FPS = 8;
const frames = [], compactFrames = [], alphaFrames = [], compactAlphaFrames = [], instances = new Set();
const controlField = new Float32Array(WIDTH * HEIGHT);
const composedFrames = new Map(), MAX_COMPOSED_FRAMES = 384;
let controlImage;
let canvas, context, buildFailed = false, pendingBuild = false, suspended = false;
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
// Fixed noise lattice avoids per-frame random jitter and expensive pixel hashes.
const lattice = Float32Array.from({length:1024}, (_, i) => {
  let n = Math.imul(i ^ 0x7f4a7c15, 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
});
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy);
  const value = (a, b) => lattice[(a & 31) + (b & 31) * 32];
  const a = value(ix, iy) * (1 - fx) + value(ix + 1, iy) * fx;
  const b = value(ix, iy + 1) * (1 - fx) + value(ix + 1, iy + 1) * fx;
  return a * (1 - fy) + b * fy;
}
function makeFrame(index) {
  const image = context.createImageData(WIDTH, HEIGHT), pixels = image.data;
  const regular = new Uint8Array(WIDTH * HEIGHT), compact = new Uint8Array(WIDTH * HEIGHT);
  const phase = index / FRAME_COUNT * Math.PI * 2, tx = Math.cos(phase) * 1.3, ty = Math.sin(phase) * 1.3;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const u = x / (WIDTH - 1), v = y / (HEIGHT - 1), offset = (y * WIDTH + x) * 4;
    const i = y * WIDTH + x, dx = Math.min(u, 1 - u) * WIDTH / HEIGHT, dy = Math.min(v, 1 - v);
    const nx = u * 5.3 + tx, ny = v * 3.2 + ty;
    const cloud = Math.min(dx, dy) >= .315 ? .5 : noise(nx, ny) * .68 + noise(nx * 2.02 + 7.3, ny * 2.02 + 13.1) * .32;
    const wideFeather = .20 + cloud * .115, smallFeather = .14 + cloud * .075;
    // A broad, slowly varying alpha ramp dissolves every edge. A small fully
    // transparent rim also removes rasterized corner/outer-pixel outlines.
    regular[i] = Math.round(Math.pow(smooth(.012, wideFeather, dx) * smooth(.012, wideFeather, dy), 1.18) * 255);
    compact[i] = Math.round(Math.pow(smooth(.006, smallFeather, dx) * smooth(.006, smallFeather, dy), 1.12) * 255);
    if (index === 0) controlField[i] = smooth(0, .07, u) * smooth(0, .07, 1 - u) * smooth(.55, .85, v) * smooth(0, .10, 1 - v) * .62;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
    pixels[offset + 3] = regular[i];
  }
  context.putImageData(image, 0, 0);
  const regularUrl = `url("${canvas.toDataURL('image/png')}")`;
  for (let i = 0; i < compact.length; i++) pixels[i * 4 + 3] = compact[i];
  context.putImageData(image, 0, 0);
  compactFrames.push(`url("${canvas.toDataURL('image/png')}")`);
  alphaFrames.push(regular); compactAlphaFrames.push(compact); frames.push(regularUrl);
}
function composedTexture(index, compact, controls) {
  const step = Math.round(Math.max(0, Math.min(1, controls)) * 8);
  if (!step) return (compact ? compactFrames : frames)[index];
  const key = `${compact ? 1 : 0}:${index}:${step}`;
  if (composedFrames.has(key)) {
    const cached = composedFrames.get(key); composedFrames.delete(key); composedFrames.set(key, cached); return cached;
  }
  controls = step / 8;
  const source = (compact ? compactAlphaFrames : alphaFrames)[index];
  const image = controlImage || (controlImage = context.createImageData(WIDTH, HEIGHT)), pixels = image.data;
  for (let i = 0; i < source.length; i++) {
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = 255;
    // Readability assistance is blended into the same mask, never a separate
    // opaque strip. Its own broad side/bottom ramps still end at zero alpha.
    pixels[i * 4 + 3] = Math.round(source[i] + (255 - source[i]) * controlField[i] * controls);
  }
  context.putImageData(image, 0, 0);
  const texture = `url("${canvas.toDataURL('image/png')}")`;
  if (composedFrames.size >= MAX_COMPOSED_FRAMES) composedFrames.delete(composedFrames.keys().next().value);
  composedFrames.set(key, texture); return texture;
}
function notify() { for (const instance of instances) instance.update(); }
function shouldBuild() {
  const frameLimit = reducedMotion.matches ? 1 : FRAME_COUNT;
  return !buildFailed && frames.length < frameLimit && !document.hidden && !suspended
    && !window.PortfolioStartGate?.active && [...instances].some(instance => instance.needsFrames());
}
function queueBuild() {
  if (pendingBuild || !shouldBuild()) return;
  pendingBuild = true;
  const step = deadline => {
    pendingBuild = false;
    if (!shouldBuild()) return;
    if (deadline && deadline.timeRemaining() < 8) { queueBuild(); return; }
    try {
      if (!context) {
        canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
        // Encode on the CPU to avoid synchronous GPU readback.
        context = canvas.getContext('2d', {alpha:true, willReadFrequently:true});
        if (!context) throw new Error('Mask canvas unavailable');
      }
      makeFrame(frames.length);
    } catch { buildFailed = true; }
    if (frames.length === 1 || frames.length === FRAME_COUNT || buildFailed) notify();
    queueBuild();
  };
  // The CSS mask covers the preview until the first texture is ready.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(step);
  else setTimeout(step, 80);
}

function attachMask(root) {
  let visible = false, timer = 0, lastFrame = -1, disposed = false;
  let compact = false, lastCompact = false, lastControls = -1, controlStart = 0, controlTarget = 0, controlAt = 0;
  const isFullscreen = () => document.fullscreenElement && (document.fullscreenElement === root || root.contains(document.fullscreenElement));
  const hasMaskedMedia = () => Boolean(root.querySelector('.poster-button, :scope > video, :scope > iframe'));
  const needsFrames = () => visible && !disposed && root.isConnected && !root.closest('[hidden]')
    && !isFullscreen() && hasMaskedMedia();
  const canAnimate = () => needsFrames() && !suspended && !document.hidden
    && !reducedMotion.matches && frames.length === FRAME_COUNT;
  function stop() { clearTimeout(timer); timer = 0; root.dataset.playerMaskRunning = 'false'; }
  const controlsAt = now => reducedMotion.matches ? controlTarget : controlStart + (controlTarget - controlStart) * smooth(0, 500, now - controlAt);
  const transitioning = now => Math.abs(controlsAt(now) - controlTarget) > .001;
  function refreshControls() {
    const live = root.querySelector(':scope > iframe, :scope > video');
    const target = live && (root.matches(':hover') || root.contains(document.activeElement)) ? 1 : 0;
    if (target !== controlTarget) { const now = performance.now(); controlStart = controlsAt(now); controlTarget = target; controlAt = now; }
  }
  function apply(index, controls = controlsAt(performance.now())) {
    controls = Math.round(Math.max(0, Math.min(1, controls)) * 8) / 8;
    if (!frames[index] || (index === lastFrame && Math.abs(controls - lastControls) < .001 && compact === lastCompact)) return;
    root.style.setProperty('--player-noise-mask', composedTexture(index, compact, controls));
    root.dataset.playerMaskControls = controls.toFixed(3); lastControls = controls; lastCompact = compact;
    root.dataset.playerMaskFrame = String(index); lastFrame = index;
  }
  function tick() {
    timer = 0;
    if (suspended || document.hidden || !needsFrames()) { stop(); return; }
    refreshControls();
    const now = performance.now();
    apply(reducedMotion.matches ? 0 : Math.floor(now / 1000 * FPS) % frames.length);
    if (!canAnimate() && !transitioning(now)) { stop(); return; }
    root.dataset.playerMaskRunning = 'true'; timer = setTimeout(tick, 1000 / (transitioning(now) ? 16 : FPS));
  }
  function update() {
    stop(); if (disposed) return;
    if (!hasMaskedMedia()) { root.style.removeProperty('--player-noise-mask'); delete root.dataset.playerMaskFrame; root.dataset.playerMaskState = 'image'; lastFrame = -1; return; }
    if (!visible || suspended || document.hidden || root.closest('[hidden]') || isFullscreen()) return;
    queueBuild();
    compact = root.getBoundingClientRect().width <= 600;
    root.dataset.playerMaskSize = compact ? 'compact' : 'wide';
    refreshControls();
    if (!frames.length) { root.dataset.playerMaskState = buildFailed ? 'fallback' : 'waiting'; return; }
    root.dataset.playerMaskState = reducedMotion.matches ? 'static' : frames.length === FRAME_COUNT ? 'ready' : 'preparing';
    apply(reducedMotion.matches ? 0 : Math.floor(performance.now() / 1000 * FPS) % frames.length);
    if (canAnimate() || transitioning(performance.now())) tick();
  }
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }); observer.observe(root);
  const resize = new ResizeObserver(update); resize.observe(root);
  const content = new MutationObserver(update); content.observe(root, {childList:true});
  const enter = () => update(), leave = () => update();
  // Cross-origin frames can lose focus after fullscreen without bubbling a
  // matching focusout. Reconcile actual state instead of retaining a hover flag.
  const pointer = () => { if (visible && controlTarget && !root.matches(':hover') && !root.contains(document.activeElement)) update(); };
  const focus = () => queueMicrotask(update);
  root.addEventListener('pointerenter', enter); root.addEventListener('pointerleave', leave);
  root.addEventListener('focusin', focus); root.addEventListener('focusout', focus);
  document.addEventListener('pointermove', pointer, {passive:true});
  const instance = {update, needsFrames, destroy() { disposed = true; stop(); observer.disconnect(); resize.disconnect(); content.disconnect(); root.removeEventListener('pointerenter',enter); root.removeEventListener('pointerleave',leave); root.removeEventListener('focusin',focus); root.removeEventListener('focusout',focus); document.removeEventListener('pointermove',pointer); instances.delete(instance); }};
  instances.add(instance); update();
}
document.querySelectorAll('.project-preview').forEach(attachMask);
document.addEventListener('visibilitychange', () => { if (!document.hidden) queueBuild(); notify(); });
document.addEventListener('fullscreenchange', notify);
window.addEventListener('portfolio:enter', queueBuild);
reducedMotion.addEventListener('change', () => { queueBuild(); notify(); });
window.addEventListener('pagehide', event => {
  suspended = true;
  if (!event.persisted) { for (const instance of [...instances]) instance.destroy(); }
  else notify();
});
window.addEventListener('pageshow', () => { suspended = false; queueBuild(); notify(); });
