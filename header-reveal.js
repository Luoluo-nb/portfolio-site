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
// A single gradient texture supplies the soft tail and bright tip of every pass.
const flowStrip = document.createElement('canvas');
flowStrip.width = 192;
flowStrip.height = 2;
const stripCtx = flowStrip.getContext('2d');
if (stripCtx) {
  const glow = stripCtx.createLinearGradient(0, 0, flowStrip.width, 0);
  glow.addColorStop(0, 'rgba(70,179,219,0)');
  glow.addColorStop(.42, 'rgba(76,203,237,.50)');
  glow.addColorStop(.77, 'rgba(183,247,255,.95)');
  glow.addColorStop(.86, '#e0fbff');
  glow.addColorStop(1, 'rgba(141,231,251,0)');
  stripCtx.fillStyle = glow;
  stripCtx.fillRect(0, 0, flowStrip.width, flowStrip.height);
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const starFrameMs = 1000 / 30;
let starFrame = 0, nextDraw = 0;
let starWidth = 0, starHeight = 0, starScale = 0;
const points = [], edges = [], upperRail = [], lowerRail = [];

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
  points.length = edges.length = upperRail.length = lowerRail.length = 0;
  let seed = 6187;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function node(x, y) {
    const point = {
      baseX:x, baseY:y, x, y,
      phase:random() * Math.PI * 2, speed:.72 + random() * .50,
      travelX:11 + random() * 10, travelY:height * (.08 + random() * .06),
      radius:1.4 + random() * .75, alpha:.62 + random() * .32
    };
    points.push(point);
    return point;
  }
  function link(a, b, width, alpha) {
    edges.push({a, b, width, alpha});
  }
  let previous;
  for (let x = -130; x <= width + 110; x += 78) {
    const top = node(x + random() * 36, height * (.10 + random() * .28));
    const lower = node(x + random() * 44, height * (.46 + random() * .38));
    upperRail.push(top);
    lowerRail.push(lower);
    if (previous) {
      link(previous.top, top, 3.2, .48 + random() * .16);
      link(previous.lower, lower, 2.6, .40 + random() * .13);
      if (random() > .22) link(previous.lower, top, 2.1, .36);
    }
    if (random() > .34) link(top, lower, 1.8, .32);
    previous = {top, lower};
  }
  lowerRail.reverse();
}

// Measure along connected edges so a crest keeps its shape as it rounds a node.
function drawRailFlow(rail, offset, spacing, pulseLength, strokeWidth) {
  ctx.globalAlpha = 1;
  let distance = 0;
  for (let i = 1; i < rail.length; i++) {
    const a = rail[i - 1], b = rail[i];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!length) continue;
    const phase = ((distance - offset) % spacing + spacing) % spacing;
    for (let start = -phase; start < length; start += spacing) {
      const from = Math.max(0, start), to = Math.min(length, start + pulseLength);
      if (to <= from) continue;
      const texels = flowStrip.width / pulseLength;
      ctx.save();
      ctx.transform(dx / length, dy / length, -dy / length, dx / length, a.x, a.y);
      ctx.drawImage(flowStrip, (from - start) * texels, 0, (to - from) * texels, flowStrip.height,
        from, -strokeWidth / 2, to - from, strokeWidth);
      ctx.restore();
    }
    distance += length;
  }
}

function drawStars(time) {
  ctx.clearRect(0, 0, starWidth, starHeight);
  for (const p of points) {
    const angle = p.phase + time * p.speed;
    p.x = p.baseX + Math.cos(angle) * p.travelX;
    p.y = p.baseY + Math.sin(angle * .84 + p.phase) * p.travelY;
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#6abedf';
  for (const {a, b, width, alpha} of edges) {
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  drawRailFlow(upperRail, time * 104, 274, 110, 3.2);
  drawRailFlow(lowerRail, 63 + time * 72, 329, 89, 2.6);
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
