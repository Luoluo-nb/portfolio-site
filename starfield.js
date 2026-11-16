/* Original, texture-free background shader.
 * Usage: new Starfield(canvas, { reducedMotion, onStatus: ({ state }) => {} }).
 * Position the canvas with CSS; keep a static CSS background beneath it.
 * setPaused(true) freezes the sky. destroy() releases its listeners and GPU objects.
 */
const VERTEX = `
attribute vec2 aPosition;
varying mediump vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying mediump vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uViewSize;
// Smoothed pointer displacement in CSS pixels, bounded to an 18 px circle.
uniform vec2 uPointer;
uniform float uTime;

float hash(vec2 p) {
  // The fallback stays in mediump's range, including its fractional component.
  p = mod(p, 113.0);
#ifdef GL_FRAGMENT_PRECISION_HIGH
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
#else
  return fract(sin(dot(p, vec2(1.271, 3.117))) * 7.13);
#endif
}

// x: crisp star aperture, y: Gaussian light spill, z: independent brightness.
// These are masks, not solid discs; the lower light layer supplies their color.
vec3 starMask(vec2 p, float cells, float density, float size, float seed) {
  vec2 q = p * cells + vec2(seed, seed * 0.37);
  vec2 cell = floor(q);
  float choice = hash(cell + seed * 1.73);
  // Most cells contain no star: skip their remaining hashes and light math.
  if (choice < 1.0 - density) return vec3(0.0);
  // A sparse, randomly offset point in each selected cell. The generous inset
  // keeps its tiny halo inside the cell, so no expensive neighbour search is needed.
  vec2 center = 0.22 + 0.56 * vec2(hash(cell + 7.17), hash(cell + 31.83));
  float distance = length(fract(q) - center);
  float pixel = cells / max(min(uResolution.x, uResolution.y), 1.0);
  float radius = pixel * size * mix(0.65, 1.2, hash(cell + 19.41));
  float core = 1.0 - smoothstep(radius * 0.15, radius + pixel * 0.7, distance);
  // A compact analytic blur replaces a full-screen bloom framebuffer/pass.
  // Its weak Gaussian tail has no sharp outer ring or large circular boundary.
  float blurRadius = min(radius * 1.65 + pixel * 0.35, 0.073);
  float blurredDistance = distance / max(blurRadius, 0.0001);
  float halo = exp(-0.5 * blurredDistance * blurredDistance);
  float phase = hash(cell + 55.1) * 6.283185;
  float twinkle = 0.72 + 0.28 * sin(uTime * (0.65 + hash(cell + 9.31) * 1.2) + phase);
  // Occasional bright pinpoints, with independent timing instead of a shared pulse.
  float sparkle = pow(max(0.0, sin(uTime * 0.85 + phase)), 12.0) * 0.28;
  return vec3(core, halo, twinkle + sparkle);
}

void main() {
  vec2 p = (vUv - 0.5) * uResolution / max(min(uResolution.x, uResolution.y), 1.0);
  // CSS pixels keep pointer travel identical when the GPU resolution adapts.
  vec2 parallax = uPointer / max(min(uViewSize.x, uViewSize.y), 1.0);
  // Gentle common drift with depth: the nearest points move about 6 px/s.
  vec2 drift = vec2(uTime * 0.0048, uTime * -0.0016);

  // Independent orientations, cell sizes and seeds break up the underlying grids.
  mat2 middleRotation = mat2(0.8, 0.6, -0.6, 0.8);
  mat2 nearRotation = mat2(0.6, -0.8, 0.8, 0.6);
  // Small screens keep enough separation between points to read the copy.
  float spread = clamp(min(uViewSize.x, uViewSize.y) / 700.0, 0.65, 1.0);
  vec3 far = starMask(p + drift * 0.22 + parallax * 0.18,
                     76.0 * spread, 0.115, 0.45, 8.1);
  vec3 middle = starMask(middleRotation * (p + drift * 0.60 + parallax * 0.50),
                        43.0 * spread, 0.095, 0.72, 43.2);
  vec3 near = starMask(nearRotation * (p + drift * 1.35 + parallax),
                      19.0 * spread, 0.075, 1.10, 77.6);
  if (far.z + middle.z + near.z < 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Layer 1: deep, gently varying blue-white illumination and distant stars.
  // This field is never drawn on its own: only tiny star apertures reveal it.
  // Moving the front mask therefore exposes a different, slower-moving layer.
  vec2 deepUV = p + drift * 0.08 + parallax * 0.06;
  float lightVariation = 0.5 + 0.5 * sin(deepUV.x * 2.3 + deepUV.y * 1.1
                                      + sin(deepUV.y * 3.7) * 0.45);
  vec3 deepLight = mix(vec3(0.72, 0.84, 1.0), vec3(0.91, 0.95, 1.0), lightVariation);
  float distantCore = far.x * far.z * 0.60;
  float distantBloom = far.y * far.z * 0.035;
  float distantAlpha = min(distantCore + distantBloom, 0.84);
  vec3 distantColor = (deepLight * distantCore + vec3(0.34, 0.54, 0.80) * distantBloom)
                     * distantAlpha / max(distantCore + distantBloom, 0.0001);

  // Layer 2: a soft foreground aperture mask. White cores stay fine and clear;
  // color and alpha both weaken toward the edge, with only a trace of bloom.
  float frontCore = middle.x * middle.z * 0.80 + near.x * near.z * 1.02;
  float frontBloom = middle.y * middle.z * 0.050 + near.y * near.z * 0.075;
  float frontAlpha = min(frontCore + frontBloom, 0.96);
  vec3 foreground = (deepLight * frontCore + vec3(0.34, 0.56, 0.86) * frontBloom)
                    * frontAlpha / max(frontCore + frontBloom, 0.0001);

  // Premultiplied-alpha over: actual two-layer compositing, not grid speed alone.
  vec3 color = foreground + distantColor * (1.0 - frontAlpha);
  float alpha = frontAlpha + distantAlpha * (1.0 - frontAlpha);
  gl_FragColor = vec4(color, alpha);
}`;

