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

const AUDIO_SCENE_GAIN = Object.freeze({home: 1, content: .24});
const FRAME_INTERVAL = 1000 / 24;
const DEPTH_SPEED = Object.freeze({ambient: .010, audio: .030});
const RAY_QUALITY = Object.freeze({desktopSamples:55, mobileSamples:24, desktopPixels:32768, mobilePixels:12288});
// Retain scattering, but tone-map it with the sky rather than adding it after
// exposure. Background contrast is independent of the foreground UI effects.
// The previous shaft strength is now the reference at one-third output volume.
// The slider controls the main gain; RMS adds only the existing small variation.
const RAY_RESPONSE = Object.freeze({base:.46, loudnessGain:.10, referenceVolume:1/3});

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
uniform float uTravel;
uniform vec2 uPulse; // lagged beat, immersive-home blend
uniform float uLayers;

const float TAU = 6.283185;
const float STAR_GLOW = 0.0135;
const float CANVAS_VIEW = 20.0;
const float EXPOSURE = 0.65;

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
  return light * (1.0 - smoothstep(0.025, 0.24, d));
}

vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv) - 0.5;
  vec2 id = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      // Every candidate star lies inside this unit cell. Reject cells farther
      // than the existing .24 support radius before hashing or twinkling them.
      vec2 cellGap = max(abs(gv - offset) - .5, vec2(0.));
      if (dot(cellGap, cellGap) > .0576) continue;
      float n = Hash21(id + offset);
      // Leave more space between near points so they do not resemble snow.
      if (n < 0.40) continue;
      float size = fract(n);
      vec2 starUV = gv - offset - vec2(n, fract(n * 34.0)) + 0.5;
      if (dot(starUV, starUV) > 0.0576) continue;
      float flare = smoothstep(0.10, 0.90, size) * 0.15;
      // A few denser white anchors, not larger translucent glow discs.
      float primary=step(.975,size);
      float star = Star(starUV/(1.+primary*.14), flare*(1.+primary*.35))*(1.+primary*.18);
      vec3 originalColor = (sin(vec3(0.2, 0.3, 0.9) * fract(n * 2345.2) * TAU) * 0.25 + 0.75)
                           * vec3(0.9, 0.59, 0.9 + size);
      float luminance = dot(originalColor, vec3(0.2126, 0.7152, 0.0722));
      // Draft balance favours cold white; a stable hash keeps colour independent
      // of beat amplitude and motion. Primary points are always cool white.
      float hue = fract(n * 571.3);
      vec3 tint = hue < .45 ? vec3(.60,.79,1.) : hue < .95 ? vec3(.95,.97,1.) : vec3(1.,.66,.82);
      tint=mix(tint,vec3(.96,.98,1.),primary);
      vec3 color = tint * luminance;
      float twinkle = sin(uTime * 0.34 + n * TAU) * 0.22 + 0.78;
      // Only measured music bands affect this pulse; silence contributes zero.
      float audioPulse = 1.0 + uPulse.x * .035 * (0.25 + size * 0.75);
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
  float travel = uTravel;
  for (int layer = 0; layer < 8; layer++) {
    if (float(layer) >= uLayers) break;
    float i = float(layer) / uLayers;
    float depth = fract(i + travel);
    // Both ends fade to zero, so the near-to-far wrap has no hard jump.
    // Staggered depths populate the very first frame, including on mobile.
    float fade = depth * (1.0 - smoothstep(0.90, 1.0, depth));
    if (fade < 0.001) continue;
    float scale = mix(CANVAS_VIEW, 0.65, depth);
    col += StarLayer(uv * scale + i * 453.2 - uTime * 0.006 + orbit + pointer) * fade;
  }
  vec3 color = col * EXPOSURE;
  // Keep the source bounded by the RGBA8 target. Final display composition
  // gives these points a soft shoulder rather than a saturated cubic core.
  color = max(color, vec3(0.0));
  // RGB is the visible starfield; alpha supplies only those same stars to
  // radial scattering. No additional disc/light mass fills the dark sky.
  // This bounded source is separate from the final screen alpha.
  float source=clamp(dot(color,vec3(.2126,.7152,.0722))*5.,0.,1.);
  gl_FragColor = vec4(color, source);
}
`;

// Adapted from the radial Godray code supplied by the user. Texture samples
// come from our own offscreen scene, never from an embedded video.
const RAY_FRAGMENT = `
precision mediump float;
varying mediump vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uRayOffset;
uniform float uSamples,uDensity;
void main(){
 vec2 tc=vUv;
 vec2 center=vec2(.5)-uRayOffset;
 vec2 delta=(vUv-center)*(uDensity/uSamples);
 float color=texture2D(uScene,tc).a*.305104;
 float illuminationDecay=1.;
 for(int i=0;i<55;i++){
  if(float(i)>=uSamples)break;
  tc-=delta;
  float sampleValue=texture2D(uScene,tc).a*.305104;
  sampleValue*=illuminationDecay*.58767;
  color+=sampleValue;
  illuminationDecay*=.96815;
 }
 gl_FragColor=vec4(vec3(color*.21),1.);
}`;
const COMPOSITE_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying mediump vec2 vUv;
uniform sampler2D uScene,uRays;
uniform float uRayStrength;
// Design draft: atmospheric colour is already in display space and remains
// independent of light exposure, so dark blue does not collapse to flat black.
const float BASE_DISPLAY_GAIN=1.22;
const float LIGHT_EXPOSURE=.32;
const float LIGHT_SATURATION=.32;
const float RAY_STYLE_GAIN=.62;
float grain(vec2 p){
 // Fixed screen-space interleaved gradient noise: sub-LSB, no temporal sparkle.
 return fract(52.9829189*fract(dot(mod(p,256.),vec2(.06711056,.00583715))));
}
void main(){
 vec2 uv=vUv;
 // Resolve the atmospheric background here at full precision, before output
 // quantization. Opaque composition avoids a second low-alpha 8-bit gradient.
 vec2 cssUv=vec2(uv.x,1.-uv.y);
 vec3 baseColor=vec3(3.,6.,14.)/255.;
 vec2 blueDelta=(cssUv-vec2(.8,.08))/vec2(.78,.7),blushDelta=(cssUv-vec2(.12,.87))/vec2(.7,.72);
 float blue=exp(-dot(blueDelta,blueDelta))*.12;
 float blush=exp(-dot(blushDelta,blushDelta))*.035;
 baseColor=mix(baseColor,vec3(8.,19.,34.)/255.,blue);
 baseColor=mix(baseColor,vec3(18.,10.,23.)/255.,blush);
 baseColor*=BASE_DISPLAY_GAIN;
 vec3 sceneLight=texture2D(uScene,uv).rgb;
 sceneLight+=texture2D(uRays,uv).rgb*vec3(.27,.48,.72)*uRayStrength*RAY_STYLE_GAIN;
 float lightValue=dot(sceneLight,vec3(.2126,.7152,.0722));
 sceneLight=mix(vec3(lightValue),sceneLight,LIGHT_SATURATION);
 vec3 softLight=(vec3(1.)-exp(-max(sceneLight,vec3(0.))*1.1))*LIGHT_EXPOSURE;
 vec3 color=baseColor+softLight;
 color+=vec3((grain(gl_FragCoord.xy)-.5)/255.);
 gl_FragColor=vec4(clamp(color,vec3(0.),vec3(1.)),1.);
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
    this.pageActive = true;
    this.destroyed = false;
    this.ready = false;
    this.frame = 0;
    this.lastDraw = 0;
    this.nextDraw = 0;
    this.diagnosticsAt = -Infinity;
    this.time = 0;
    this.baseTime = 0;
    this.audioOffset = 0;
    this.audioSpeed = 0;
    this.travel = 0;
    this.heroMix = 0;
    this.heroTarget = 0;
    this.sceneMeasuredAt = -1000;
    this.audioLevels = null;
    this.rayVolume = 0;
    this.resolutionScale = 1;
    this.frameTimes = [];
    this.listeners = [];
    this.viewSize = { width: 1, height: 1, left: 0, top: 0 };
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    // WebGL UVs point upward: (0.5, 1) is the visible top centre.
    this.rayCenter = { x: .5, y: 1 };
    this.pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    this._tick = this._tick.bind(this);

    this._listen(document, 'visibilitychange', () => this._sync());
    // Reduced motion still updates the static composition when navigating.
    this._listen(window, 'scroll', () => { if (this.reducedMotion) this._sync(); });
    this._listen(window, 'hashchange', () => { if (this.reducedMotion) queueMicrotask(() => this._sync()); });
    this._listen(window, 'pagehide', () => { this.pageActive = false; this._stop(); });
    this._listen(window, 'pageshow', () => { this.pageActive = true; this._sync(); });
    this._listen(window, 'resize', () => { this._resize(); });
    this._listen(window, 'pointermove', event => {
      if (event.pointerType !== 'mouse' || !this.pointerQuery.matches || this.reducedMotion
          || this.paused || this.destroyed || document.hidden) return;
      const nx = (event.clientX - this.viewSize.left) / Math.max(this.viewSize.width, 1) * 2 - 1;
      const ny = 1 - (event.clientY - this.viewSize.top) / Math.max(this.viewSize.height, 1) * 2;
      const radius = Math.max(1, Math.hypot(nx, ny));
      this.pointer.targetX = nx / radius * 10;
      this.pointer.targetY = ny / radius * 10;
      // Independent of the starfield's intentionally tiny eased parallax.
      this.rayCenter.x = Math.max(0, Math.min(1, (nx + 1) * .5));
      this.rayCenter.y = Math.max(0, Math.min(1, (ny + 1) * .5));
    });
    const releasePointer = () => {
      this.pointer.targetX = 0; this.pointer.targetY = 0;
      this.rayCenter.x = .5; this.rayCenter.y = 1;
    };
    this._listen(this.pointerQuery, 'change', () => { releasePointer(); this._draw(); });
    this._listen(window, 'blur', releasePointer);
    this._listen(window, 'blur', () => { this._draw(); });
    this._listen(document, 'pointerout', event => { if (event.pointerType==='mouse'&&!event.relatedTarget) { releasePointer(); } });
    this._listen(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      this.ready = false;
      this._stop();
      this._releaseTargets();
      this.canvas.style.opacity = '0';
      this._status('lost');
    });
    this._listen(canvas, 'webglcontextrestored', () => this._initialize());
    this.motionChanged = event => {
      this.reducedMotion = event.matches;
      if (this.reducedMotion) releasePointer();
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
    this.canvas.dataset.rendering = state;
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
    let vertex, fragment, program, buffer, rayProgram, compositeProgram;
    const extraShaders = [];
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
      gl.bindAttribLocation(program, 0, 'aPosition');
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
      const makePass = source => {
        const shader = compile(gl.FRAGMENT_SHADER, source); extraShaders.push(shader);
        const pass = gl.createProgram(); gl.attachShader(pass, vertex); gl.attachShader(pass, shader);
        gl.bindAttribLocation(pass, 0, 'aPosition'); gl.linkProgram(pass);
        if (!gl.getProgramParameter(pass, gl.LINK_STATUS)) { const info = gl.getProgramInfoLog(pass); gl.deleteProgram(pass); throw new Error(info || 'Scattering pass failed.'); }
        return pass;
      };
      this.rayProgram = rayProgram = makePass(RAY_FRAGMENT);
      this.compositeProgram = compositeProgram = makePass(COMPOSITE_FRAGMENT);
      this.uniforms = {
        resolution: gl.getUniformLocation(program, 'uResolution'),
        viewSize: gl.getUniformLocation(program, 'uViewSize'),
        pointer: gl.getUniformLocation(program, 'uPointer'),
        time: gl.getUniformLocation(program, 'uTime'),
        travel: gl.getUniformLocation(program, 'uTravel'),
        pulse: gl.getUniformLocation(program, 'uPulse'),
        layers: gl.getUniformLocation(program, 'uLayers'),
      };
      this.rayUniforms = Object.fromEntries(['Scene','RayOffset','Samples','Density'].map(n => [n,gl.getUniformLocation(rayProgram,'u'+n)]));
      this.compositeUniforms = Object.fromEntries(['Scene','Rays','RayStrength'].map(n => [n,gl.getUniformLocation(compositeProgram,'u'+n)]));
      this.maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
      this.ready = true;
      this.canvas.style.opacity = this.originalOpacity;
      this._resize();
      if (!this.ready) return;
      this._status('ready');
      this._sync();
    } catch (error) {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (rayProgram) gl.deleteProgram(rayProgram);
      if (compositeProgram) gl.deleteProgram(compositeProgram);
      this._releaseTargets();
      this.ready = false;
      this.canvas.style.opacity = '0';
      this._status('unavailable');
      console.warn('Starfield:', error.message);
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      extraShaders.forEach(shader => gl.deleteShader(shader));
    }
  }

  _releaseTargets() {
    for (const target of [this.sceneTarget,this.rayTarget]) if (target && this.gl && !this.gl.isContextLost()) {
      this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.framebuffer);
    }
    this.sceneTarget = this.rayTarget = null;
  }

  _makeTarget(width,height) {
    const gl=this.gl,texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);throw new Error('Starfield target unavailable.');}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); return {texture,framebuffer,width,height};
  }

  _resize() {
    if (!this.ready || this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    this.viewSize = { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
    const area = Math.max(1, rect.width * rect.height);
    const compact = rect.width <= 600;
    this.layerCount = compact ? 4 : 8;
    this.raySamples = compact ? RAY_QUALITY.mobileSamples : RAY_QUALITY.desktopSamples;
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
    const rayScale=Math.min(.5,Math.sqrt((compact?RAY_QUALITY.mobilePixels:RAY_QUALITY.desktopPixels)/(width*height)));
    const rayWidth=Math.max(1,Math.floor(width*rayScale)),rayHeight=Math.max(1,Math.floor(height*rayScale));
    if(!this.sceneTarget||this.sceneTarget.width!==width||this.sceneTarget.height!==height||this.rayTarget.width!==rayWidth||this.rayTarget.height!==rayHeight){
      this._releaseTargets();
      try{this.sceneTarget=this._makeTarget(width,height);this.rayTarget=this._makeTarget(rayWidth,rayHeight);}
      catch(error){this._releaseTargets();this.ready=false;this._stop();this.canvas.style.opacity='0';this._status('unavailable');return;}
    }
    this.canvas.dataset.raySamples=String(this.raySamples); this.canvas.dataset.rayPixels=String(rayWidth*rayHeight);
    this._draw();
  }

  _homeVisibility() {
    const hero = document.querySelector('#top');
    const rect = hero && !hero.hidden ? hero.getBoundingClientRect() : null;
    return rect ? Math.max(0, Math.min(1, (rect.bottom - 100) / Math.max(innerHeight * .65, 1))) : 0;
  }

  _draw(now = performance.now()) {
    if (!this.ready || this.destroyed || !this.sceneTarget || !this.rayTarget) return;
    const gl = this.gl;
    const levels = !this.reducedMotion && this.pageActive && !document.hidden ? this.audioLevels : null;
    const lag=levels?.active?levels.beatLag||0:0;
    const rayCenter=this.pointerQuery.matches&&!this.reducedMotion?this.rayCenter:{x:.5,y:1};
    const rayOffset=[.5-rayCenter.x,.5-rayCenter.y];
    const loudness=levels?.active&&Number.isFinite(levels.loudness)?Math.max(0,Math.min(1,levels.loudness)):0;
    const volumeGain=levels?this.rayVolume/RAY_RESPONSE.referenceVolume:0;
    const rayBaseline=RAY_RESPONSE.base*volumeGain;
    const rayStrength=rayBaseline+loudness*RAY_RESPONSE.loudnessGain*volumeGain;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.sceneTarget.framebuffer);gl.viewport(0,0,this.sceneTarget.width,this.sceneTarget.height);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.viewSize, this.viewSize.width, this.viewSize.height);
    gl.uniform2f(this.uniforms.pointer, this.pointer.x, this.pointer.y);
    // Audio accelerates depth only. Twinkle and lateral drift retain their
    // slow clock; the shafts follow the output volume independently of beat speed.
    gl.uniform1f(this.uniforms.time, this.baseTime);
    gl.uniform1f(this.uniforms.travel, this.travel);
    gl.uniform2f(this.uniforms.pulse, lag, this.heroMix);
    gl.uniform1f(this.uniforms.layers, this.layerCount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if(rayStrength>.0001){
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.rayTarget.framebuffer);gl.viewport(0,0,this.rayTarget.width,this.rayTarget.height);gl.useProgram(this.rayProgram);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sceneTarget.texture);gl.uniform1i(this.rayUniforms.Scene,0);
      gl.uniform2f(this.rayUniforms.RayOffset,rayOffset[0],rayOffset[1]);gl.uniform1f(this.rayUniforms.Samples,this.raySamples);
      gl.uniform1f(this.rayUniforms.Density,.926);gl.drawArrays(gl.TRIANGLES,0,3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sceneTarget.texture);gl.uniform1i(this.compositeUniforms.Scene,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.rayTarget.texture);gl.uniform1i(this.compositeUniforms.Rays,1);
    gl.uniform1f(this.compositeUniforms.RayStrength,rayStrength);gl.drawArrays(gl.TRIANGLES,0,3);
    // These attributes are diagnostics, not inputs to rendering or analysis.
    if(now-this.diagnosticsAt>=500){
      this.diagnosticsAt=now;
      this.canvas.dataset.rayStrength=rayStrength.toFixed(4);
      this.canvas.dataset.rayBaseline=rayBaseline.toFixed(4);
      this.canvas.dataset.rayVolume=this.rayVolume.toFixed(4);
      this.canvas.dataset.rayVolumeGain=volumeGain.toFixed(4);
      this.canvas.dataset.rayCenterX=rayCenter.x.toFixed(4);
      this.canvas.dataset.rayCenterY=rayCenter.y.toFixed(4);
      this.canvas.dataset.rayPass=rayStrength>.0001?'radial-scatter':'idle';
      this.canvas.dataset.visualTime=this.time.toFixed(3);
      this.canvas.dataset.baseTime=this.baseTime.toFixed(3);
      this.canvas.dataset.audioOffset=this.audioOffset.toFixed(5);
      this.canvas.dataset.audioSpeed=this.audioSpeed.toFixed(4);
      this.canvas.dataset.snareLag=(this.audioLevels?.snareLag||0).toFixed(4);
      this.canvas.dataset.beatLag=(this.audioLevels?.beatLag||0).toFixed(4);
      this.canvas.dataset.beatCount=String(this.audioLevels?.beatCount||0);
      this.canvas.dataset.depthTravel=this.travel.toFixed(6);
      this.canvas.dataset.depthSpeed=(DEPTH_SPEED.ambient+this.audioSpeed*DEPTH_SPEED.audio).toFixed(5);
      this.canvas.dataset.heroMix=this.heroMix.toFixed(3);
    }
  }

  _tick(now) {
    this.frame = 0;
    if (!this.ready || this.destroyed || !this.pageActive || this.paused || this.reducedMotion || document.hidden) return;
    const elapsed = this.lastDraw ? now - this.lastDraw : FRAME_INTERVAL;
    // A fixed background does not need to render at the display's refresh rate.
    if (!this.nextDraw || now >= this.nextDraw) {
      this.nextDraw = this.nextDraw ? now + FRAME_INTERVAL - ((now - this.nextDraw) % FRAME_INTERVAL) : now + FRAME_INTERVAL;
      this.lastDraw = now;
      const seconds = Math.min(elapsed, 250) / 1000;
      this.audioLevels = window.PortfolioAudioAnalysis?.getLevels() || null;
      const outputVolume=Number.isFinite(this.audioLevels?.outputVolume)?Math.max(0,Math.min(1,this.audioLevels.outputVolume)):0;
      this.rayVolume+=(outputVolume-this.rayVolume)*(1-Math.exp(-seconds/.12));
      if (now - this.sceneMeasuredAt > 240) {
        this.sceneMeasuredAt = now;
        this.heroTarget = this._homeVisibility();
      }
      this.heroMix += (this.heroTarget - this.heroMix) * (1 - Math.exp(-seconds / .35));
      // Speed CHOP equivalent: retain an integrated audio offset, mapped to a
      // dedicated depth coordinate. A short beat visibly surges then settles;
      // silence preserves the position without rewinding or changing the music.
      const sceneGain = AUDIO_SCENE_GAIN.content + this.heroMix * (AUDIO_SCENE_GAIN.home - AUDIO_SCENE_GAIN.content);
      this.audioSpeed = this.audioLevels?.active ? Math.max(0, this.audioLevels.speed || 0) * sceneGain : 0;
      this.baseTime += seconds;
      this.audioOffset += this.audioSpeed * seconds;
      this.time = this.baseTime + this.audioOffset;
      this.travel = this.baseTime * DEPTH_SPEED.ambient + this.audioOffset * DEPTH_SPEED.audio;
      // Exponential easing is frame-rate independent; no input work on touch.
      const easing = 1 - Math.exp(-seconds * 4.5);
      this.pointer.x += (this.pointer.targetX - this.pointer.x) * easing;
      this.pointer.y += (this.pointer.targetY - this.pointer.y) * easing;
      this._draw(now);
      // Visibility changes reset lastDraw, so genuinely slow frames should also
      // reduce resolution instead of being mistaken for time spent in another tab.
      this.frameTimes.push(Math.min(elapsed, 500));
      if (this.frameTimes.length === 60) {
        const average = this.frameTimes.reduce((sum, time) => sum + time, 0) / 60;
        this.frameTimes.length = 0;
        if (average > FRAME_INTERVAL * 1.45 && this.resolutionScale > 0.55) {
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
    this.nextDraw = 0;
    this.frameTimes.length = 0;
  }

  _sync() {
    this._stop();
    if (!this.pageActive || document.hidden || this.reducedMotion) {this.audioLevels = null;this.rayVolume = 0;}
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
      if (this.rayProgram) this.gl.deleteProgram(this.rayProgram);
      if (this.compositeProgram) this.gl.deleteProgram(this.compositeProgram);
      this._releaseTargets();
    }
    this.canvas.style.opacity = this.originalOpacity;
    this.ready = false;
  }
}
