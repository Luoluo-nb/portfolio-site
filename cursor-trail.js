// Every short-lived particle drifts away from the current mouse independently.
// Native cursor behavior is unchanged; this transparent canvas never takes hits.
import { createCursorPrism } from './cursor-prism.js';
import { createCursorFlock } from './cursor-flock.js';

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
  const prism = createCursorPrism(canvas, context);
  const flock = createCursorFlock(canvas, context);

  const finePointer = matchMedia('(pointer: fine) and (hover: hover)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const BASE_PARTICLES = 6, MAX_PARTICLES = 12, afterglowLife = 800;
  // Overflow becomes a fading afterglow, rather than disappearing at the cap.
  // Scale both the sampled path and the time retained behind the pointer.
  const rangeScale = 2.5;
  const spacing = 44 * rangeScale, linkDistance = 176 * rangeScale, activationDistance = 11;
  const coneHalfAngle = Math.PI / 6, drag = 1.8;
  const particles = [];
  let width = 0, height = 0, frameId = 0, linkCount = 0, remainder = 0, flowSequence = 0;
  let nextSpacing = spacing, motionSpeed = 0, fastMix = 0, particleLimit = BASE_PARTICLES;
  // Slow movement lays a closer chain; fast movement stretches new intervals.
  // The existing speed filter is shared, and stored points are never rearranged.
  const sampleSpacing = () => spacing * (.55 + fastMix * 1.05) * (.7 + Math.random() * .6);
  let previous = null, mouse = null, head = null;
  let suspended = false, enabled = false;
  canvas.dataset.shape = 'scatter-radial';
  canvas.dataset.retention = 'main-and-afterglow';
  canvas.dataset.maxParticles = String(BASE_PARTICLES);
  canvas.dataset.fastMaxParticles = String(MAX_PARTICLES);
  canvas.dataset.afterglowLife = String(afterglowLife);
  canvas.dataset.activationDistance = String(activationDistance);
  canvas.dataset.rangeScale = String(rangeScale);
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
  // Point layers are generated once: a Gaussian haze and a broad, soft annulus.
  // The inner glow and crisp star core remain separate from these faint bases.
  function makePointLayer(size, ring) {
    const texture = document.createElement('canvas');
    texture.width = texture.height = size;
    const ctx = texture.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(size, size), half = size / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + .5 - half, y + .5 - half) / half;
      const profile = ring ? Math.exp(-.5 * ((r - .58) / .12) ** 2)
        : Math.exp(-.5 * (r / .24) ** 2);
      const edge = Math.max(0, Math.min(1, (1 - r) / .16));
      const i = (y * size + x) * 4;
      image.data[i] = ring ? 116 : 142;
      image.data[i + 1] = ring ? 183 : 207;
      image.data[i + 2] = 255;
      image.data[i + 3] = (ring ? 56 : 156) * profile * edge * edge * (3 - 2 * edge);
    }
    ctx.putImageData(image, 0, 0);
    return texture;
  }
  const pointHaze = makePointLayer(64, false);
  const pointRing = makePointLayer(96, true);
  // A tiny reusable Gaussian strip gives each link a local halo. No full-canvas
  // blur or per-frame shadow filter is needed, and the sharp core stays intact.
  const lineGlow = document.createElement('canvas');
  lineGlow.width = 64; lineGlow.height = 32;
  const lineGlowContext = lineGlow.getContext('2d');
  if (lineGlowContext) {
    const image = lineGlowContext.createImageData(64, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const vertical = (y - 15.5) / 5.7;
      const end = Math.min(1, x / 5, (63 - x) / 5);
      const i = (y * 64 + x) * 4;
      image.data[i] = 128; image.data[i + 1] = 192; image.data[i + 2] = 255;
      image.data[i + 3] = 84 * Math.exp(-.5 * vertical * vertical) * end;
    }
    lineGlowContext.putImageData(image, 0, 0);
  }

  function state(value) {
    canvas.dataset.state = value;
    canvas.dataset.running = String(Boolean(frameId));
    canvas.dataset.particles = String(particles.length);
    canvas.dataset.mainParticles = String(particles.filter(p => p.retiredAt === null).length);
    canvas.dataset.afterglowParticles = String(particles.filter(p => p.retiredAt !== null).length);
    canvas.dataset.flockParticles = String(flock.getMetadata().count);
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
    motionSpeed = fastMix = 0;
    particleLimit = BASE_PARTICLES;
    canvas.dataset.maxParticles = String(particleLimit);
    context.clearRect(0, 0, width, height);
    prism.clear();
    flock.clear();
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
    prism.resize(width, height);
    flock.resize(width, height);
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

  function retireOverflow(now) {
    let excess = particles.reduce((count, p) => count + (p.retiredAt === null ? 1 : 0), 0) - particleLimit;
    for (const particle of particles) {
      if (excess <= 0) break;
      if (particle.retiredAt !== null) continue;
      // Keep position, velocity, alpha and original lifetime unchanged here.
      particle.retiredAt = now;
      excess--;
    }
  }

  function emit(x, y, now) {
    particles.push({
      x, y, born: now, updated: now,
      flowId: ++flowSequence,
      retiredAt: null,
      released: false,
      // Keep each cone offset stable through its life, rather than noisy per frame.
      angleOffset: (Math.random() * 2 - 1) * coneHalfAngle,
      speed: 38 + Math.random() * 46,
      vx: 0, vy: 0,
      life: (1500 + Math.random() * 400) * rangeScale,
      radius: .7 + Math.random() * .45,
      alpha: .64,
    });
    retireOverflow(now);
    return particles[particles.length - 1];
  }

  function render(now) {
    frameId = 0;
    if (!enabled || suspended || document.hidden) { stop('suspended'); return; }
    context.clearRect(0, 0, width, height);
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index], age = Math.max(0, now - particle.born);
      const retiredAge = particle.retiredAt === null ? 0 : Math.max(0, now - particle.retiredAt);
      if (age >= particle.life || (particle.retiredAt !== null && retiredAge >= afterglowLife)) {
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
      // One point marks the pointer exactly throughout the retained history.
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
      const retiredProgress = Math.min(1, retiredAge / afterglowLife);
      const afterglowWeight = 1 - retiredProgress * retiredProgress * (3 - 2 * retiredProgress);
      const targetAlpha = Math.pow(1 - age / particle.life, 1.65) * .64 * afterglowWeight;
      // A held head renews its age on input. Recover gently after a pause rather
      // than snapping all of its layers back to their full size and brightness.
      particle.alpha = targetAlpha > particle.alpha
        ? particle.alpha + (targetAlpha - particle.alpha) * (1 - Math.exp(-seconds / .12))
        : targetAlpha;
    }
    if (!particles.length) {
      linkCount = 0;
      if (prism.metadata.active) prism.clear();
      if (flock.render(now, mouse)) {
        frameId = requestAnimationFrame(render);
        state('flock-only');
        return;
      }
      stop('idle'); return;
    }

    // Connect in emission order, preserving bends instead of nearest-neighbour
    // shortcuts that flatten fast turns or join the wrong side of a loop.
    prism.beginFrame(now);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    context.strokeStyle = '#b8e3ff';
    linkCount = 0;
    for (let index = 1; index < particles.length; index++) {
      const sourceA = particles[index - 1], sourceB = particles[index];
      const originalDistance = Math.hypot(sourceA.x - sourceB.x, sourceA.y - sourceB.y);
      if (originalDistance < 1 || originalDistance >= linkDistance) continue;
      const alpha = Math.min(sourceA.alpha, sourceB.alpha) * .78 * (1 - (originalDistance / linkDistance) ** 2);
      if (alpha < .006) continue;
      // Both original age and the afterglow's smooth exit already live in alpha.
      // Using that same weight avoids a width step when a point changes group.
      const taper = Math.pow(Math.min(1, Math.max(0, Math.min(sourceA.alpha, sourceB.alpha) / .64)), .55);
      const fragments = prism.segment(sourceA, sourceB, mouse);
      for (const fragment of fragments) {
      const a = { ...sourceA, ...fragment.from, flowId: sourceA.flowId + (sourceB.flowId - sourceA.flowId) * fragment.t0 };
      const b = { ...sourceB, ...fragment.to, flowId: sourceA.flowId + (sourceB.flowId - sourceA.flowId) * fragment.t1 };
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < .01) continue;
      context.lineWidth = 1.35 * taper;
      if (lineGlowContext) {
        context.save();
        context.translate(a.x, a.y);
        context.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        context.globalAlpha = alpha * .55;
        const haloHeight = 14 * taper;
        context.drawImage(lineGlow, fragment.t0 * lineGlow.width, 0,
          (fragment.t1 - fragment.t0) * lineGlow.width, lineGlow.height,
          0, -haloHeight / 2, distance, haloHeight);
        context.restore();
      }
      context.globalAlpha = alpha * (1 - fragment.dispersion * 2);
      context.strokeStyle = '#b8e3ff';
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
      if (fragment.dispersion > 0) {
        const nx = -(b.y - a.y) / distance * .65, ny = (b.x - a.x) / distance * .65;
        context.save(); context.globalAlpha = alpha * fragment.dispersion;
        context.translate(nx, ny); context.strokeStyle = '#70dfff'; context.stroke();
        context.translate(-2 * nx, -2 * ny); context.strokeStyle = '#7899ff'; context.stroke();
        context.restore();
      }
      if (glowContext) {
        // Stable emission IDs make each light packet travel from the pointer
        // toward older points, even when points move between the two groups.
        const travel = now * .0024, period = 8, interval = b.flowId - a.flowId;
        const first = Math.ceil((a.flowId + travel) / period) * period - travel;
        const packetLength = Math.min(70, Math.max(30, originalDistance * .38));
        for (let pulse = 0; pulse < 2; pulse++) {
          const center = first - pulse * period;
          const position = (center - a.flowId) / interval * distance;
          if (position < -packetLength / 2 || position > distance + packetLength / 2) continue;
          context.save();
          context.translate(a.x, a.y);
          context.rotate(Math.atan2(b.y - a.y, b.x - a.x));
          context.beginPath();
          context.rect(0, -5, distance, 10);
          context.clip();
          context.globalAlpha = alpha * .9;
          context.drawImage(glow, position - packetLength / 2, -3 * taper, packetLength, 6 * taper);
          context.restore();
        }
      }
      }
      linkCount++;
    }
    for (const particle of particles) {
      // Every layer shares this point's own smooth size and opacity envelope.
      const spread = Math.pow(Math.max(0, particle.alpha / .64), .30);
      const phase = (particle.flowId + now * .0024) % 8;
      const pulseDistance = Math.min(phase, 8 - phase);
      const pulse = Math.exp(-.5 * (pulseDistance / .45) ** 2);
      const display = prism.point(particle.x, particle.y, mouse, particle.radius * 21 * spread);
      if (pointRing) {
        const diameter = particle.radius * 42 * spread;
        context.globalAlpha = particle.alpha * .42;
        context.drawImage(pointRing, display.x - diameter / 2, display.y - diameter / 2, diameter, diameter);
      }
      if (pointHaze) {
        const diameter = particle.radius * 28 * spread;
        context.globalAlpha = particle.alpha * .35 * (1 + pulse * .15);
        context.drawImage(pointHaze, display.x - diameter / 2, display.y - diameter / 2, diameter, diameter);
      }
      if (glowContext) {
        const diameter = particle.radius * 11 * spread;
        context.globalAlpha = particle.alpha * .55 * (1 + pulse * .15);
        context.drawImage(glow, display.x - diameter / 2, display.y - diameter / 2, diameter, diameter);
      }
      context.globalAlpha = particle.alpha * (1 + pulse * .18);
      context.fillStyle = '#e3f4ff';
      context.beginPath();
      context.arc(display.x, display.y, particle.radius * .85 * spread, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    prism.render(now, mouse);
    flock.render(now, mouse);
    frameId = requestAnimationFrame(render);
    state('active');
  }

  function samplePointer(event) {
    const bounds = canvas.getBoundingClientRect();
    // Content/language changes can toggle scrollbars without a window resize.
    if (Math.abs(bounds.width - width) > .01 || Math.abs(bounds.height - height) > .01) resize();
    const now = performance.now(), sampleTime = event.timeStamp || now;
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, time: sampleTime };
    mouse = point;
    if (!previous || sampleTime - previous.time > 180) {
      motionSpeed = fastMix = 0;
      particleLimit = BASE_PARTICLES;
      canvas.dataset.maxParticles = String(particleLimit);
      retireOverflow(now);
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
    // High-polling mice can supply coalesced samples less than 4ms apart.
    // Preserve that timing so their speed is not underestimated.
    const elapsed = Math.max(.5, sampleTime - previous.time);
    const speed = Math.min(7, distance / elapsed);
    motionSpeed += (speed - motionSpeed) * (1 - Math.exp(-elapsed / (speed > motionSpeed ? 28 : 100)));
    const mix = Math.max(0, Math.min(1, (motionSpeed - .65) / 2.35));
    fastMix = mix * mix * (3 - 2 * mix);
    particleLimit = BASE_PARTICLES + Math.round((MAX_PARTICLES - BASE_PARTICLES) * fastMix);
    canvas.dataset.maxParticles = String(particleLimit);
    retireOverflow(now);
    canvas.dataset.motionSpeed = motionSpeed.toFixed(3);
    const directionX = dx / distance, directionY = dy / distance;
    // Bound only a single abnormal jump to the viewport diagonal. Ordinary
    // movement keeps its full path; no global particle-count cap is applied.
    const pathLength = Math.min(distance, Math.hypot(width, height));
    if (distance > pathLength) remainder = 0;
    const startX = point.x - directionX * pathLength, startY = point.y - directionY * pathLength;
    let traveled = nextSpacing - remainder;
    for (; traveled <= pathLength;) {
      // Apply lateral variation when a head becomes a free particle. Applying
      // it only at spawn would be erased by pointer anchoring on every event.
      if (head && !head.released) {
        const spread = (Math.random() * 2 - 1) * 18 * fastMix;
        head.x -= directionY * spread;
        head.y += directionX * spread;
        head.released = true;
      }
      head = emit(startX + directionX * traveled, startY + directionY * traveled, now);
      nextSpacing = sampleSpacing();
      traveled += nextSpacing;
    }
    remainder = pathLength - (traveled - nextSpacing);
    previous = point;
    head = particles[particles.length - 1] || emit(point.x, point.y, now);
    head.x = point.x;
    head.y = point.y;
    head.born = head.updated = now;
    head.vx = head.vy = 0;
    if (particles.length && !frameId) frameId = requestAnimationFrame(render);
    if (particles.length) state('active');
  }

  function move(event) {
    if (!enabled || event.pointerType !== 'mouse') return;
    const samples = event.getCoalescedEvents?.() || [];
    for (const sample of samples) samplePointer(sample);
    // Coalesced samples may omit the final endpoint on some browsers.
    samplePointer(event);
  }

  document.addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { previous = null; remainder = 0; if (mouse) mouse.active = false; flock.clear(); }, { passive: true });
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

