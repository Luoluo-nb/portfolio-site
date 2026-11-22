/* Header-only activation feedback. The caller owns event routing. */
const STORAGE_KEY = 'portfolio-navigation-ripples-v1';
const LIFE = 800, LIMIT = 6;
const BIRTH_ALPHA = 2 / 3, BIRTH_RECOVERY_MS = 200;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const effects = new Map();
let pageActive = true, serial = 0;

const style = document.createElement('style');
style.textContent = `
.navigation-ripple-layer{position:fixed;inset:0;z-index:120;pointer-events:none;user-select:none;overflow:hidden}
.navigation-ripple-layer[hidden]{display:none}
.navigation-ripple-mark{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.navigation-ripple-ring{position:absolute;left:-38px;top:-38px;width:76px;height:76px;border:0;opacity:0;transform-origin:50% 50%;pointer-events:none}
.navigation-ripple-ring-secondary{left:-32px;top:-32px;width:64px;height:64px}
`;
(document.head || document.documentElement).append(style);

const layer = document.createElement('div');
layer.className = 'navigation-ripple-layer';
layer.setAttribute('aria-hidden', 'true');
layer.setAttribute('data-no-translate', '');
(document.body || document.documentElement).append(layer);

function newArc() {
  return {sweep: 60 + Math.random() * 300, start: Math.random() * 360,
    direction: Math.random() < .5 ? -1 : 1, speed: 55 + Math.random() * 100,
    alphaPower: .4 + Math.random() * 4.6};
}

function validArc(arc) {
  return arc && [arc.sweep, arc.start, arc.speed].every(Number.isFinite)
    // Accept old v2 arcs below 60 degrees, then normalize their sweep on restore.
    && arc.sweep >= 30 && arc.sweep <= 360 && arc.start >= 0 && arc.start < 360
    && (arc.direction === -1 || arc.direction === 1) && arc.speed >= 0 && arc.speed <= 360;
}

function birthAlpha(age) {
  const progress = Math.max(0, Math.min(1, age / BIRTH_RECOVERY_MS));
  return BIRTH_ALPHA + (1 - BIRTH_ALPHA) * progress * progress * (3 - 2 * progress);
}

function midpointStrength(progress) {
  return progress <= 0 || progress >= 1 ? 0 : Math.sin(Math.PI * progress);
}

function resolveAlphaPower(arc, index) {
  if (Number.isFinite(arc.alphaPower) && arc.alphaPower >= .4 && arc.alphaPower <= 5) return arc.alphaPower;
  // Old v2 records keep their geometry and motion. Derive a stable per-ring
  // exponent once; the existing arcs snapshot then carries it on navigation.
  let seed = (Math.round(arc.sweep * 1000) ^ Math.imul(Math.round(arc.start * 1000), 31)
    ^ Math.imul(Math.round(arc.speed * 1000), 131) ^ Math.imul(index + 1, 0x9e3779b9)
    ^ (arc.direction < 0 ? 0x85ebca6b : 0)) >>> 0;
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
  return .4 + 4.6 * ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
}

function angularColor(progress, alphaPower, opacity = 1) {
  const strength = midpointStrength(progress), light = strength ** 1.4;
  const red = Math.round(142 + light * 106), green = Math.round(215 + light * 38);
  const alpha = Math.pow(strength ** 1.65, alphaPower) * opacity;
  return `rgba(${red},${green},255,${alpha})`;
}

