/* Header-only activation feedback. The caller owns event routing. */
const STORAGE_KEY = 'portfolio-navigation-ripples-v1';
const LIFE = 800, LIMIT = 6;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const effects = new Map();
let pageActive = true, serial = 0;

const style = document.createElement('style');
style.textContent = `
.navigation-ripple-layer{position:fixed;inset:0;z-index:120;pointer-events:none;user-select:none;overflow:hidden}
.navigation-ripple-layer[hidden]{display:none}
.navigation-ripple-mark{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.navigation-ripple-ring{position:absolute;left:-38px;top:-38px;width:76px;height:76px;box-sizing:border-box;border:1px solid #e1f6ff59;border-radius:50%;opacity:0;transform-origin:50% 50%;pointer-events:none}
.navigation-ripple-ring::after{content:'';position:absolute;inset:-1px;border-radius:inherit;background:conic-gradient(from 25deg,#eafdff00 0deg,#f8fdffcc 75deg,#a3dbf480 132deg,#d6f3ff00 200deg,#c0eaff73 292deg,#eafdff00 360deg);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 1px),#000 calc(100% - .6px));mask:radial-gradient(farthest-side,transparent calc(100% - 1px),#000 calc(100% - .6px));pointer-events:none}
.navigation-ripple-ring-secondary{left:-32px;top:-32px;width:64px;height:64px;border-color:#a9def347}
`;
(document.head || document.documentElement).append(style);

const layer = document.createElement('div');
layer.className = 'navigation-ripple-layer';
layer.setAttribute('aria-hidden', 'true');
layer.setAttribute('data-no-translate', '');
(document.body || document.documentElement).append(layer);

function removeEffect(id) {
  const effect = effects.get(id);
  if (!effect) return;
  clearTimeout(effect.timer);
  effect.animations.forEach(animation => animation.cancel());
  effect.node.remove();
  effects.delete(id);
}

function clearEffects() {
  for (const id of [...effects.keys()]) removeEffect(id);
}

function prune(now = Date.now()) {
  for (const effect of effects.values()) {
    if (effect.born > now || now - effect.born >= LIFE) removeEffect(effect.id);
  }
}

function animateEffect(effect, now) {
  clearTimeout(effect.timer);
  effect.animations.forEach(animation => animation.cancel());
  effect.animations = [];
  const age = Math.max(0, now - effect.born);
  if (age >= LIFE) { removeEffect(effect.id); return; }
  if (!pageActive || document.hidden || reduced.matches) return;
  effect.rings.forEach((ring, index) => {
    const delay = index ? 100 : 0;
    if (typeof ring.animate === 'function') {
      const animation = ring.animate([
        {opacity: 0, transform: 'scale(.14) rotate(-15deg)', offset: 0},
        {opacity: index ? .42 : .72, transform: 'scale(.34) rotate(-5deg)', offset: .13},
        {opacity: index ? .20 : .29, transform: 'scale(.78) rotate(24deg)', offset: .67},
        {opacity: 0, transform: 'scale(1) rotate(43deg)', offset: 1},
      ], {duration: LIFE - delay, delay, easing: 'linear', fill: 'both'});
      // Both rings share the original wall-clock birth time across pages.
      animation.currentTime = age;
      effect.animations.push(animation);
    } else {
      const progress = Math.max(0, (age - delay) / (LIFE - delay));
      ring.style.opacity = age < delay ? '0' : String(.3 * (1 - progress));
      ring.style.transform = `scale(${.3 + progress * .7})`;
    }
  });
  effect.timer = setTimeout(() => removeEffect(effect.id), LIFE - age);
}

function addEffect(record, now) {
  if (effects.has(record.id)) return;
  while (effects.size >= LIMIT) removeEffect(effects.keys().next().value);
  const node = document.createElement('span');
  node.className = 'navigation-ripple-mark';
  // Keep the exact viewport activation location, never the latest pointer.
  node.style.transform = `translate3d(${record.x}px,${record.y}px,0)`;
  const rings = [0, 1].map(index => {
    const ring = document.createElement('span');
    ring.className = 'navigation-ripple-ring' + (index ? ' navigation-ripple-ring-secondary' : '');
    node.append(ring);
    return ring;
  });
  const effect = {...record, node, rings, animations: [], timer: 0};
  effects.set(record.id, effect);
  layer.append(node);
  animateEffect(effect, now);
}

function saveForNextPage() {
  const now = Date.now();
  prune(now);
  const records = [...effects.values()].map(({id, x, y, born}) => ({id, x, y, born}));
  try {
    if (records.length && !reduced.matches)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, effects: records}));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Local feedback remains usable when session storage is blocked. */ }
}

function restoreFromPreviousPage() {
  let stored;
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    // Consume once, including invalid/expired data, so BFCache cannot duplicate it.
    sessionStorage.removeItem(STORAGE_KEY);
    stored = value ? JSON.parse(value) : null;
  } catch { return; }
  if (reduced.matches || stored?.version !== 1 || !Array.isArray(stored.effects)) return;
  const now = Date.now();
  const records = stored.effects.filter(record => record && typeof record.id === 'string'
    && [record.x, record.y, record.born].every(Number.isFinite)
    && record.born <= now && now - record.born < LIFE)
    .sort((a, b) => a.born - b.born).slice(-LIMIT);
  for (const record of records) addEffect(record, now);
}

function syncVisibility() {
  const active = pageActive && !document.hidden && !reduced.matches;
  layer.hidden = !active;
  prune();
  if (reduced.matches) {
    clearEffects();
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Optional storage. */ }
    return;
  }
  for (const effect of effects.values()) {
    clearTimeout(effect.timer);
    if (active) animateEffect(effect, Date.now());
    else {
      effect.animations.forEach(animation => animation.cancel());
      effect.animations = [];
    }
  }
}

export function emitNavigationRipple(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || reduced.matches || document.hidden || !pageActive) return false;
  const now = Date.now();
  prune(now);
  layer.hidden = false;
  addEffect({id: `${now}-${++serial}-${Math.random().toString(36).slice(2, 8)}`, x, y, born: now}, now);
  return true;
}

window.addEventListener('pagehide', () => {
  saveForNextPage();
  pageActive = false;
  syncVisibility();
});
window.addEventListener('pageshow', event => {
  pageActive = true;
  if (event.persisted) {
    clearEffects();
    restoreFromPreviousPage();
  }
  syncVisibility();
});
document.addEventListener('visibilitychange', syncVisibility);
reduced.addEventListener('change', syncVisibility);
restoreFromPreviousPage();
syncVisibility();
