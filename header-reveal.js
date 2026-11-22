const header = document.querySelector('.header');
const dock = document.createElement('div');
dock.className = 'header-dock';
const handle = document.createElement('button');
header.id ||= 'site-header';
handle.type = 'button';
handle.className = 'header-reveal-handle';
handle.dataset.clickEffects = 'off';
handle.dataset.noTranslate = '';
handle.setAttribute('aria-controls', header.id);
handle.setAttribute('aria-expanded', 'true');
handle.tabIndex = -1;
const meter = document.createElement('canvas');
meter.setAttribute('aria-hidden', 'true');
handle.append(meter);
header.before(dock);
dock.append(handle, header);

const ctx = meter.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const frameInterval = 1000 / 30;
let frame = 0, lastDraw = 0;
let width = 0, height = 0, scale = 0;
let levels = new Float32Array(0), heights = new Float32Array(0);
let baseInk, filmInk;
let firstSpectrum = true;

// Repeat a seamless interference band across the bars. Moving the fill leaves
// the positions and heights of the measured frequencies unchanged.
if (ctx) {
  const tile = document.createElement('canvas');
  tile.width = 216;
  tile.height = 1;
  const ink = tile.getContext('2d');
  if (ink) {
    const fringe = ink.createLinearGradient(0, 0, tile.width, 0);
    for (const [stop, color] of [
      [0,'rgba(98,185,232,0)'], [.24,'rgba(98,185,232,0)'], [.45,'#78dce6'],
      [.52,'#d4f8ff'], [.57,'#b8a7e5'], [.68,'rgba(119,165,224,.45)'],
      [.75,'rgba(98,185,232,0)'], [1,'rgba(98,185,232,0)']
    ]) fringe.addColorStop(stop, color);
    ink.fillStyle = fringe;
    ink.fillRect(0, 0, tile.width, tile.height);
    filmInk = ctx.createPattern(tile, 'repeat');
  }
}

function sizeMeter() {
  const w = meter.clientWidth, h = meter.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (w === width && h === height && dpr === scale) return;
  width = w;
  height = h;
  scale = dpr;
  meter.width = Math.round(w * dpr);
  meter.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.max(1, Math.min(200, Math.round(w / 10)));
  levels = new Float32Array(count);
  heights = new Float32Array(count);
  baseInk = ctx.createLinearGradient(0, 0, 0, Math.max(1, h));
  baseInk.addColorStop(0, '#527e9b');
  baseInk.addColorStop(.50, '#72b0cd');
  baseInk.addColorStop(1, '#a5e6ef');
}

function drawMeter(now) {
  const seconds = lastDraw ? Math.min((now - lastDraw) / 1000, .15) : frameInterval / 1000;
  lastDraw = now;
  levels.fill(0);
  if (!reducedMotion.matches) {
    window.PortfolioAudioAnalysis?.readSpectrum?.(levels);
    window.PortfolioUIAudio?.mixSpectrum?.(levels);
  }
  const rise = 1 - Math.exp(-seconds / .045), fall = 1 - Math.exp(-seconds / .16);
  const step = width / levels.length, barWidth = Math.min(1.8, step * .24);
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  for (let i = 0; i < levels.length; i++) {
    const target = levels[i];
    heights[i] += (target - heights[i]) * (target > heights[i] ? rise : fall);
    const rest = i % 4 === 0 ? 4 : 2;
    ctx.rect((i + .5) * step - barWidth / 2, 0, barWidth, rest + heights[i] * (height - rest - 1));
  }
  ctx.fillStyle = baseInk;
  ctx.fill();
  if (filmInk) {
    // The path is already in screen coordinates. Only the grating moves.
    const offset = reducedMotion.matches ? 0 : (now * .039) % 216;
    ctx.save();
    ctx.transform(1, 0, -.65, 1, offset, 0);
    ctx.globalAlpha = .33;
    ctx.fillStyle = filmInk;
    ctx.fill();
    ctx.restore();
  }
}
function tickMeter(now) {
  if (now - lastDraw >= frameInterval - 1) drawMeter(now);
  frame = requestAnimationFrame(tickMeter);
}
function stopMeter() {
  cancelAnimationFrame(frame);
  lastDraw = 0;
}
function syncMeter() {
  stopMeter();
  if (!ctx || !header.inert || document.hidden) return;
  sizeMeter();
  if (!width || !height) return;
  heights.fill(0);
  drawMeter(performance.now());
  if (!reducedMotion.matches) frame = requestAnimationFrame(tickMeter);
}
if ('ResizeObserver' in window) new ResizeObserver(syncMeter).observe(meter);
else window.addEventListener('resize', syncMeter);
if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', syncMeter);
else reducedMotion.addListener(syncMeter);
document.addEventListener('visibilitychange', syncMeter);
window.addEventListener('pagehide', stopMeter);
window.addEventListener('pageshow', syncMeter);

