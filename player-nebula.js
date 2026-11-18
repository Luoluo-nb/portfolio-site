/* Actual alpha compositing, not a colored overlay. A small looping procedural
   mask reveals the existing page background through cross-origin players. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const WIDTH = 256, HEIGHT = 144, FRAME_COUNT = 96, FPS = 8;
const frames = [], instances = new Set();
let canvas, context, controlTexture = '', building = false, buildFailed = false, pendingBuild = false, suspended = false;
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
function texture(index, controls = false) {
  const image = context.createImageData(WIDTH, HEIGHT), pixels = image.data;
  const phase = index / FRAME_COUNT * Math.PI * 2, tx = Math.cos(phase) * 1.3, ty = Math.sin(phase) * 1.3;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const u = x / (WIDTH - 1), v = y / (HEIGHT - 1), offset = (y * WIDTH + x) * 4;
    let alpha;
    if (controls) {
      alpha = smooth(0, .018, u) * smooth(0, .018, 1 - u) * smooth(.72, .90, v) * smooth(0, .025, 1 - v) * .82;
    } else {
      const dx = Math.min(u, 1 - u) * WIDTH / HEIGHT, dy = Math.min(v, 1 - v);
      if (Math.min(dx, dy) >= .175) alpha = 1;
      else {
        const nx = u * 5.3 + tx, ny = v * 3.2 + ty;
        const cloud = noise(nx, ny) * .68 + noise(nx * 2.02 + 7.3, ny * 2.02 + 13.1) * .32;
        const feather = .095 + cloud * .08;
        // Both edge distances reach zero at the boundary, so noise never creates
        // an opaque outer rectangle. The product gently rounds the corners.
        alpha = smooth(0, feather, dx) * smooth(0, feather, dy);
      }
    }
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round(alpha * 255);
  }
  context.putImageData(image, 0, 0);
  return `url("${canvas.toDataURL('image/png')}")`;
}
function notify() { for (const instance of instances) instance.update(); }
function queueBuild() {
  if (pendingBuild || buildFailed || frames.length >= FRAME_COUNT || document.hidden || reducedMotion.matches || suspended) return;
  pendingBuild = true;
  const step = () => {
    pendingBuild = false;
    if (document.hidden || buildFailed || reducedMotion.matches || suspended) return;
    try { for (let n = 0; n < 2 && frames.length < FRAME_COUNT; n++) frames.push(texture(frames.length)); }
    catch { buildFailed = true; }
    if (frames.length === FRAME_COUNT || buildFailed) { building = false; notify(); }
    else queueBuild();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(step, {timeout:250}); else setTimeout(step, 16);
}
function prepare() {
  if (building || buildFailed || frames.length) return;
  try {
    canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    context = canvas.getContext('2d', {alpha:true});
    if (!context) throw new Error('Mask canvas unavailable');
    controlTexture = texture(0, true); frames.push(texture(0)); building = true; queueBuild();
  } catch { buildFailed = true; }
}

function attachMask(root) {
  let visible = false, timer = 0, lastFrame = -1, disposed = false;
  const isFullscreen = () => document.fullscreenElement && (document.fullscreenElement === root || root.contains(document.fullscreenElement));
  const canAnimate = () => !disposed && !suspended && visible && !document.hidden && !reducedMotion.matches && !isFullscreen() && frames.length === FRAME_COUNT;
  function stop() { clearTimeout(timer); timer = 0; root.dataset.playerMaskRunning = 'false'; }
  function apply(index) {
    if (index === lastFrame || !frames[index]) return;
    root.style.setProperty('--player-noise-mask', frames[index]);
    root.dataset.playerMaskFrame = String(index); lastFrame = index;
  }
  function tick() {
    timer = 0;
    if (!canAnimate()) { stop(); return; }
    apply(Math.floor(performance.now() / 1000 * FPS) % FRAME_COUNT);
    root.dataset.playerMaskRunning = 'true'; timer = setTimeout(tick, 1000 / FPS);
  }
  function update() {
    stop(); if (disposed) return;
    if (visible) prepare();
    if (controlTexture) root.style.setProperty('--player-control-mask', controlTexture);
    if (!frames.length) { root.dataset.playerMaskState = buildFailed ? 'fallback' : 'waiting'; return; }
    root.dataset.playerMaskState = reducedMotion.matches ? 'static' : frames.length === FRAME_COUNT ? 'ready' : 'preparing';
    if (!visible || document.hidden || isFullscreen()) return;
    apply(reducedMotion.matches ? 0 : Math.floor(performance.now() / 1000 * FPS) % frames.length);
    if (canAnimate()) tick();
  }
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }); observer.observe(root);
  const instance = {update, destroy() { disposed = true; stop(); observer.disconnect(); instances.delete(instance); }};
  instances.add(instance); update();
}
document.querySelectorAll('.project-preview').forEach(attachMask);
document.addEventListener('visibilitychange', () => { if (!document.hidden) queueBuild(); notify(); });
document.addEventListener('fullscreenchange', notify);
reducedMotion.addEventListener('change', () => { queueBuild(); notify(); });
window.addEventListener('pagehide', event => {
  suspended = true;
  if (!event.persisted) { for (const instance of [...instances]) instance.destroy(); }
  else notify();
});
window.addEventListener('pageshow', () => { suspended = false; queueBuild(); notify(); });
