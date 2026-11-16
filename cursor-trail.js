// One softly tethered Big Dipper; the native pointer and hit testing stay unchanged.
function mountCursorTrail() {
  if (document.getElementById('cursor-trail-canvas')) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'cursor-trail-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-no-translate', '');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;user-select:none;z-index:80;contain:strict;';
  canvas.hidden = true;
  document.body.append(canvas);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) { canvas.dataset.state = 'unsupported'; return; }

  const finePointer = matchMedia('(pointer: fine) and (hover: hover)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  // Dubhe, Merak, Phecda, Megrez form the bowl; Alioth, Mizar, Alkaid the handle.
  const stars = [
    { x: -43, y: -12, radius: 1.15, response: 22 },
    { x: -47, y: 13, radius: 1.02, response: 18 },
    { x: -18, y: 20, radius: 1.08, response: 24 },
    { x: -11, y: -4, radius: .86, response: 19 },
    { x: 12, y: -12, radius: 1.22, response: 26 },
    { x: 34, y: -10, radius: 1.12, response: 21 },
    { x: 51, y: 6, radius: 1.15, response: 28 },
  ];
  // Four closed-bowl edges plus three handle links require seven segments.
  const links = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]];
  const deadZone = 26;
  const holdTime = 45;
  const fadeTime = 500;
  let width = 0, height = 0, frameId = 0;
  let previous = null, constellation = null;
  let suspended = false, enabled = false;
  canvas.dataset.shape = 'big-dipper';
  canvas.dataset.deadZone = String(deadZone);

  const glow = document.createElement('canvas');
  glow.width = glow.height = 40;
  const glowContext = glow.getContext('2d');
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(20, 20, 0, 20, 20, 20);
    gradient.addColorStop(0, 'rgba(224,246,255,.72)');
    gradient.addColorStop(.15, 'rgba(166,218,255,.32)');
    gradient.addColorStop(.42, 'rgba(109,184,255,.08)');
    gradient.addColorStop(1, 'rgba(86,154,255,0)');
    glowContext.fillStyle = gradient;
    glowContext.fillRect(0, 0, 40, 40);
  }

  function state(value) {
    canvas.dataset.state = value;
    canvas.dataset.running = String(Boolean(frameId));
    canvas.dataset.constellations = constellation ? '1' : '0';
    canvas.dataset.stars = constellation ? '7' : '0';
    canvas.dataset.segments = constellation ? '7' : '0';
    canvas.dataset.particles = canvas.dataset.stars;
  }

  function stop(reason) {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    constellation = null;
    previous = null;
    context.clearRect(0, 0, width, height);
    state(reason);
  }

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    canvas.dataset.dpr = String(ratio);
  }

  function availability() {
    const reason = reducedMotion.matches ? 'disabled-motion'
      : !finePointer.matches ? 'disabled-input'
      : suspended || document.hidden ? 'suspended' : '';
    enabled = !reason;
    canvas.hidden = !enabled;
    if (!enabled) { stop(reason); return; }
    stop('idle');
    resize();
  }

  // An exact critically damped spring: no autonomous wobble or accumulated jitter.
  function follow(body, targetX, targetY, response, dt) {
    const oldX = body.x, oldY = body.y;
    const dx = oldX - targetX, dy = oldY - targetY;
    const jx = body.vx + response * dx, jy = body.vy + response * dy;
    const decay = Math.exp(-response * dt);
    body.x = targetX + (dx + jx * dt) * decay;
    body.y = targetY + (dy + jy * dt) * decay;
    body.vx = (body.vx - response * jx * dt) * decay;
    body.vy = (body.vy - response * jy * dt) * decay;
    const step = Math.hypot(body.x - oldX, body.y - oldY);
    const limit = 900 * dt;
    if (step > limit) {
      body.x = oldX + (body.x - oldX) * limit / step;
      body.y = oldY + (body.y - oldY) * limit / step;
      body.vx = (body.x - oldX) / dt;
      body.vy = (body.y - oldY) / dt;
    }
    if (Math.hypot(body.x - targetX, body.y - targetY) < .02 && Math.hypot(body.vx, body.vy) < .2) {
      body.x = targetX; body.y = targetY; body.vx = body.vy = 0;
    }
  }

  function render(now) {
    frameId = 0;
    if (!enabled || suspended || document.hidden) { stop('suspended'); return; }
    if (!constellation || now - constellation.moved >= holdTime + fadeTime) { stop('idle'); return; }
    const item = constellation;
    const dt = Math.min(32, Math.max(1, now - item.frame)) / 1000;
    follow(item, item.targetX, item.targetY, 14, dt);
    for (let index = 0; index < stars.length; index++) {
      const base = stars[index], point = item.points[index];
      const targetX = item.x + base.x, targetY = item.y + base.y;
      follow(point, targetX, targetY, base.response, dt);
      // Keep the bowl and curved handle recognizable while each star responds.
      const dx = point.x - targetX, dy = point.y - targetY;
      const distance = Math.hypot(dx, dy), tether = 6 + index * .7;
      if (distance > tether) {
        point.x = targetX + dx * tether / distance;
        point.y = targetY + dy * tether / distance;
      }
    }
    item.frame = now;
    const progress = Math.min(1, Math.max(0, now - item.moved - holdTime) / fadeTime);
    const opacity = Math.min(1, (now - item.born) / 90) * (1 - progress * progress * (3 - 2 * progress));
    context.clearRect(0, 0, width, height);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineWidth = .65;
    context.lineCap = 'round';
    context.strokeStyle = '#a9d9f5';
    context.globalAlpha = opacity * .25;
    context.beginPath();
    for (const [from, to] of links) {
      context.moveTo(item.points[from].x, item.points[from].y);
      context.lineTo(item.points[to].x, item.points[to].y);
    }
    context.stroke();
    for (let index = 0; index < stars.length; index++) {
      const star = stars[index], point = item.points[index];
      if (glowContext) {
        const diameter = star.radius * 12;
        context.globalAlpha = opacity * .48;
        context.drawImage(glow, point.x - diameter / 2, point.y - diameter / 2, diameter, diameter);
      }
      context.globalAlpha = opacity * .78;
      context.fillStyle = '#e3f4ff';
      context.beginPath();
      context.arc(point.x, point.y, star.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    frameId = requestAnimationFrame(render);
    state('active');
  }

  function move(event) {
    if (!enabled || event.pointerType !== 'mouse') return;
    const now = performance.now(), point = { x: event.clientX, y: event.clientY };
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < .25) return;
    const targetX = Math.min(Math.max(54, point.x - 64), Math.max(54, width - 58));
    const targetY = Math.min(Math.max(26, point.y + 20), Math.max(26, height - 30));
    if (!constellation) {
      constellation = { x: targetX, y: targetY, vx: 0, vy: 0, targetX, targetY, born: now, moved: now, frame: now,
        points: stars.map(star => ({ x: targetX + star.x, y: targetY + star.y, vx: 0, vy: 0 })) };
    } else {
      // Only a pull beyond the last target's dead zone updates the target.
      // Small pointer movements keep the stars visible but do not move them.
      if (Math.hypot(targetX - constellation.targetX, targetY - constellation.targetY) > deadZone) {
        constellation.targetX = targetX;
        constellation.targetY = targetY;
      }
      constellation.moved = now;
    }
    previous = point;
    if (!frameId) frameId = requestAnimationFrame(render);
    state('active');
  }

  document.addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { previous = null; }, { passive: true });
  window.addEventListener('blur', () => { stop(enabled ? 'idle' : canvas.dataset.state); });
  window.addEventListener('resize', () => { if (enabled) { stop('idle'); resize(); } }, { passive: true });
  document.addEventListener('visibilitychange', availability);
  finePointer.addEventListener('change', availability);
  reducedMotion.addEventListener('change', availability);
  window.addEventListener('pagehide', () => { suspended = true; availability(); });
  window.addEventListener('pageshow', () => { suspended = false; availability(); });
  availability();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountCursorTrail, { once: true });
else mountCursorTrail();

