// A small fixed star at the pointer. The shared trail owns input, clearing,
// frame scheduling, reduced-motion and touch availability.
export function createCursorFlock(canvas, context) {
  const mainRadius = 7, diagonalRadius = 3.25, fadeAfterMs = 80, fadeEndMs = 720;
  const glow = canvas.ownerDocument.createElement('canvas');
  glow.width = glow.height = 32;
  const glowContext = glow.getContext('2d');
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(193,234,255,.32)');
    gradient.addColorStop(.2, 'rgba(147,213,248,.12)');
    gradient.addColorStop(.55, 'rgba(98,174,224,.025)');
    gradient.addColorStop(1, 'rgba(98,174,224,0)');
    glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 32, 32);
  }
  let active = false, destroyed = false, pointer = null, lastMoveAt = 0, appearedAt = 0, opacity = 0;
  const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  function clear() { active = false; pointer = null; lastMoveAt = appearedAt = opacity = 0; }
  function resize() { clear(); }
  function render(now, mouse) {
    if (destroyed || !context || !mouse || mouse.active === false || !Number.isFinite(now)
        || !Number.isFinite(mouse.x) || !Number.isFinite(mouse.y)) { clear(); return false; }
    const moved = !pointer || Math.hypot(mouse.x - pointer.x, mouse.y - pointer.y) > .15;
    if (moved) {
      if (!active) appearedAt = now;
      lastMoveAt = now;
      active = true;
    }
    // No inertia or offset: the drawn centre always uses the current CSS point.
    pointer = {x: mouse.x, y: mouse.y};
    const stillMs = Math.max(0, now - lastMoveAt);
    if (!active || stillMs >= fadeEndMs) { active = false; opacity = 0; return false; }
    const attack = smooth((now - appearedAt) / 55);
    const fade = 1 - smooth((stillMs - fadeAfterMs) / (fadeEndMs - fadeAfterMs));
    // Narrow, low-contrast glints vary only this tiny star, never its position.
    const twinkle = .82 + .18 * Math.pow(Math.max(0, Math.sin(now * .009)), 6);
    opacity = attack * fade * twinkle;
    const {x, y} = pointer;
    context.save(); context.globalCompositeOperation = 'lighter';
    if (glowContext) {
      context.globalAlpha = opacity * .6; context.drawImage(glow, x - 7, y - 7, 14, 14);
      context.globalAlpha = opacity * .4; context.drawImage(glow, x - 3, y - 3, 6, 6);
    }
    context.fillStyle = '#bce7fa';
    for (let arm = 0; arm < 8; arm++) {
      const angle = arm * Math.PI / 4, diagonal = arm % 2 !== 0;
      const radius = (diagonal ? diagonalRadius : mainRadius) * (.94 + twinkle * .06);
      const dx = Math.cos(angle), dy = Math.sin(angle), halfWidth = diagonal ? .24 : .4;
      context.globalAlpha = opacity * (diagonal ? .25 : .46);
      context.beginPath(); context.moveTo(x - dy * halfWidth, y + dx * halfWidth);
      context.lineTo(x + dx * radius, y + dy * radius);
      context.lineTo(x + dy * halfWidth, y - dx * halfWidth); context.closePath(); context.fill();
    }
    context.globalAlpha = opacity * .65; context.fillStyle = '#e2f4fc';
    context.beginPath(); context.arc(x, y, .6, 0, Math.PI * 2); context.fill();
    context.restore(); return true;
  }
  function destroy() { clear(); destroyed = true; glow.width = glow.height = 1; }
  function getMetadata() { return {active, count: active ? 1 : 0, style: 'cursor-star', pointer,
    center: pointer ? {...pointer} : null, opacity, mainRadius, diagonalRadius, lastMoveAt, fadeEndMs}; }
  return Object.freeze({render, resize, clear, destroy, getMetadata});
}
