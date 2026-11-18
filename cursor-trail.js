// Every short-lived particle drifts away from the current mouse independently.
// Native cursor behavior is unchanged; this transparent canvas never takes hits.
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
  const MAX_PARTICLES = 6; // Previous 11 / 2, rounded to a whole particle.
  const spacing = 18, linkDistance = 72, activationDistance = 11;
  const coneHalfAngle = Math.PI / 6, drag = 2.6;
  const particles = [];
  let width = 0, height = 0, frameId = 0, linkCount = 0, remainder = 0;
  let nextSpacing = spacing;
  const sampleSpacing = () => spacing * (.7 + Math.random() * .6);
  let previous = null, mouse = null, head = null;
  let suspended = false, enabled = false;
  canvas.dataset.shape = 'scatter-radial';
  canvas.dataset.maxParticles = String(MAX_PARTICLES);
  canvas.dataset.activationDistance = String(activationDistance);
  canvas.dataset.spacing = String(spacing);
  canvas.dataset.coneDegrees = '60';
  canvas.dataset.linkDistance = String(linkDistance);

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
    canvas.dataset.particles = String(particles.length);
    canvas.dataset.segments = String(linkCount);
  }

  function stop(reason) {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    particles.length = 0;
    previous = null;
    mouse = null;
    head = null;
    remainder = linkCount = 0;
    nextSpacing = spacing;
    context.clearRect(0, 0, width, height);
    state(reason);
  }

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    // CSS width excludes the scrollbar; innerWidth can include it and skew x.
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
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

  function emit(x, y, now) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push({
      x, y, born: now, updated: now,
      // Keep each cone offset stable through its life, rather than noisy per frame.
      angleOffset: (Math.random() * 2 - 1) * coneHalfAngle,
      speed: 38 + Math.random() * 46,
      vx: 0, vy: 0,
      life: 520 + Math.random() * 140,
      radius: .7 + Math.random() * .45,
      alpha: .64,
    });
    return particles[particles.length - 1];
  }

  function render(now) {
    frameId = 0;
    if (!enabled || suspended || document.hidden) { stop('suspended'); return; }
    context.clearRect(0, 0, width, height);
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index], age = Math.max(0, now - particle.born);
      if (age >= particle.life) {
        if (particle === head) head = null;
        particles.splice(index, 1);
        continue;
      }
      const seconds = Math.min(Math.max(0, now - particle.updated) / 1000, 0.05);
      particle.updated = now;
      const dx = particle.x - (mouse?.x ?? particle.x);
      const dy = particle.y - (mouse?.y ?? particle.y);
      const distance = Math.hypot(dx, dy);
      particle.vx = particle.vy = 0;
      if (particle === head && mouse) {
        // One of the six points marks the pointer, without easing or offset.
        particle.x = mouse.x;
        particle.y = mouse.y;
      } else if (distance > activationDistance) {
        // Recompute from this particle to the current mouse on every frame.
        // The quiet centre prevents jitter directly under the native pointer.
        const angle = Math.atan2(dy, dx) + particle.angleOffset;
        const release = Math.min(1, (distance - activationDistance) / 7);
        const falloff = 1 / (1 + (distance - activationDistance) / 150);
        // Ease into twice the outward travel beyond the pointer's quiet centre.
        const outwardBoost = 1 + Math.min(1, Math.max(0, (distance - activationDistance) / 43));
        const speed = particle.speed * release * falloff * outwardBoost * Math.exp(-drag * age / 1000);
        particle.vx = Math.cos(angle) * speed;
        particle.vy = Math.sin(angle) * speed;
        particle.x += particle.vx * seconds;
        particle.y += particle.vy * seconds;
      }
      particle.alpha = Math.pow(1 - age / particle.life, 1.65) * .64;
    }
    if (!particles.length) { stop('idle'); return; }

    // Sparse dots with short, readable chains; work stays bounded by the count cap.
    const candidates = [], degree = new Uint8Array(particles.length);
    const groups = particles.map((_, index) => index);
    const root = index => { while (groups[index] !== index) index = groups[index]; return index; };
    for (let a = 0; a < particles.length; a++) {
      for (let b = a + 1; b < particles.length; b++) {
        const distance = Math.hypot(particles[a].x - particles[b].x, particles[a].y - particles[b].y);
        if (distance > 1 && distance < linkDistance) candidates.push({ a, b, distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineWidth = .85;
    context.lineCap = 'round';
    context.strokeStyle = '#a9d9f5';
    linkCount = 0;
    for (const pair of candidates) {
      if (linkCount >= MAX_PARTICLES - 1) break;
      if (degree[pair.a] >= 2 || degree[pair.b] >= 2) continue;
      const groupA = root(pair.a), groupB = root(pair.b);
      // Short chains, never closed triangles or a densely connected web.
      if (groupA === groupB) continue;
      const a = particles[pair.a], b = particles[pair.b];
      const alpha = Math.min(a.alpha, b.alpha) * .64 * (1 - (pair.distance / linkDistance) ** 2);
      if (alpha < .006) continue;
      context.globalAlpha = alpha;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
      degree[pair.a]++; degree[pair.b]++;
      groups[groupB] = groupA;
      linkCount++;
    }
    for (const particle of particles) {
      if (glowContext) {
        const diameter = particle.radius * 11;
        context.globalAlpha = particle.alpha * .55;
        context.drawImage(glow, particle.x - diameter / 2, particle.y - diameter / 2, diameter, diameter);
      }
      context.globalAlpha = particle.alpha;
      context.fillStyle = '#e3f4ff';
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius * .85, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    frameId = requestAnimationFrame(render);
    state('active');
  }

  function move(event) {
    if (!enabled || event.pointerType !== 'mouse') return;
    const bounds = canvas.getBoundingClientRect();
    // Content/language changes can toggle scrollbars without a window resize.
    if (Math.abs(bounds.width - width) > .01 || Math.abs(bounds.height - height) > .01) resize();
    const now = performance.now(), point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, time: now };
    mouse = point;
    if (!previous || now - previous.time > 180) {
      previous = point;
      remainder = 0;
      nextSpacing = sampleSpacing();
      head = emit(point.x, point.y, now);
      if (!frameId) frameId = requestAnimationFrame(render);
      state('active');
      return;
    }
    const dx = point.x - previous.x, dy = point.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < .1) return;
    const directionX = dx / distance, directionY = dy / distance;
    // A large pointer jump emits near its arrival, not across the entire page.
    const pathLength = Math.min(distance, spacing * MAX_PARTICLES);
    if (distance > pathLength) remainder = 0;
    const startX = point.x - directionX * pathLength, startY = point.y - directionY * pathLength;
    let traveled = nextSpacing - remainder;
    for (; traveled <= pathLength;) {
      emit(startX + directionX * traveled, startY + directionY * traveled, now);
      nextSpacing = sampleSpacing();
      traveled += nextSpacing;
    }
    remainder = pathLength - (traveled - nextSpacing);
    previous = point;
    head = particles[particles.length - 1] || emit(point.x, point.y, now);
    head.x = point.x;
    head.y = point.y;
    head.born = head.updated = now;
    head.alpha = .64;
    head.vx = head.vy = 0;
    if (particles.length && !frameId) frameId = requestAnimationFrame(render);
    if (particles.length) state('active');
  }

  document.addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { previous = null; remainder = 0; }, { passive: true });
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

