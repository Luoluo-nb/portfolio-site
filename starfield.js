/* Adapted from the Image shader supplied by the user,
 * reference https://www.shadertoy.com/view/tllfRX.
 * Retains layered depth travel, star rays, Hash21 and colored twinkle;
 * exposure, saturation and motion are reduced for foreground readability.
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
// Smoothed pointer displacement in CSS pixels, bounded to a 10 px circle.
uniform vec2 uPointer;
uniform float uTime;
uniform vec3 uAudio;
uniform float uLayers;

const float TAU = 6.283185;
const float VELOCITY = 0.010;
const float STAR_GLOW = 0.008;
const float CANVAS_VIEW = 20.0;
const float EXPOSURE = 0.32;

float Hash21(vec2 p) {
#ifdef GL_FRAGMENT_PRECISION_HIGH
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
#else
  // Keep fractional bits on fragment processors with only mediump precision.
  return fract(sin(dot(mod(p, 113.0), vec2(1.271, 3.117))) * 7.13);
#endif
}

float Star(vec2 uv, float flare) {
  float d = length(uv);
  // Bound the supplied 1/d core at its centre to prevent NaN/Inf pixels.
  float light = sin(STAR_GLOW * 1.2) / max(d, 0.0015);
  float rays = max(0.0, 0.5 - abs(uv.x * uv.y * 1000.0));
  light += rays * flare * 2.0;
  // Ascending smoothstep is defined on every driver; shorter falloff prevents
  // broad overlapping glow while preserving the reference's fine star rays.
  return light * (1.0 - smoothstep(0.035, 0.38, d));
}

vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv) - 0.5;
  vec2 id = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      float n = Hash21(id + offset);
      // Leave more space between near points so they do not resemble snow.
      if (n < 0.40) continue;
      float size = fract(n);
      vec2 starUV = gv - offset - vec2(n, fract(n * 34.0)) + 0.5;
      if (dot(starUV, starUV) > 0.1444) continue;
      float flare = smoothstep(0.10, 0.90, size) * 0.10;
      float star = Star(starUV, flare);
      vec3 originalColor = (sin(vec3(0.2, 0.3, 0.9) * fract(n * 2345.2) * TAU) * 0.25 + 0.75)
                           * vec3(0.9, 0.59, 0.9 + size);
      float luminance = dot(originalColor, vec3(0.2126, 0.7152, 0.0722));
      vec3 color = mix(vec3(luminance), originalColor, 0.22) * vec3(0.86, 0.93, 1.0);
      float twinkle = sin(uTime * 0.34 + n * TAU) * 0.22 + 0.78;
      // Only measured music bands affect this pulse; silence contributes zero.
      float audioPulse = 1.0 + (uAudio.x * 0.08 + uAudio.z * 0.15) * (0.25 + size * 0.75);
      col += star * size * color * twinkle * audioPulse;
    }
  }
  return col;
}

void main() {
  vec2 uv = (vUv - 0.5) * uResolution / max(uResolution.y, 1.0);
  vec2 pointer = uPointer / max(uViewSize.y, 1.0) * 0.7;
  vec2 orbit = vec2(-sin(uTime * 0.07), cos(uTime * 0.07)) * 0.06;
  vec3 col = vec3(0.0);
  float travel = uTime * VELOCITY;
  for (int layer = 0; layer < 8; layer++) {
    if (float(layer) >= uLayers) break;
    float i = float(layer) / uLayers;
    float depth = fract(i + travel);
    float scale = mix(CANVAS_VIEW, 0.65, depth);
    // Both ends fade to zero, so the near-to-far wrap has no hard jump.
    // Staggered depths populate the very first frame, including on mobile.
    float fade = depth * (1.0 - smoothstep(0.90, 1.0, depth));
    if (fade < 0.001) continue;
    col += StarLayer(uv * scale + i * 453.2 - uTime * 0.006 + orbit + pointer) * fade;
  }
  vec3 color = col * EXPOSURE;
  color = min(color / (1.0 + color * 1.7), vec3(0.42));
  // Premultiplied output: do not attenuate the star light by alpha a second time.
  float alpha = max(max(color.r, color.g), color.b);
  gl_FragColor = vec4(color, alpha);
}
`;

export class Starfield {
  constructor(canvas, { reducedMotion, onStatus = () => {} } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('Starfield requires a canvas.');
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.originalOpacity = canvas.style.opacity;
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = Boolean(reducedMotion) || this.motionQuery.matches;
    this.paused = false;
    this.pageActive = true;
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
    this._listen(window, 'pagehide', () => { this.pageActive = false; this._stop(); });
    this._listen(window, 'pageshow', () => { this.pageActive = true; this._sync(); });
    this._listen(window, 'resize', () => this._resize());
    this._listen(window, 'pointermove', event => {
      if (event.pointerType !== 'mouse' || !this.pointerQuery.matches || this.reducedMotion
          || this.paused || this.destroyed || document.hidden) return;
      const nx = (event.clientX - this.viewSize.left) / Math.max(this.viewSize.width, 1) * 2 - 1;
      const ny = 1 - (event.clientY - this.viewSize.top) / Math.max(this.viewSize.height, 1) * 2;
      const radius = Math.max(1, Math.hypot(nx, ny));
      this.pointer.targetX = nx / radius * 10;
      this.pointer.targetY = ny / radius * 10;
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
        audio: gl.getUniformLocation(program, 'uAudio'),
        layers: gl.getUniformLocation(program, 'uLayers'),
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
    const compact = rect.width <= 600;
    this.layerCount = compact ? 4 : 8;
    const pixelBudget = compact ? 180000 : 520000;
    this.canvas.dataset.layers = String(this.layerCount);
    this.canvas.dataset.pixelBudget = String(pixelBudget);
    const scale = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(pixelBudget / area)) * this.resolutionScale;
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
    const levels = !this.reducedMotion && this.pageActive && !document.hidden
      ? window.PortfolioAudioAnalysis?.getLevels() : null;
    gl.uniform3f(this.uniforms.audio, levels?.bass || 0, levels?.mid || 0, levels?.treble || 0);
    gl.uniform1f(this.uniforms.layers, this.layerCount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _tick(now) {
    this.frame = 0;
    if (!this.ready || this.destroyed || !this.pageActive || this.paused || this.reducedMotion || document.hidden) return;
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
    if (!this.ready || this.destroyed || !this.pageActive || document.hidden) return;
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
