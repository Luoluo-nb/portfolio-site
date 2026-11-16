/* One shared, lazily created WebGL surface for desktop button hovers.
 * The isolated button paints its own background before negative-z descendants;
 * the canvas therefore sits above that background and below all button copy.
 * Selection, focus, clicks and the CSS border effect remain independent.
 */
const selector = '.header nav a,.category-tabs button,.subcategory-row button,.language-switch button,.music-button,.action,.project-detail-link,.back-button,.video-chapters button';
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const canvas = document.createElement('canvas');
canvas.id = 'button-hover-canvas';
canvas.dataset.state = 'idle';
canvas.dataset.noTranslate = '';
canvas.setAttribute('aria-hidden', 'true');
Object.assign(canvas.style, {
  position: 'absolute', inset: '0', width: '100%', height: '100%',
  pointerEvents: 'none', zIndex: '-1', opacity: '0', display: 'none',
  borderRadius: 'inherit', transition: 'opacity 120ms linear',
});
document.body.append(canvas);

const vertexSource = `
attribute vec2 aPosition;
varying mediump vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying mediump vec2 vUv;
uniform vec2 uSize;
uniform float uTime;
uniform float uStrength;

float random(float n) { return fract(sin(n * 1.79 + 0.61) * 17.17); }
void main() {
  // Place the small vortex toward the trailing edge, away from the main label.
  float aspect = uSize.x / max(uSize.y, 1.0);
  vec2 p = (vUv - vec2(0.80, 0.50)) * vec2(aspect, 1.0);
  vec2 ellipse = p * vec2(0.88, 1.24);
  float radius = length(ellipse);
  float angle = atan(ellipse.y, ellipse.x);
  float pixel = 1.0 / max(uSize.y, 1.0);
  float horizon = 0.285;
  float ringDistance = (radius - horizon) / max(pixel * 0.85, 0.001);
  float blurDistance = (radius - horizon) / max(pixel * 3.2, 0.001);
  float ring = exp(-ringDistance * ringDistance);
  float bloom = exp(-blurDistance * blurDistance);
  float arc = 0.58 + 0.42 * cos(angle * 2.0 - uTime * 0.65);
  float light = ring * (0.25 + 0.20 * arc) + bloom * 0.055;

  // Eight fine orbiting points; no textures, framebuffer chain, or large haze.
  float particles = 0.0;
  for (int i = 0; i < 8; i++) {
    float seed = float(i) + 1.0;
    float orbit = horizon * mix(0.95, 1.75, random(seed));
    float phase = random(seed + 9.0) * 6.283185
                + uTime * mix(0.28, 0.52, random(seed + 17.0));
    vec2 point = vec2(cos(phase) / 0.88, sin(phase) / 1.24) * orbit;
    float distance = length(p - point) / max(pixel, 0.001);
    float core = exp(-distance * distance * 1.7);
    float glow = exp(-distance * distance * 0.22) * 0.07;
    float twinkle = 0.76 + 0.24 * sin(uTime * 1.2 + seed * 2.6);
    particles += (core + glow) * twinkle;
  }

  // Keep a translucent dark core with a thin blue-white rim, never a solid disc.
  float edge = smoothstep(0.0, 0.055, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  float luminance = (light + particles * 0.72) * uStrength * edge;
  float lightAlpha = min(luminance, 0.46);
  float darkAlpha = (1.0 - smoothstep(horizon * 0.45, horizon * 0.92, radius))
                    * uStrength * 0.24 * edge;
  vec3 tint = mix(vec3(0.30, 0.66, 1.0), vec3(0.86, 0.95, 1.0),
                  clamp(particles + ring * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(tint * lightAlpha, lightAlpha + darkAlpha * (1.0 - lightAlpha));
}`;

let gl, program, buffer, uniforms;
let ready = false;
let failed = false;
let destroyed = false;
let active = null;
let frame = 0;
let lastDraw = 0;
let time = 0;
let fadeTimer;
let width = 1;
let height = 1;
let strength = 0.22;
const cleanups = [];
const allowed = () => !destroyed && finePointer.matches && !reducedMotion.matches && !document.hidden;
const enabled = target => target?.isConnected && !target.matches(':disabled,[aria-disabled="true"]');

