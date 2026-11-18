// A tiny shared surface draws only the two control glyphs. Native controls and
// SVG fallbacks stay in the DOM; audio playback never depends on WebGL.
export function mountMusicShader(panel, readState, readLevels) {
  const canvas = document.createElement('canvas');
  canvas.className = 'music-glyph-shader';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.noTranslate = '';
  canvas.hidden = true;
  panel.append(canvas);
  const buttons = [panel.querySelector('#music-toggle'), panel.querySelector('#music-mute')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(pointer: fine)');
  let gl, program, buffer, uniforms, frame = 0, lastFrame = 0, time = 0;
  let ready = false, failed = false, lost = false, suspended = false, destroyed = false;
  let hovered = 0, focused = 0, width = 92, height = 45, centers = [22.5, 22.5, 69.5, 22.5];
  const cleanups = [];
  const listen = (target, event, callback, options) => {
    target.addEventListener(event, callback, options);
    cleanups.push(() => target.removeEventListener(event, callback, options));
  };
  const vertex = `attribute vec2 aPosition; varying vec2 vUV;
    void main(){vUV=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
  const fragment = `precision mediump float;
    varying vec2 vUV;
    uniform vec2 uSize,uPlayCenter,uMuteCenter;
    uniform float uTime,uPause,uMuted,uPlaying,uEnergy,uHover,uBlocked;
    float segment(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.));}
    float play(vec2 p){return min(segment(p,vec2(-4.2,-6.),vec2(6.,0.)),min(segment(p,vec2(6.,0.),vec2(-4.2,6.)),segment(p,vec2(-4.2,6.),vec2(-4.2,-6.))));}
    float pause(vec2 p){return min(segment(p,vec2(-3.2,-6.),vec2(-3.2,6.)),segment(p,vec2(3.2,-6.),vec2(3.2,6.)));}
    float speaker(vec2 p){
      float d=segment(p,vec2(-7.,-3.),vec2(-3.,-3.));
      d=min(d,segment(p,vec2(-3.,-3.),vec2(1.,-6.5)));
      d=min(d,segment(p,vec2(1.,-6.5),vec2(1.,6.5)));
      d=min(d,segment(p,vec2(1.,6.5),vec2(-3.,3.)));
      d=min(d,segment(p,vec2(-3.,3.),vec2(-7.,3.)));
      return min(d,segment(p,vec2(-7.,3.),vec2(-7.,-3.)));
    }
    float arc(vec2 p,float radius){return max(abs(length(p)-radius),max(-p.x,abs(p.y)-radius*.68));}
    vec4 ink(float d,vec2 p,float emphasis){
      float line=1.-smoothstep(.42,1.15,d);
      float soft=exp(-d*1.6)*.085;
      float flow=.5+.5*sin(uTime*1.35+p.x*.18+p.y*.13);
      vec3 color=mix(vec3(.40,.65,.81),vec3(.83,.95,1.),flow*.58+emphasis*.30);
      float alpha=(line+soft)*(.76+emphasis*.16);
      alpha=clamp(alpha,0.,.94);return vec4(color*alpha,alpha);
    }
    void main(){
      vec2 p=vec2(vUV.x*uSize.x,(1.-vUV.y)*uSize.y);
      vec2 a=p-uPlayCenter,b=p-uMuteCenter;
      float playD=mix(play(a),pause(a),uPause);
      float breath=uPlaying*(.24*sin(uTime*2.4)+uEnergy*.9);
      float wave=min(arc(b-vec2(1.,0.),5.+breath),arc(b-vec2(1.,0.),8.3+breath));
      float cross=min(segment(b,vec2(4.,-3.),vec2(9.,3.)),segment(b,vec2(4.,3.),vec2(9.,-3.)));
      float soundD=min(speaker(b),mix(wave,cross,uMuted));
      float playFocus=step(.5,uHover)*(1.-step(1.5,uHover));
      float muteFocus=step(1.5,uHover);
      vec4 left=ink(playD,a,clamp(playFocus+uEnergy*.6,0.,1.))*(1.-uBlocked*.62);
      vec4 right=ink(soundD,b,muteFocus);
      gl_FragColor=left+right;
    }`;

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; lastFrame = 0;
    canvas.dataset.running = 'false';
  }
  function fallback(state) {
    stop(); canvas.hidden = true;
    panel.dataset.musicShader = state;
  }
  function initialize() {
    if (ready) return true;
    if (failed || lost || destroyed) return false;
    let vs, fs, nextProgram, nextBuffer;
    try {
      gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false, depth:false, stencil:false, powerPreference:'low-power'});
      if (!gl) throw Error('WebGL unavailable');
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw Error('Music glyph compile failed'); }
        return shader;
      };
      vs = compile(gl.VERTEX_SHADER, vertex); fs = compile(gl.FRAGMENT_SHADER, fragment);
      nextProgram = gl.createProgram(); gl.attachShader(nextProgram, vs); gl.attachShader(nextProgram, fs); gl.linkProgram(nextProgram);
      if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) throw Error('Music glyph link failed');
      nextBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nextBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
      gl.useProgram(nextProgram);
      const position = gl.getAttribLocation(nextProgram, 'aPosition');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      program = nextProgram; buffer = nextBuffer;
      uniforms = Object.fromEntries(['Size','PlayCenter','MuteCenter','Time','Pause','Muted','Playing','Energy','Hover','Blocked'].map(key => [key,gl.getUniformLocation(program,'u'+key)]));
      ready = true; return true;
    } catch {
      if (nextBuffer) gl?.deleteBuffer(nextBuffer);
      if (nextProgram) gl?.deleteProgram(nextProgram);
      failed = true; return false;
    } finally {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    }
  }
  function measure() {
    const origin = panel.getBoundingClientRect(), a = buttons[0].getBoundingClientRect(), b = buttons[1].getBoundingClientRect();
    width = Math.max(1, b.right-origin.left); height = Math.max(1, a.height);
    centers = [a.left+a.width/2-origin.left,a.top+a.height/2-origin.top,b.left+b.width/2-origin.left,b.top+b.height/2-origin.top];
    canvas.style.width = width+'px'; canvas.style.height = height+'px';
    const ratio = Math.min(devicePixelRatio || 1,1.5);
    const pw = Math.round(width*ratio), ph = Math.round(height*ratio);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
  }
  const allowed = () => !destroyed && !suspended && !document.hidden && !reduced.matches;
  const animated = () => readState().playing || hovered || focused;
  function paint() {
    if (!ready || !allowed()) return;
    const state = readState();
    const levels = state.playing ? readLevels() : {bass:0,mid:0};
    gl.viewport(0,0,canvas.width,canvas.height); gl.useProgram(program);
    gl.uniform2f(uniforms.Size,width,height);
    gl.uniform2f(uniforms.PlayCenter,centers[0],centers[1]); gl.uniform2f(uniforms.MuteCenter,centers[2],centers[3]);
    gl.uniform1f(uniforms.Time,time); gl.uniform1f(uniforms.Pause,state.pauseIcon?1:0);
    gl.uniform1f(uniforms.Muted,state.muted?1:0); gl.uniform1f(uniforms.Playing,state.playing&&!state.muted?1:0);
    gl.uniform1f(uniforms.Energy,Math.min(1,(levels.bass+levels.mid)*2));
    gl.uniform1f(uniforms.Hover,hovered||focused); gl.uniform1f(uniforms.Blocked,state.blocked?1:0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    canvas.dataset.time = time.toFixed(3);
    canvas.dataset.pixels = String(canvas.width*canvas.height);
    canvas.hidden = false; panel.dataset.musicShader = 'ready';
  }
  function tick(now) {
    frame = 0;
    if (!allowed()) { fallback(reduced.matches?'reduced-motion':'suspended'); return; }
    const elapsed = lastFrame ? now-lastFrame : 50;
    if (elapsed >= (fine.matches?49:65)) {
      lastFrame = now; time += Math.min(elapsed,100)/1000; paint();
    }
    if (animated()) { frame = requestAnimationFrame(tick); canvas.dataset.running='true'; }
    else stop();
  }
  function refresh() {
    if (!allowed()) { fallback(reduced.matches?'reduced-motion':'suspended'); return; }
    if (!initialize()) { fallback('fallback'); return; }
    measure(); paint();
    if (animated() && !frame) { frame = requestAnimationFrame(tick); canvas.dataset.running='true'; }
    else if (!animated()) stop();
  }
  const target = element => element?.closest?.('.music-button') === buttons[0] ? 1 : element?.closest?.('.music-button') === buttons[1] ? 2 : 0;
  listen(panel,'pointerover',event=>{if(event.pointerType==='mouse'){hovered=target(event.target);refresh();}});
  listen(panel,'pointerleave',()=>{hovered=0;refresh();});
  listen(panel,'focusin',event=>{focused=event.target.matches(':focus-visible')?target(event.target):0;refresh();});
  listen(panel,'focusout',()=>{focused=0;refresh();});
  listen(window,'resize',refresh,{passive:true});
  listen(document,'visibilitychange',refresh); listen(reduced,'change',refresh);
  listen(canvas,'webglcontextlost',event=>{event.preventDefault();lost=true;ready=false;fallback('fallback');});
  listen(canvas,'webglcontextrestored',()=>{lost=false;failed=false;program=null;buffer=null;refresh();});
  const resizeObserver = typeof ResizeObserver==='function' ? new ResizeObserver(refresh) : null;
  resizeObserver?.observe(panel);
  function destroy() {
    if (destroyed) return;
    destroyed=true;stop();resizeObserver?.disconnect();cleanups.splice(0).forEach(fn=>fn());
    if (gl && !gl.isContextLost()) { if(buffer)gl.deleteBuffer(buffer); if(program)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    canvas.remove();delete panel.dataset.musicShader;
  }
  listen(window,'pagehide',event=>{suspended=true;if(event.persisted)fallback('suspended');else destroy();});
  listen(window,'pageshow',event=>{if(event.persisted){suspended=false;refresh();}});
  return {refresh,destroy};
}
