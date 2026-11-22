const header = document.querySelector('.header');
const handle = document.createElement('button');
header.id ||= 'site-header';
handle.type = 'button';
handle.className = 'header-reveal-handle';
handle.dataset.clickEffects = 'off';
handle.dataset.noTranslate = '';
handle.setAttribute('aria-controls', header.id);
handle.setAttribute('aria-expanded', 'true');
handle.tabIndex = -1;
header.before(handle);

function labelHandle() {
  handle.setAttribute('aria-label', document.documentElement.lang === 'en' ? 'Show navigation' : '展开导航');
}
labelHandle();
window.addEventListener('portfolio:languagechange', labelHandle);

const entryHold = 5000;
const leaveDelay = 700;
let started = false;
let earliestClose = 0;
let timer = 0;
let hovering = false;
let keyboard = true;
let pressedPointer = null;

function setOpen(open) {
  header.dataset.reveal = open ? 'open' : 'closed';
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

// Mouse users can reveal from anywhere along the top edge. Touch users tap
// the visible handle; releasing a volume drag outside the bar also re-arms it.
handle.addEventListener('pointerenter', event => {
  if (event.pointerType !== 'mouse') return;
  reveal();
  queueClose();
});
handle.addEventListener('click', event => {
  reveal();
  if (event.detail === 0) header.querySelector('a[href]')?.focus({preventScroll:true});
  queueClose(entryHold);
});
header.addEventListener('pointerenter', event => {
  if (event.pointerType !== 'mouse') return;
  hovering = true;
  reveal();
});
header.addEventListener('pointerleave', event => {
  if (event.pointerType !== 'mouse') return;
  hovering = false;
  queueClose();
});
document.addEventListener('pointerdown', event => {
  keyboard = false;
  if (header.contains(event.target) && event.isPrimary) {
    pressedPointer = event.pointerId;
    reveal();
  } else if (event.target !== handle) queueClose();
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
