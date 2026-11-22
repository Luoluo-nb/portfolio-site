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
const stars = document.createElement('canvas');
stars.setAttribute('aria-hidden', 'true');
handle.append(stars);
header.before(dock);
dock.append(handle, header);

const ctx = stars.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const starFrameMs = 1000 / 30;
let starFrame = 0, nextDraw = 0;
let starWidth = 0, starHeight = 0, starScale = 0;
const points = [], edges = [];

function sizeStars() {
  const width = stars.clientWidth, height = stars.clientHeight;
  const scale = Math.min(window.devicePixelRatio || 1, 1.5);
  if (width === starWidth && height === starHeight && scale === starScale) return;
  starWidth = width;
  starHeight = height;
  starScale = scale;
  stars.width = Math.round(width * scale);
  stars.height = Math.round(height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  points.length = edges.length = 0;
  let seed = 6187;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function node(x, y) {
    const point = {
      baseX:x, baseY:y, x, y,
      phase:random() * Math.PI * 2, speed:.54 + random() * .46,
      travelX:9 + random() * 9, travelY:height * (.065 + random() * .055),
      radius:.7 + random() * .7, alpha:.5 + random() * .4
    };
    points.push(point);
    return point;
  }
  function link(a, b, alpha) {
    edges.push({a, b, alpha});
  }
  let previous;
  for (let x = -130; x <= width + 110; x += 78) {
    const top = node(x + random() * 36, height * (.10 + random() * .28));
    const lower = node(x + random() * 44, height * (.46 + random() * .38));
    if (previous) {
      link(previous.top, top, .35 + random() * .25);
      link(previous.lower, lower, .19 + random() * .18);
      if (random() > .22) link(previous.lower, top, .27);
    }
    if (random() > .34) link(top, lower, .21);
    previous = {top, lower};
  }
}

function drawStars(time) {
  ctx.clearRect(0, 0, starWidth, starHeight);
  for (const p of points) {
    const angle = p.phase + time * p.speed;
    p.x = p.baseX + Math.cos(angle) * p.travelX;
    p.y = p.baseY + Math.sin(angle * .84 + p.phase) * p.travelY;
  }
  ctx.lineWidth = .9;
  ctx.strokeStyle = '#6abedf';
  for (const {a, b, alpha} of edges) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.fillStyle = '#b7e7f7';
  for (const p of points) {
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function tickStars(now) {
  if (now >= nextDraw) {
    drawStars(now / 1000);
    nextDraw = now + starFrameMs - (now - nextDraw) % starFrameMs;
  }
  starFrame = requestAnimationFrame(tickStars);
}
function stopStars() {
  cancelAnimationFrame(starFrame);
  starFrame = 0;
}
function syncStars() {
  stopStars();
  if (!ctx || !header.inert || document.hidden) return;
  sizeStars();
  if (!starWidth || !starHeight) return;
  const now = performance.now();
  drawStars(reducedMotion.matches ? 0 : now / 1000);
  if (!reducedMotion.matches) {
    nextDraw = now + starFrameMs;
    starFrame = requestAnimationFrame(tickStars);
  }
}
if ('ResizeObserver' in window) new ResizeObserver(syncStars).observe(stars);
else window.addEventListener('resize', syncStars);
if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', syncStars);
else reducedMotion.addListener(syncStars);
document.addEventListener('visibilitychange', syncStars);
window.addEventListener('pagehide', stopStars);
window.addEventListener('pageshow', syncStars);

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
  syncStars();
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