function paintArc(ring, arc, index) {
  const size = index ? 64 : 76, radius = size / 2 - 3;
  const ratio = Math.min(devicePixelRatio || 1, 2), sweep = arc.sweep * Math.PI / 180;
  ring.width = Math.round(size * ratio); ring.height = Math.round(size * ratio);
  const paint = ring.getContext('2d', {alpha: true});
  const count = Math.max(12, Math.ceil(arc.sweep / 10) * 2);
  const point = (progress, offset = 0) => {
    const angle = arc.direction * (progress - 1) * sweep;
    return {x: size / 2 + Math.cos(angle) * (radius + offset), y: size / 2 + Math.sin(angle) * (radius + offset)};
  };
  if (!paint) {
    // The same tapered open silhouette remains usable without a 2D context.
    const outside = [], inside = [];
    for (let step = 0; step <= count; step++) {
      const progress = step / count, half = .7 * midpointStrength(progress) ** .7;
      for (const [points, offset] of [[outside, half], [inside, -half]]) {
        const p = point(progress, offset); points.push(`${p.x / size * 100}% ${p.y / size * 100}%`);
      }
    }
    ring.style.clipPath = `polygon(${outside.concat(inside.reverse()).join(',')})`;
    const stops = Array.from({length: 17}, (_, step) => `${angularColor(step / 16, arc.alphaPower)} ${arc.sweep * step / 16}deg`);
    ring.style.background = `conic-gradient(from ${arc.direction > 0 ? 90 - arc.sweep : 90}deg,${stops.join(',')},transparent 360deg)`;
    return;
  }
  paint.setTransform(ratio, 0, 0, ratio, 0, 0);
  paint.lineCap = 'round';
  // Paint once per birth/restore. Native transforms provide motion afterwards;
  // neither gradient sampling nor a new animation loop runs on every frame.
  for (const soft of [true, false]) for (let step = 0; step < count; step++) {
    const a = step / count, b = (step + 1) / count, mid = (a + b) / 2;
    const start = point(a), end = point(b);
    const gradient = paint.createLinearGradient(start.x, start.y, end.x, end.y);
    for (const [stop, progress] of [[0, a], [1, b]]) {
      gradient.addColorStop(stop, angularColor(progress, arc.alphaPower, soft ? .15 : 1));
    }
    paint.strokeStyle = gradient;
    const strength = midpointStrength(mid);
    paint.lineWidth = Math.max(.025, (index ? 1.15 : 1.4) * strength ** .7 + (soft ? 1.6 * strength : 0));
    paint.beginPath();
    paint.arc(size / 2, size / 2, radius, arc.direction * (a - 1) * sweep, arc.direction * (b - 1) * sweep, arc.direction < 0);
    paint.stroke();
  }
}

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
    const arc = effect.arcs[index];
    const duration = LIFE - delay;
    const rotation = progress => arc.start + arc.direction * arc.speed * duration / 1000 * progress;
    if (typeof ring.animate === 'function') {
      const envelope = [
        {opacity: 0, scale: .14, offset: 0},
        {opacity: index ? .52 : .82, scale: .34, offset: .13},
        {opacity: index ? .24 : .34, scale: .78, offset: .67},
        {opacity: 0, scale: 1, offset: 1},
      ];
      // Sample only the short birth multiplier; the old scale/alpha envelope
      // resumes unchanged at 200ms. Seeking currentTime restores this phase too.
      const offsets = [...new Set([0, .13, .67, 1, ...[1, 25, 50, 100, 150, BIRTH_RECOVERY_MS].map(time => time / duration)])].sort((a, b) => a - b);
      const frames = offsets.map(offset => {
        const end = Math.max(1, envelope.findIndex(key => key.offset >= offset));
        const from = envelope[end - 1], to = envelope[end];
        const mix = (offset - from.offset) / (to.offset - from.offset);
        const opacity = (from.opacity + (to.opacity - from.opacity) * mix) * birthAlpha(offset * duration);
        const scale = from.scale + (to.scale - from.scale) * mix;
        return {opacity, transform: `scale(${scale}) rotate(${rotation(offset)}deg)`, offset};
      });
      const animation = ring.animate(frames, {duration, delay, easing: 'linear', fill: 'both'});
      // Both rings share the original wall-clock birth time across pages.
      animation.currentTime = age;
      effect.animations.push(animation);
    } else {
      const progress = Math.max(0, (age - delay) / (LIFE - delay));
      ring.style.opacity = age < delay ? '0' : String(.3 * (1 - progress) * birthAlpha(age - delay));
      ring.style.transform = `scale(${.3 + progress * .7}) rotate(${rotation(progress)}deg)`;
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
  const arcs = [0, 1].map(index => {
    const arc = validArc(record.arcs?.[index])
      ? {...record.arcs[index], sweep: Math.max(60, record.arcs[index].sweep)} : newArc();
    arc.alphaPower = resolveAlphaPower(arc, index);
    return arc;
  });
  const rings = [0, 1].map(index => {
    const ring = document.createElement('canvas');
    ring.className = 'navigation-ripple-ring' + (index ? ' navigation-ripple-ring-secondary' : '');
    paintArc(ring, arcs[index], index);
    node.append(ring);
    return ring;
  });
  const effect = {...record, arcs, node, rings, animations: [], timer: 0};
  effects.set(record.id, effect);
  layer.append(node);
  animateEffect(effect, now);
}

function saveForNextPage() {
  const now = Date.now();
  prune(now);
  const records = [...effects.values()].map(({id, x, y, born, arcs}) => ({id, x, y, born, arcs}));
  try {
    if (records.length && !reduced.matches)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({version: 2, effects: records}));
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
  if (reduced.matches || ![1, 2].includes(stored?.version) || !Array.isArray(stored.effects)) return;
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
