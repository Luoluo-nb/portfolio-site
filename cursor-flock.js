// Five local flock members share the trail's clock and input lifecycle.
// Positions and short histories stay relative to the pointer, so a fast sweep
// cannot leave this small companion effect behind on the page.
export function createCursorFlock(canvas, context) {
  const count = 5, innerRadius = 12, outerRadius = 42, historyLife = 420;
  const boids = [];
  const glow = canvas.ownerDocument.createElement('canvas');
  glow.width = glow.height = 32;
  const glowContext = glow.getContext('2d');
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(195,235,255,.62)');
    gradient.addColorStop(.24, 'rgba(127,199,255,.16)');
    gradient.addColorStop(1, 'rgba(95,159,255,0)');
    glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 32, 32);
  }
  let active = false, destroyed = false, previousTime = 0, pointer = null;
  let lagX = 0, lagY = 0, lastSample = 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function clear() { boids.length = 0; active = false; previousTime = lastSample = 0; pointer = null; lagX = lagY = 0; }
  function resize() { clear(); }
  function initialize(now) {
    for (let index = 0; index < count; index++) {
      const phase = index * Math.PI * 2 / count, radius = 21 + index * 1.65;
      boids.push({ x: Math.cos(phase) * radius, y: Math.sin(phase) * radius,
        vx: -Math.sin(phase) * 13, vy: Math.cos(phase) * 13,
        phase, radius: .72 + index * .075, history: [], born: now });
    }
  }
  function render(now, mouse) {
    if (destroyed || !mouse || mouse.active === false || !Number.isFinite(mouse.x) || !Number.isFinite(mouse.y)) { clear(); return false; }
    if (!boids.length) initialize(now);
    const dt = previousTime ? clamp((now - previousTime) / 1000, .001, .04) : 1 / 60;
    const dx = pointer ? mouse.x - pointer.x : 0, dy = pointer ? mouse.y - pointer.y : 0;
    lagX += (clamp(-dx * .35, -7, 7) - lagX) * (1 - Math.exp(-dt * 16));
    lagY += (clamp(-dy * .35, -7, 7) - lagY) * (1 - Math.exp(-dt * 16));
    previousTime = now; pointer = { x: mouse.x, y: mouse.y }; active = true;
    const previous = boids.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy }));
    const sample = now - lastSample >= 45;
    for (let index = 0; index < boids.length; index++) {
      const b = boids[index], current = previous[index];
      let separationX = 0, separationY = 0, centerX = 0, centerY = 0, alignX = 0, alignY = 0;
      for (let other = 0; other < previous.length; other++) {
        if (other === index) continue;
        const n = previous[other], ox = current.x - n.x, oy = current.y - n.y, distance = Math.max(.01, Math.hypot(ox, oy));
        if (distance < 17) { const force = (1 - distance / 17) * 110; separationX += ox / distance * force; separationY += oy / distance * force; }
        centerX += n.x; centerY += n.y; alignX += n.vx; alignY += n.vy;
      }
      const phase = b.phase + now * .00032, radius = 24 + Math.sin(now * .0004 + index) * 3;
      const targetX = Math.cos(phase) * radius + lagX, targetY = Math.sin(phase) * radius + lagY;
      const ax = separationX + (centerX / 4 - current.x) * .32 + (alignX / 4 - current.vx) * .75 + (targetX - current.x) * 10;
      const ay = separationY + (centerY / 4 - current.y) * .32 + (alignY / 4 - current.vy) * .75 + (targetY - current.y) * 10;
      b.vx = (b.vx + ax * dt) * Math.exp(-1.7 * dt); b.vy = (b.vy + ay * dt) * Math.exp(-1.7 * dt);
      const speed = Math.hypot(b.vx, b.vy); if (speed > 36) { b.vx *= 36 / speed; b.vy *= 36 / speed; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      const distance = Math.max(.001, Math.hypot(b.x, b.y)), radiusLimit = clamp(distance, innerRadius, outerRadius);
      if (radiusLimit !== distance) { b.x *= radiusLimit / distance; b.y *= radiusLimit / distance; const radial = (b.vx * b.x + b.vy * b.y) / (radiusLimit * radiusLimit); b.vx -= radial * b.x; b.vy -= radial * b.y; }
      if (sample) b.history.push({ x: b.x, y: b.y, born: now });
      while (b.history.length && now - b.history[0].born > historyLife) b.history.shift();
    }
    if (sample) lastSample = now;
    context.save(); context.globalCompositeOperation = 'lighter'; context.lineCap = 'round';
    context.strokeStyle = '#a5dfff'; context.fillStyle = '#d5efff';
    for (const b of boids) {
      const points = [...b.history, { x: b.x, y: b.y, born: now }];
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1], next = points[index], life = Math.max(0, 1 - (now - a.born) / historyLife);
        context.globalAlpha = .26 * life * life; context.lineWidth = .65 * life;
        context.beginPath(); context.moveTo(mouse.x + a.x, mouse.y + a.y); context.lineTo(mouse.x + next.x, mouse.y + next.y); context.stroke();
      }
      const x = mouse.x + b.x, y = mouse.y + b.y;
      if (glowContext) { context.globalAlpha = .4; context.drawImage(glow, x - 5, y - 5, 10, 10); }
      context.globalAlpha = .62; context.beginPath(); context.arc(x, y, b.radius, 0, Math.PI * 2); context.fill();
    }
    context.restore(); return true;
  }
  function destroy() { clear(); destroyed = true; glow.width = glow.height = 1; }
  function getMetadata() { return { active, count: boids.length, innerRadius, outerRadius, historyLife, pointer,
    boids: boids.map(b => ({ x: (pointer?.x || 0) + b.x, y: (pointer?.y || 0) + b.y, radius: Math.hypot(b.x, b.y), speed: Math.hypot(b.vx, b.vy), trailPoints: b.history.length,
      trailLength: b.history.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - b.history[i].x, p.y - b.history[i].y), 0) })) }; }
  return Object.freeze({ render, resize, clear, destroy, getMetadata });
}