function labelHandle() {
  handle.setAttribute('aria-label', document.documentElement.lang === 'en' ? 'Show navigation' : '展开导航');
}
labelHandle();
window.addEventListener('portfolio:languagechange', labelHandle);

const entryHold = 5000;
const leaveDelay = 70;
let started = false;
let earliestClose = 0;
let timer = 0;
let hovering = false;
let keyboard = true;
let pressedPointer = null;

function setOpen(open) {
  if (header.dataset.reveal === (open ? 'open' : 'closed')) return;
  header.dataset.reveal = open ? 'open' : 'closed';
  dock.classList.toggle('is-collapsed', !open);
  header.inert = !open;
  handle.tabIndex = open ? -1 : 0;
  handle.setAttribute('aria-expanded', String(open));
  handle.classList.toggle('first-spectrum', !open && firstSpectrum);
  if (!open) firstSpectrum = false;
  syncMeter();
}
function reveal() {
  clearTimeout(timer);
  setOpen(true);
}
function queueClose(delay = leaveDelay) {
  clearTimeout(timer);
  if (!started || header.inert || document.hidden) return;
  timer = setTimeout(() => {
    if (!hovering && pressedPointer === null && !(keyboard && header.contains(document.activeElement))) setOpen(false);
  }, Math.max(delay, earliestClose - performance.now()));
}
function start(enteredAt) {
  started = true;
  earliestClose = (enteredAt ?? performance.now()) + entryHold;
  setOpen(true);
  queueClose(0);
}

function enterWithKeyboard() {
  reveal();
  header.querySelector('a[href]')?.focus({preventScroll:true});
}
handle.addEventListener('focus', () => {
  if (keyboard && handle.matches(':focus-visible')) enterWithKeyboard();
});
handle.addEventListener('click', event => {
  if (event.detail === 0) enterWithKeyboard();
  else reveal();
  queueClose(entryHold);
});
// This hit area stays stationary while the navigation animates underneath.
dock.addEventListener('pointerenter', event => {
  if (event.pointerType === 'touch') return;
  hovering = true;
  reveal();
});
dock.addEventListener('pointerleave', event => {
  if (event.pointerType === 'touch') return;
  hovering = false;
  queueClose();
});
document.addEventListener('pointerdown', event => {
  keyboard = false;
  if (header.contains(event.target) && event.isPrimary) {
    pressedPointer = event.pointerId;
    reveal();
  } else if (!handle.contains(event.target)) queueClose();
}, {capture:true, passive:true});
function endPress(event) {
  if (event.pointerId !== pressedPointer) return;
  pressedPointer = null;
  queueClose(event.pointerType === 'touch' ? entryHold : leaveDelay);
}
window.addEventListener('pointerup', endPress, {passive:true});
window.addEventListener('pointercancel', endPress, {passive:true});
document.addEventListener('keydown', () => { keyboard = true; }, true);
header.addEventListener('focusin', reveal);
header.addEventListener('focusout', () => queueClose());

function resetPointer() {
  hovering = false;
  pressedPointer = null;
  queueClose();
}
window.addEventListener('blur', resetPointer);
window.addEventListener('pagehide', () => { clearTimeout(timer); });
window.addEventListener('pageshow', event => { if (event.persisted) resetPointer(); });
document.addEventListener('visibilitychange', resetPointer);
if (window.PortfolioStartGate?.active) {
  window.addEventListener('portfolio:enter', event => start(event.detail?.enteredAt), {once:true});
} else {
  start(window.PortfolioStartGate?.enteredAt);
}