export class Starfield {
  constructor(canvas, { reducedMotion, onStatus = () => {} } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('Starfield requires a canvas.');
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.originalOpacity = canvas.style.opacity;
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = Boolean(reducedMotion) || this.motionQuery.matches;
    this.paused = false;
    this.destroyed = false;
    this.ready = false;
    this.frame = 0;
    this.lastDraw = 0;
    this.time = 0;
    this.resolutionScale = 1;
    this.frameTimes = [];
    this.listeners = [];
    this.viewSize = { width: 1, height: 1, left: 0, top: 0 };
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    this._tick = this._tick.bind(this);

    this._listen(document, 'visibilitychange', () => this._sync());
    this._listen(window, 'resize', () => this._resize());
    this._listen(window, 'pointermove', event => {
      if (event.pointerType !== 'mouse' || !this.pointerQuery.matches || this.reducedMotion
          || this.paused || this.destroyed || document.hidden) return;
      const nx = (event.clientX - this.viewSize.left) / Math.max(this.viewSize.width, 1) * 2 - 1;
      const ny = 1 - (event.clientY - this.viewSize.top) / Math.max(this.viewSize.height, 1) * 2;
      const radius = Math.max(1, Math.hypot(nx, ny));
      this.pointer.targetX = nx / radius * 18;
      this.pointer.targetY = ny / radius * 18;
    });
    const releasePointer = () => { this.pointer.targetX = 0; this.pointer.targetY = 0; };
    this._listen(window, 'blur', releasePointer);
    this._listen(document, 'pointerout', event => { if (!event.relatedTarget) releasePointer(); });
    this._listen(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      this.ready = false;
      this._stop();
      this.canvas.style.opacity = '0';
      this._status('lost');
    });
    this._listen(canvas, 'webglcontextrestored', () => this._initialize());
    this.motionChanged = event => {
      this.reducedMotion = event.matches;
      this._sync();
    };
    if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', this.motionChanged);
    else this.motionQuery.addListener(this.motionChanged);
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(canvas);
    }
    this._initialize();
  }

  _listen(target, type, callback) {
    target.addEventListener(type, callback);
    this.listeners.push([target, type, callback]);
  }

  _status(state) {
    this.onStatus({ state });
  }

  _initialize() {
    if (this.destroyed) return;
    this._stop();
    const gl = this.canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, powerPreference: 'low-power',
    });
    if (!gl) { this.canvas.style.opacity = '0'; this._status('unavailable'); return; }
    this.gl = gl;
    let vertex, fragment, program, buffer;
    try {
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Unable to create starfield shader.');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const info = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(info || 'Starfield shader compilation failed.');
        }
        return shader;
      };
      vertex = compile(gl.VERTEX_SHADER, VERTEX);
      fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram();
      if (!program) throw new Error('Unable to create starfield program.');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Starfield linking failed.');
      buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to create starfield buffer.');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.program = program;
      this.buffer = buffer;
      this.uniforms = {
        resolution: gl.getUniformLocation(program, 'uResolution'),
        viewSize: gl.getUniformLocation(program, 'uViewSize'),
        pointer: gl.getUniformLocation(program, 'uPointer'),
        time: gl.getUniformLocation(program, 'uTime'),
      };
      this.maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
      this.ready = true;
      this.canvas.style.opacity = this.originalOpacity;
      this._resize();
      this._status('ready');
      this._sync();
    } catch (error) {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      this.ready = false;
      this.canvas.style.opacity = '0';
      this._status('unavailable');
      console.warn('Starfield:', error.message);
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }

  _resize() {
    if (!this.ready || this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    this.viewSize = { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
    const area = Math.max(1, rect.width * rect.height);
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1100000 / area)) * this.resolutionScale;
    const width = Math.max(1, Math.min(this.maxSize, Math.round(rect.width * scale)));
    const height = Math.max(1, Math.min(this.maxSize, Math.round(rect.height * scale)));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
    this._draw();
  }

  _draw() {
    if (!this.ready || this.destroyed) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.viewSize, this.viewSize.width, this.viewSize.height);
    gl.uniform2f(this.uniforms.pointer, this.pointer.x, this.pointer.y);
    gl.uniform1f(this.uniforms.time, this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _tick(now) {
    this.frame = 0;
    if (!this.ready || this.destroyed || this.paused || this.reducedMotion || document.hidden) return;
    const elapsed = this.lastDraw ? now - this.lastDraw : 34;
    // A fixed background does not need to render at the display's refresh rate.
    if (elapsed >= 32) {
      this.lastDraw = now;
      const seconds = Math.min(elapsed, 100) / 1000;
      this.time += seconds;
      // Exponential easing is frame-rate independent; no input work on touch.
      const easing = 1 - Math.exp(-seconds * 4.5);
      this.pointer.x += (this.pointer.targetX - this.pointer.x) * easing;
      this.pointer.y += (this.pointer.targetY - this.pointer.y) * easing;
      this._draw();
      // Visibility changes reset lastDraw, so genuinely slow frames should also
      // reduce resolution instead of being mistaken for time spent in another tab.
      this.frameTimes.push(Math.min(elapsed, 500));
      if (this.frameTimes.length === 60) {
        const average = this.frameTimes.reduce((sum, time) => sum + time, 0) / 60;
        this.frameTimes.length = 0;
        if (average > 46 && this.resolutionScale > 0.55) {
          this.resolutionScale = Math.max(0.55, this.resolutionScale - 0.15);
          this._resize();
        }
      }
    }
    this.frame = requestAnimationFrame(this._tick);
  }

  _stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastDraw = 0;
    this.frameTimes.length = 0;
  }

  _sync() {
    this._stop();
    if (!this.ready || this.destroyed || document.hidden) return;
    this._draw();
    if (!this.paused && !this.reducedMotion) this.frame = requestAnimationFrame(this._tick);
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this._sync();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._stop();
    this.resizeObserver?.disconnect();
    this.listeners.forEach(([target, type, callback]) => target.removeEventListener(type, callback));
    this.listeners.length = 0;
    if (this.motionQuery.removeEventListener) this.motionQuery.removeEventListener('change', this.motionChanged);
    else this.motionQuery.removeListener(this.motionChanged);
    if (this.gl && !this.gl.isContextLost()) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.canvas.style.opacity = this.originalOpacity;
    this.ready = false;
  }
}
