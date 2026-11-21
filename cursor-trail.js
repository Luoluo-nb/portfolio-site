// Every short-lived particle drifts away from the current mouse independently.
// Native cursor behavior is unchanged; this transparent canvas never takes hits.
import { createCursorPrism, CURSOR_REGION_COUNT } from './cursor-prism.js';
import { createCursorFlock } from './cursor-flock.js';

function mountCursorTrail() {
  if (document.getElementById('cursor-trail-canvas')) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'cursor-trail-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-no-translate', '');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;user-select:none;z-index:80;contain:strict;will-change:transform;';
  canvas.hidden = true;
  document.body.append(canvas);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) { canvas.dataset.state = 'unsupported'; return; }
  const prism = createCursorPrism(canvas, context);
  // The pointer star is viewport-fixed while painted history scrolls with the
  // document. Its separate 32px surface avoids a second full-screen buffer.
  const starSize = 32;
  const starCanvas = document.createElement('canvas');
  starCanvas.id = 'cursor-star-canvas';
  starCanvas.setAttribute('aria-hidden', 'true');
  starCanvas.setAttribute('data-no-translate', '');
  starCanvas.style.cssText = 'position:fixed;left:0;top:0;width:32px;height:32px;pointer-events:none;user-select:none;z-index:80;contain:strict;will-change:transform;';
  starCanvas.hidden = true;
  document.body.append(starCanvas);
  const starContext = starCanvas.getContext('2d', { alpha: true });
  const flock = createCursorFlock(starCanvas, starContext);

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
  const regionSpacing = Array.from({ length: CURSOR_REGION_COUNT }, () => ({ scale: .7 + Math.random() * .65, refreshed: performance.now() }));
  let spacingRegion = null;
  const regionRefreshMs = 200;
  const sampleSpacing = () => spacing * (.55 + fastMix * 1.05)
    * (regionSpacing[spacingRegion]?.scale ?? 1) * (.7 + Math.random() * .6);
  function refreshRegionSpacing(now) {
    for (let region = 0; region < regionSpacing.length; region++) {
      const value = regionSpacing[region];
      if (region === spacingRegion || now - value.refreshed < regionRefreshMs) continue;
      value.scale = .7 + Math.random() * .65;
      value.refreshed = now;
    }
  }
  function lockSpacingRegion(region, now) {
    if (region === spacingRegion) return;
    refreshRegionSpacing(now);
    if (spacingRegion !== null) regionSpacing[spacingRegion].refreshed = now;
    spacingRegion = region;
  }
  let previous = null, mouse = null, head = null;
  // History is anchored to the document; pointer sampling and Voronoi regions
  // remain in viewport coordinates. Scrolling lifts the pen without new ink.
  let pageScrollX = window.scrollX, pageScrollY = window.scrollY;
  let paintScrollX = pageScrollX, paintScrollY = pageScrollY, compositeX = 0, compositeY = 0;
  function commitScrollFrame() {
    paintScrollX = pageScrollX; paintScrollY = pageScrollY;
    compositeX = compositeY = 0;
    canvas.style.transform = 'translate3d(0px,0px,0)';
  }
  function syncScroll() {
    const x = window.scrollX, y = window.scrollY;
    if (x === pageScrollX && y === pageScrollY) return;
    pageScrollX = x; pageScrollY = y;
    // Reposition already-painted pixels immediately, independently of the
    // material/physics RAF. The next complete paint takes over at this offset.
    compositeX = paintScrollX - x; compositeY = paintScrollY - y;
    canvas.style.transform = `translate3d(${compositeX}px,${compositeY}px,0)`;
    if (head) head.released = true;
    head = null;
    previous = null;
    remainder = 0;
  }
  let strokeSequence = 0, activeRegion = null, boundaryBreaks = 0;
  // Total width across a shared boundary: 0.75 CSS px inside each cell.
  const penLiftDistance = 1.5, boundaryInset = penLiftDistance / 2, ringLife = 240;
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
  canvas.dataset.boundaryMode = 'voronoi-pen-lift';
  canvas.dataset.penLiftDistance = String(penLiftDistance);
  canvas.dataset.ringLife = String(ringLife);
  canvas.dataset.regionSpacingRefresh = String(regionRefreshMs);
  canvas.dataset.coordinateSpace = 'page';

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
  // A fixed nucleus plus a smaller moving light layer give each star depth.
  // Only these interior samples move; the point and its outer glow stay put.
  const nucleus = document.createElement('canvas');
  nucleus.width = nucleus.height = 48;
  const nucleusContext = nucleus.getContext('2d');
  if (nucleusContext) {
    const gradient = nucleusContext.createRadialGradient(24, 24, 0, 24, 24, 24);
    gradient.addColorStop(0, '#e4f5ff');
    gradient.addColorStop(.4, '#afd9ed');
    gradient.addColorStop(.78, '#487da8');
    gradient.addColorStop(1, '#162f55');
    nucleusContext.fillStyle = gradient;
    nucleusContext.fillRect(0, 0, 48, 48);
  }
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

  // A periodic one-dimensional material scrolls inside the thin line itself.
  // Stable emission IDs share the UV at each joint, so removing an old point
  // never restarts the flow on the surviving chain. No per-frame pixel writes.
  const lineFlow = document.createElement('canvas');
  lineFlow.width = 256; lineFlow.height = 4;
  const lineFlowContext = lineFlow.getContext('2d');
  const flowPeriod = 2.25, flowSpeed = .00145;
  if (lineFlowContext) {
    const image = lineFlowContext.createImageData(lineFlow.width, lineFlow.height);
    for (let x = 0; x < lineFlow.width; x++) {
      const phase = x / lineFlow.width * Math.PI * 2;
      const crest = (.5 + .5 * Math.sin(phase)) ** 6;
      const ripple = .5 + .5 * Math.sin(phase * 3 + .65 * Math.sin(phase * 2));
      const grain = .5 + .5 * Math.sin(phase * 11 + .45 * Math.sin(phase * 5));
      const light = .14 + .76 * crest + .10 * ripple * grain;
      // A narrow blush crest complements the blue/white core without tinting
      // the whole trail. Only the cached color changes; flow and alpha stay put.
      const blush = (.5 + .5 * Math.sin(phase + .55)) ** 18 * .85;
      for (let y = 0; y < lineFlow.height; y++) {
        const i = (y * lineFlow.width + x) * 4;
        image.data[i] = (92 + 139 * crest) * (1 - blush) + 233 * blush;
        image.data[i + 1] = (184 + 63 * crest) * (1 - blush) + 183 * blush;
        image.data[i + 2] = 255 * (1 - blush) + 208 * blush;
        image.data[i + 3] = 255 * light;
      }
    }
    lineFlowContext.putImageData(image, 0, 0);
  }

  function state(value) {
    canvas.dataset.state = value;
    canvas.dataset.running = String(Boolean(frameId));
    canvas.dataset.particles = String(particles.length);
    canvas.dataset.mainParticles = String(particles.filter(p => p.retiredAt === null).length);
    canvas.dataset.afterglowParticles = String(particles.filter(p => p.retiredAt !== null).length);
    canvas.dataset.flockParticles = String(flock.getMetadata().count);
    canvas.dataset.segments = String(linkCount);
    canvas.dataset.boundaryBreaks = String(boundaryBreaks);
    canvas.dataset.region = String(activeRegion ?? '');
    canvas.dataset.regionSpacing = String(regionSpacing[spacingRegion]?.scale ?? 1);
  }

  function stop(reason, releaseRegion = true) {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    particles.length = 0;
    previous = null;
    mouse = null;
    head = null;
    activeRegion = null;
    if (releaseRegion) lockSpacingRegion(null, performance.now());
    boundaryBreaks = 0;
    remainder = linkCount = 0;
    nextSpacing = spacing;
    pageScrollX = window.scrollX; pageScrollY = window.scrollY;
    motionSpeed = fastMix = 0;
    particleLimit = BASE_PARTICLES;
    canvas.dataset.maxParticles = String(particleLimit);
    context.clearRect(0, 0, width, height);
    commitScrollFrame();
    starContext?.clearRect(0, 0, starSize, starSize);
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
    starCanvas.width = starCanvas.height = Math.round(starSize * ratio);
    starContext?.setTransform(starCanvas.width / starSize, 0, 0, starCanvas.height / starSize, 0, 0);
    commitScrollFrame();
    prism.resize(width, height);
    flock.resize(width, height);
    canvas.dataset.dpr = String(ratio);
  }

  function availability() {
    const reason = reducedMotion.matches ? 'disabled-motion'
      : !finePointer.matches ? 'disabled-input'
      : window.PortfolioStartGate?.active ? 'waiting-start'
      : suspended || document.hidden ? 'suspended' : '';
    enabled = !reason;
    canvas.hidden = !enabled;
    starCanvas.hidden = !enabled;
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
      x: x + pageScrollX, y: y + pageScrollY, born: now, appeared: now, updated: now,
      flowId: ++flowSequence,
      strokeId: strokeSequence,
      parallaxX: 0, parallaxY: 0,
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

  function renderFlock(now) {
    if (!starContext) return false;
    starContext.clearRect(0, 0, starSize, starSize);
    if (mouse) starCanvas.style.transform = `translate3d(${mouse.x - starSize / 2}px,${mouse.y - starSize / 2}px,0)`;
    starContext.save();
    starContext.translate(starSize / 2 - (mouse?.x ?? 0), starSize / 2 - (mouse?.y ?? 0));
    const active = flock.render(now, mouse);
    starContext.restore();
    return active;
  }

  function render(now) {
    frameId = 0;
    if (!enabled || suspended || document.hidden || window.PortfolioStartGate?.active) { stop('suspended'); return; }
    syncScroll();
    refreshRegionSpacing(now);
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
      const dx = particle.x - (mouse ? mouse.x + pageScrollX : particle.x);
      const dy = particle.y - (mouse ? mouse.y + pageScrollY : particle.y);
      const distance = Math.hypot(dx, dy);
      const interiorLag = 1 - Math.exp(-seconds / .14);
      particle.parallaxX += (Math.max(-1, Math.min(1, -dx / 140)) - particle.parallaxX) * interiorLag;
      particle.parallaxY += (Math.max(-1, Math.min(1, -dy / 140)) - particle.parallaxY) * interiorLag;
      particle.vx = particle.vy = 0;
      if (particle === head && mouse) {
      // One point marks the pointer exactly throughout the retained history.
        particle.x = mouse.x + pageScrollX;
        particle.y = mouse.y + pageScrollY;
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
      commitScrollFrame();
      if (renderFlock(now)) {
        frameId = requestAnimationFrame(render);
        state('flock-only');
        return;
      }
      // Invisible regions are refreshed lazily on the next input after the
      // drawing loop sleeps. Keep the occupied region's spacing locked.
      stop('idle', false); return;
    }

    // Connect in emission order, preserving bends instead of nearest-neighbour
    // shortcuts that flatten fast turns or join the wrong side of a loop.
    context.save();
    context.translate(-pageScrollX, -pageScrollY);
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    context.strokeStyle = '#b8e3ff';
    linkCount = 0;
    for (let index = 1; index < particles.length; index++) {
      const sourceA = particles[index - 1], sourceB = particles[index];
      if (sourceA.strokeId !== sourceB.strokeId) continue;
      const originalDistance = Math.hypot(sourceA.x - sourceB.x, sourceA.y - sourceB.y);
      if (originalDistance < 1 || originalDistance >= linkDistance) continue;
      const alpha = Math.min(sourceA.alpha, sourceB.alpha) * .78 * (1 - (originalDistance / linkDistance) ** 2);
      if (alpha < .006) continue;
      // Both original age and the afterglow's smooth exit already live in alpha.
      // Using that same weight avoids a width step when a point changes group.
      const taper = Math.pow(Math.min(1, Math.max(0, Math.min(sourceA.alpha, sourceB.alpha) / .64)), .55);
      const a = sourceA, b = sourceB;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < .01) continue;
      context.lineWidth = .85 * taper;
      if (lineGlowContext) {
        context.save();
        context.translate(a.x, a.y);
        context.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        context.globalAlpha = alpha * .42;
        const haloHeight = 10 * taper;
        context.drawImage(lineGlow, 0, -haloHeight / 2, distance, haloHeight);
        context.restore();
      }
      context.globalAlpha = alpha * (lineFlowContext ? .42 : 1);
      context.strokeStyle = '#b8e3ff';
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
      if (lineFlowContext) {
        const interval = b.flowId - a.flowId;
        const tileWidth = distance * flowPeriod / interval;
        const phase = ((a.flowId + now * flowSpeed) % flowPeriod) / flowPeriod;
        const coreWidth = .85 * taper;
        context.save();
        context.translate(a.x, a.y);
        context.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        context.beginPath();
        context.rect(0, -coreWidth / 2, distance, coreWidth);
        context.clip();
        context.globalAlpha = Math.min(1, alpha * 1.75);
        // Increasing phase carries the bright strands from newer to older IDs.
        for (let x = -phase * tileWidth; x < distance; x += tileWidth)
          context.drawImage(lineFlow, x, -coreWidth / 2, tileWidth, coreWidth);
        context.restore();
      }
      linkCount++;
    }
    for (const particle of particles) {
      // Every layer shares this point's own smooth size and opacity envelope.
      const spread = Math.pow(Math.max(0, particle.alpha / .64), .30);
      const phase = (particle.flowId + now * .0024) % 8;
      const pulseDistance = Math.min(phase, 8 - phase);
      const pulse = Math.exp(-.5 * (pulseDistance / .45) ** 2);
      const display = particle;
      const ringAge = Math.max(0, now - particle.appeared);
      if (pointRing && ringAge < ringLife) {
        const diameter = particle.radius * 42 * spread * (.12 + .88 * Math.exp(-ringAge / 65));
        context.globalAlpha = particle.alpha * .28 * (1 - ringAge / ringLife) ** 2;
        context.drawImage(pointRing, display.x - diameter / 2, display.y - diameter / 2, diameter, diameter);
      }
      if (pointHaze) {
        const diameter = particle.radius * 28 * spread;
        context.globalAlpha = particle.alpha * .35 * (1 + pulse * .15);
        context.drawImage(pointHaze, display.x - diameter / 2, display.y - diameter / 2, diameter, diameter);
      }
      if (glowContext) {
        const diameter = particle.radius * 14 * spread;
        context.globalAlpha = particle.alpha * .55 * (1 + pulse * .15);
        context.drawImage(glow, display.x - diameter / 2, display.y - diameter / 2, diameter, diameter);
      }
      const coreRadius = particle.radius * 2.1 * spread;
      context.save();
      context.beginPath();
      context.arc(display.x, display.y, coreRadius, 0, Math.PI * 2);
      context.clip();
      context.globalAlpha = particle.alpha * (1 + pulse * .12);
      if (nucleusContext) context.drawImage(nucleus, display.x - coreRadius, display.y - coreRadius, coreRadius * 2, coreRadius * 2);
      else { context.fillStyle = '#cce8fa'; context.fill(); }
      if (glowContext) {
        const innerSize = coreRadius * 2.4;
        context.globalAlpha = particle.alpha * .9;
        context.drawImage(glow, display.x + particle.parallaxX * coreRadius * .48 - innerSize / 2,
          display.y + particle.parallaxY * coreRadius * .48 - innerSize / 2, innerSize, innerSize);
        context.globalAlpha = particle.alpha * .42;
        context.drawImage(glow, display.x - particle.parallaxX * coreRadius * .25 - coreRadius,
          display.y - particle.parallaxY * coreRadius * .25 - coreRadius, coreRadius * 2, coreRadius * 2);
      }
      context.restore();
    }
    context.restore();
    commitScrollFrame();
    renderFlock(now);
    frameId = requestAnimationFrame(render);
    state('active');
  }

  function liftPen() {
    if (head) head.released = true;
    head = null;
    remainder = 0;
  }

  function continueStroke(start, end, now) {
    const interval = prism.insetSegment(start, end, activeRegion, boundaryInset);
    if (!interval) { liftPen(); return; }
    if (interval.t0 > 1e-9) liftPen();
    const startX = interval.from.x, startY = interval.from.y;
    const dx = interval.to.x - startX, dy = interval.to.y - startY;
    const pathLength = Math.hypot(dx, dy);
    if (pathLength < .001) { if (interval.t1 < 1 - 1e-9) liftPen(); return; }
    const directionX = dx / pathLength, directionY = dy / pathLength;
    if (!head) {
      strokeSequence++;
      head = emit(startX, startY, now);
      // Preserve the entry edge instead of dragging the first point straight
      // to a distant event endpoint. This also handles one-event fast sweeps.
      head.released = true;
      head = emit(startX, startY, now);
      remainder = 0;
      nextSpacing = sampleSpacing();
    }
    let traveled = nextSpacing - remainder;
    for (; traveled <= pathLength;) {
      if (!head.released) {
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
    head.x = interval.to.x + pageScrollX;
    head.y = interval.to.y + pageScrollY;
    head.born = head.updated = now;
    head.vx = head.vy = 0;
    if (interval.t1 < 1 - 1e-9) liftPen();
  }

  function samplePointer(event) {
    // Read the actual offset as well as the scroll event: coalesced input or a
    // render can arrive before the browser dispatches its queued scroll event.
    syncScroll();
    let bounds = canvas.getBoundingClientRect();
    // Content/language changes can toggle scrollbars without a window resize.
    if (Math.abs(bounds.width - width) > .01 || Math.abs(bounds.height - height) > .01) {
      resize();
      bounds = canvas.getBoundingClientRect();
    }
    const now = performance.now(), sampleTime = event.timeStamp || now;
    // The history surface may currently be compositor-shifted. Undo only that
    // CSS offset when sampling; the native pointer and regions stay in viewport.
    const point = { x: event.clientX - bounds.left + compositeX, y: event.clientY - bounds.top + compositeY, time: sampleTime };
    mouse = point;
    if (!previous || sampleTime - previous.time > 180) {
      motionSpeed = fastMix = 0;
      particleLimit = BASE_PARTICLES;
      canvas.dataset.maxParticles = String(particleLimit);
      retireOverflow(now);
      previous = point;
      activeRegion = prism.regionAt(point.x, point.y);
      lockSpacingRegion(activeRegion, now);
      remainder = 0;
      nextSpacing = sampleSpacing();
      if (head) head.released = true;
      strokeSequence++;
      head = prism.insetSegment(point, point, activeRegion, boundaryInset)
        ? emit(point.x, point.y, now) : null;
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
    // Region changes affect the input history once, just like lifting a pen.
    // Old links never get re-clipped as they drift or as the pointer moves.
    let start = previous;
    const crossings = prism.crossings(previous, point, activeRegion);
    for (const crossing of crossings) {
      continueStroke(start, crossing, now);
      liftPen();
      activeRegion = crossing.toRegion;
      lockSpacingRegion(activeRegion, now);
      boundaryBreaks++;
      start = crossing;
    }
    continueStroke(start, point, now);
    previous = point;
    if (!frameId) frameId = requestAnimationFrame(render);
    state('active');
  }

  function move(event) {
    if (!enabled || window.PortfolioStartGate?.active || event.pointerType !== 'mouse') return;
    const samples = event.getCoalescedEvents?.() || [];
    for (const sample of samples) samplePointer(sample);
    // Coalesced samples may omit the final endpoint on some browsers.
    samplePointer(event);
  }

  document.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('scroll', syncScroll, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { previous = null; remainder = 0; lockSpacingRegion(null, performance.now()); if (mouse) mouse.active = false; flock.clear(); starContext?.clearRect(0, 0, starSize, starSize); }, { passive: true });
  window.addEventListener('blur', () => { stop(enabled ? 'idle' : canvas.dataset.state); });
  window.addEventListener('resize', () => { if (enabled) { stop('idle'); resize(); } }, { passive: true });
  document.addEventListener('visibilitychange', availability);
  // Resize after the gate restores scrolling; pagehide suspension wins as well.
  window.addEventListener('portfolio:enter', () => queueMicrotask(availability));
  finePointer.addEventListener('change', availability);
  reducedMotion.addEventListener('change', availability);
  window.addEventListener('pagehide', () => { suspended = true; availability(); });
  window.addEventListener('pageshow', () => { suspended = false; availability(); });
  availability();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountCursorTrail, { once: true });
else mountCursorTrail();