function listen(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  cleanups.push(() => target.removeEventListener(event, handler, options));
}
function watch(query, handler) {
  if (query.addEventListener) {
    query.addEventListener('change', handler);
    cleanups.push(() => query.removeEventListener('change', handler));
  } else {
    query.addListener(handler);
    cleanups.push(() => query.removeListener(handler));
  }
}
function discover(root) {
  if (!(root instanceof Element)) return;
  if (root.matches(selector)) root.classList.add('fx-button');
  for (const target of root.querySelectorAll(selector)) target.classList.add('fx-button');
}
function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  lastDraw = 0;
}
function draw() {
  if (!ready || !active || !allowed()) return;
  gl.useProgram(program);
  gl.uniform2f(uniforms.size, width, height);
  gl.uniform1f(uniforms.time, time);
  gl.uniform1f(uniforms.strength, strength);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function resize() {
  if (!ready || !active || !allowed()) return;
  const rect = active.getBoundingClientRect();
  width = Math.max(1, rect.width);
  height = Math.max(1, rect.height);
  const scale = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(48000 / (width * height)));
  const nextWidth = Math.max(1, Math.min(1024, Math.round(width * scale)));
  const nextHeight = Math.max(1, Math.min(256, Math.round(height * scale)));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  gl.viewport(0, 0, nextWidth, nextHeight);
  draw();
}
function tick(now) {
  frame = 0;
  if (!allowed() || !ready || !enabled(active)) { leave(true); return; }
  const elapsed = lastDraw ? now - lastDraw : 34;
  if (elapsed >= 32) {
    lastDraw = now;
    time += Math.min(elapsed, 80) / 1000;
    draw();
  }
  frame = requestAnimationFrame(tick);
}
function initialize() {
  if (ready) return true;
  if (failed || destroyed || !allowed()) return false;
  let vertex, fragment;
  let candidateProgram, candidateBuffer;
  try {
    // Repeated calls after context restoration reuse this same canvas/context.
    gl = canvas.getContext('webgl', { alpha:true, premultipliedAlpha:true,
      antialias:false, depth:false, stencil:false, powerPreference:'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader unavailable');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        throw new Error('Shader compilation failed');
      }
      return shader;
    };
    vertex = compile(gl.VERTEX_SHADER, vertexSource);
    fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    candidateProgram = gl.createProgram();
    if (!candidateProgram) throw new Error('Program unavailable');
    gl.attachShader(candidateProgram, vertex);
    gl.attachShader(candidateProgram, fragment);
    gl.linkProgram(candidateProgram);
    if (!gl.getProgramParameter(candidateProgram, gl.LINK_STATUS)) throw new Error('Link failed');
    candidateBuffer = gl.createBuffer();
    if (!candidateBuffer) throw new Error('Buffer unavailable');
    gl.bindBuffer(gl.ARRAY_BUFFER, candidateBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    gl.useProgram(candidateProgram);
    const position = gl.getAttribLocation(candidateProgram, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    program = candidateProgram;
    buffer = candidateBuffer;
    uniforms = {
      size: gl.getUniformLocation(program, 'uSize'),
      time: gl.getUniformLocation(program, 'uTime'),
      strength: gl.getUniformLocation(program, 'uStrength'),
    };
    ready = true;
    return true;
  } catch {
    if (candidateBuffer) gl.deleteBuffer(candidateBuffer);
    if (candidateProgram) gl.deleteProgram(candidateProgram);
    failed = true;
    canvas.dataset.state = 'fallback';
    return false;
  } finally {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}
const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
function enter(target) {
  if (!allowed() || !enabled(target)) return;
  if (target === active && ready && canvas.parentElement === target) return;
  clearTimeout(fadeTimer);
  stop();
  active = target;
  strength = target.matches('.action,.project-detail-link') ? 0.48 : 0.22;
  canvas.style.display = 'block';
  canvas.style.opacity = '0';
  target.append(canvas);
  resizeObserver?.disconnect();
  resizeObserver?.observe(target);
  if (!initialize()) { canvas.style.display = 'none'; return; }
  resize();
  canvas.dataset.state = 'ready';
  canvas.style.opacity = '1';
  frame = requestAnimationFrame(tick);
}
function leave(immediate = false) {
  clearTimeout(fadeTimer);
  stop();
  active = null;
  resizeObserver?.disconnect();
  canvas.style.opacity = '0';
  const finish = () => {
    canvas.style.display = 'none';
    canvas.dataset.state = failed ? 'fallback' : 'idle';
  };
  // Freeze the last GPU frame immediately; the 120 ms fade is compositor-only.
  if (immediate) finish();
  else fadeTimer = setTimeout(finish, 120);
}
function resumeHover() {
  if (!allowed()) { leave(true); return; }
  const hovered = [...document.querySelectorAll(selector)].find(target => target.matches(':hover') && enabled(target));
  if (hovered) enter(hovered);
}

discover(document.body);
const observer = new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) discover(node);
  if (active && !active.isConnected) leave(true);
  // Music state updates can replace a hovered icon button's innerHTML.
  else if (active && canvas.parentElement !== active && allowed()) {
    if (active.matches(':hover')) enter(active);
    else leave(true);
  }
});
observer.observe(document.body, { childList:true, subtree:true });
listen(document, 'pointerover', event => {
  if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
  const target = event.target.closest(selector);
  if (target) enter(target);
});
listen(document, 'pointerout', event => {
  if (!active) return;
  if (!(event.relatedTarget instanceof Node) || !active.contains(event.relatedTarget)) leave();
});
listen(window, 'blur', () => leave(true));
listen(window, 'resize', resize, { passive:true });
listen(document, 'visibilitychange', () => document.hidden ? leave(true) : resumeHover());
watch(finePointer, resumeHover);
watch(reducedMotion, resumeHover);
listen(canvas, 'webglcontextlost', event => {
  event.preventDefault();
  ready = false;
  stop();
  canvas.style.opacity = '0';
  canvas.dataset.state = 'fallback';
});
listen(canvas, 'webglcontextrestored', () => {
  failed = false;
  if (active && allowed()) enter(active);
  else canvas.dataset.state = 'idle';
});

export function destroyHoverEffects() {
  if (destroyed) return;
  leave(true);
  destroyed = true;
  observer.disconnect();
  resizeObserver?.disconnect();
  cleanups.splice(0).forEach(cleanup => cleanup());
  if (gl && !gl.isContextLost()) {
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  ready = false;
  canvas.remove();
}
listen(window, 'pagehide', event => {
  if (event.persisted) leave(true);
  else destroyHoverEffects();
});
listen(window, 'pageshow', event => { if (event.persisted) resumeHover(); });
