/* A small, transparent shader softens media edges without covering controls. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const vertex = `attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `
precision mediump float;
uniform vec2 resolution;
uniform vec2 cssSize;
uniform float time;
uniform float live;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float cloud(vec2 p){float v=0.;float a=.57;for(int i=0;i<3;i++){v+=noise(p)*a;p=mat2(1.6,-1.2,1.2,1.6)*p+3.1;a*=.46;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;
 vec2 px=uv*cssSize;
 float edge=min(min(px.x,cssSize.x-px.x),min(px.y,cssSize.y-px.y));
 float width=clamp(cssSize.y*.062,14.,38.);
 // Empty center and outermost edge: the effect is smoke, not a rectangular stroke.
 float d=edge/width;
 float band=smoothstep(0.,.3,d)*(1.-smoothstep(.8,2.2,d));
 vec2 p=px/max(cssSize.y,180.)*4.1;
 vec2 drift=vec2(time*.045,-time*.028);
 float warp=cloud(p*.65+drift);
 float n=cloud(p+vec2(warp*1.8,-warp)+drift);
 float wisps=cloud(p*2.3-vec2(time*.024,0.)+n);
 float density=smoothstep(.24,.76,n)*(.32+.68*wisps);
 float controls=mix(1.,smoothstep(48.,78.,px.y),live);
 float alpha=band*density*.34*controls;
 vec3 color=mix(vec3(.16,.36,.58),vec3(.39,.24,.56),smoothstep(.3,.8,warp));
 color+=vec3(.12,.2,.22)*wisps;
 gl_FragColor=vec4(color*alpha,alpha);
}`;

function attachNebula(root) {
  let canvas, gl, program, buffer, uniforms, frame = 0, visible = false, last = 0, live = 0;
  let width = 0, height = 0, failed = false;
  const interval = matchMedia('(pointer: coarse)').matches ? 1000 / 14 : 50;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; if (canvas) canvas.dataset.running = 'false'; };
  function draw(now) {
    if (!gl || gl.isContextLost() || !width || !height) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.cssSize, width, height);
    gl.uniform1f(uniforms.time, reducedMotion.matches ? 0 : now / 1000);
    gl.uniform1f(uniforms.live, live);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function tick(now) {
    if (!visible || document.hidden || reducedMotion.matches || !canvas?.isConnected || failed) { stop(); return; }
    if (now - last >= interval) { last = now; draw(now); }
    canvas.dataset.running = 'true';
    frame = requestAnimationFrame(tick);
  }
  function update() {
    stop();
    if (!gl || failed || !visible || document.hidden) return;
    draw(performance.now());
    if (!reducedMotion.matches) frame = requestAnimationFrame(tick);
  }
  function resize() {
    const bounds = root.getBoundingClientRect(); width = bounds.width; height = bounds.height;
    if (!canvas || !width || !height) { stop(); return; }
    // Soft clouds do not need full-screen device-pixel resolution.
    const scale = Math.min(1, Math.sqrt(240000 / (width * height)));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    update();
  }
  function init() {
    canvas = document.createElement('canvas'); canvas.className = 'player-nebula'; canvas.setAttribute('aria-hidden', 'true');
    gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false, depth:false, stencil:false});
    if (!gl) { failed = true; return; }
    const shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Nebula shader unavailable');
      }
      program = gl.createProgram(); shaders.forEach(s => gl.attachShader(program, s)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Nebula program unavailable');
      gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['resolution','cssSize','time','live'].map(name => [name,gl.getUniformLocation(program,name)]));
      canvas.addEventListener('webglcontextlost', () => { failed = true; stop(); canvas.hidden = true; });
    } catch { failed = true; gl.deleteProgram(program); gl.deleteBuffer(buffer); }
    finally { shaders.forEach(s => gl.deleteShader(s)); }
  }
  function sync() {
    if (failed) return;
    if (!canvas) init();
    if (failed) return;
    live = root.querySelector(':scope > iframe, :scope > video') ? 1 : 0;
    if (!root.contains(canvas)) root.append(canvas);
    canvas.dataset.live = String(live); resize();
  }
  const contentObserver = new MutationObserver(sync);
  contentObserver.observe(root, {childList:true});
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(root);
  const visibilityObserver = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }); visibilityObserver.observe(root);
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener('change', update);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', update);
  sync();
}
document.querySelectorAll('.project-preview').forEach(attachNebula);
