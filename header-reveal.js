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

// Draw beyond both ends so the drifting strip meets the viewport edges.
function drawStars() {
  const width = stars.clientWidth, height = stars.clientHeight;
  if (!width || !height) return;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  stars.width = Math.round(width * scale);
  stars.height = Math.round(height * scale);
  const ctx = stars.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  let seed = 6187;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function link(a, b, alpha) {
    ctx.strokeStyle = `rgba(106,190,223,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.lineWidth = .85;
  let previous;
  for (let x = -96; x <= width + 96; x += 72) {
    const top = {x:x + random() * 36, y:2 + random() * height * .38};
    const lower = {x:x + random() * 47, y:height * (.44 + random() * .48)};
    if (previous) {
      link(previous.top, top, .35 + random() * .25);
      link(previous.lower, lower, .19 + random() * .18);
      if (random() > .22) link(previous.lower, top, .27);
    }
    if (random() > .34) link(top, lower, .21);
    for (const point of [top, lower]) {
      ctx.fillStyle = `rgba(183,231,247,${.42 + random() * .46})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, .65 + random() * .6, 0, Math.PI * 2);
      ctx.fill();
    }
    previous = {top, lower};
  }
}
if ('ResizeObserver' in window) new ResizeObserver(drawStars).observe(stars);
else {
  drawStars();
  window.addEventListener('resize', drawStars);
}

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
  header.dataset.reveal = open ? 'open' : 'closed';
  dock.classList.toggle('is-collapsed', !open);
  header.inert = !open;
  handle.tabIndex = open ? -1 : 0;
  handle.setAttribute('aria-expanded', String(open));
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
