/**
 * The Universe Within — Martijn Steinrucken / BigWings (2018).
 * Original: https://youtu.be/GAhu4ngQa48
 * Tutorial: https://youtu.be/3CycKKJiwis
 * Original shader and this adaptation: CC BY-NC-SA 3.0 Unported.
 * https://creativecommons.org/licenses/by-nc-sa/3.0/
 *
 * Adapted for a transparent, crisp blue-cyan portfolio transition: retains the
 * original moving 3x3 neighborhood, center links, four diagonal links, sparkle,
 * rotation and depth layers. Removes the audio fog and 230-second blackout.
 * Lines use CSS-pixel widths; all four edges dissolve well before the boundary.
 */

const FRAME_INTERVAL=1000/24;
const vertexSource = `attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.,1.);}`;
const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uCssSize,uPointer,uResolution;
uniform float uTime,uLayers,uProjectionScale;
float N21(vec2 p){
  vec3 a=fract(vec3(p.xyx)*vec3(213.897,653.453,253.098));
  a+=dot(a,a.yzx+79.76);
  // Algebraically equivalent modulo arithmetic keeps mediump below overflow.
  return fract(fract((a.x+a.y)*(a.z*.5))*2.);
}
vec2 GetPos(vec2 id,vec2 offs,float t){
  float n=N21(id+offs);float a=t+n;
  return offs+vec2(sin(a*fract(n*10.)),cos(a*fract(n*100.)))*.4;
}
float df_line(vec2 a,vec2 b,vec2 p){
  vec2 pa=p-a,ba=b-a;
  float h=clamp(dot(pa,ba)/max(dot(ba,ba),.00001),0.,1.);
  return length(pa-ba*h);
}
float line(vec2 a,vec2 b,vec2 uv,float pixel,float width){
  float d=df_line(a,b,uv),d2=length(a-b);
  float fade=1.-smoothstep(.5,1.5,d2);
  fade+=1.-smoothstep(.02,.05,abs(d2-.75));
  // Cover the actual render pixels when the transition uses its pixel budget;
  // CSS-only antialiasing can turn diagonal hairlines into isolated fragments.
  float rasterScale=max(1.,uCssSize.y/max(uResolution.y,1.));
  float halfWidth=width*.5*pixel,aa=.38*pixel*rasterScale;
  return (1.-smoothstep(max(0.,halfWidth-aa),halfWidth+aa,d))*fade;
}
float NetLayer(vec2 st,float n,float t,float pixel,float width){
  vec2 id=floor(st)+n;st=fract(st)-.5;
  vec2 p[9];
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    p[(y+1)*3+x+1]=GetPos(id,vec2(float(x),float(y)),t);
  }
  float m=0.,sparkle=0.;
  for(int i=0;i<9;i++){
    if(i!=4)m+=line(p[4],p[i],st,pixel,width);
    // Keep the small solid nucleus and short star rays, without a foggy halo.
    vec2 q=(st-p[i])/max(pixel,.00001);
    float r=length(q);
    float core=1.-smoothstep(.38,.82,r);
    float rays=(1.-smoothstep(.04,.30,abs(q.x)))*(1.-smoothstep(.45,3.2,abs(q.y)));
    rays+=(1.-smoothstep(.04,.30,abs(q.y)))*(1.-smoothstep(.45,2.4,abs(q.x)));
    float s=min(.95,core*.95+rays*.08);
    float pulse=sin((fract(p[i].x)+fract(p[i].y)+t)*5.)*.4+.6;
    sparkle+=s*(.12+.88*pow(pulse,20.));
  }
  m+=line(p[1],p[3],st,pixel,width);
  m+=line(p[1],p[5],st,pixel,width);
  m+=line(p[7],p[5],st,pixel,width);
  m+=line(p[7],p[3],st,pixel,width);
  float sPhase=(sin(t+n)+sin(t*.1))*.25+.5;
  sPhase+=pow(sin(t*.1)*.5+.5,50.)*.45;
  return m*.78+sparkle*(.45+sPhase*.55);
}
void main(){
  vec2 vUv=gl_FragCoord.xy/max(uResolution,vec2(1.));
  vec2 edge=min(vUv,1.-vUv);
  // Resolve fully transparent edges before evaluating any moving cells.
  float dissolve=pow(smoothstep(.025,.18,edge.x)*smoothstep(.025,.20,edge.y),1.2);
  if(dissolve<=0.){gl_FragColor=vec4(0.);return;}
  // Wide strips use a wider projection than the original square composition.
  // Expanding the strip reveals more cells instead of stretching the network.
  float projection=max(min(uCssSize.x,1328.)*uProjectionScale,1.);
  vec2 uv=(vUv-.5)*uCssSize/max(projection,1.);
  float t=uTime*.035,s=sin(t),c=cos(t);
  mat2 rot=mat2(c,-s,s,c);
  vec2 st=uv*rot,M=uPointer*.026*rot;
  vec3 light=vec3(0.);
  for(int layer=0;layer<4;layer++){
    if(float(layer)<uLayers){
      float n=float(layer)/uLayers,z=fract(t+n);
      float size=mix(8.64,1.68,z);
      float fade=smoothstep(.04,.6,z)*(1.-smoothstep(.8,1.,z));
      if(fade<=0.)continue;
      float foreground=smoothstep(.58,.9,z);
      float rasterScale=max(1.,uCssSize.y/max(uResolution.y,1.));
      float width=max(mix(1.05,2.15,foreground),.95*rasterScale);
      float net=NetLayer(st*size-M*z,n,uTime*.42,size/max(projection,1.),width);
      // Blue depth and cyan foreground keep the brighter strokes in the scene's
      // palette. Extra source energy compensates for the move away from white.
      vec3 tint=mix(vec3(.22,.66,.94),vec3(.38,.91,1.),.30+foreground*.70);
      light+=tint*net*fade*.95;
    }
  }
  light*=dissolve;
  float energy=max(light.r,max(light.g,light.b));
  float alpha=.72*.86*(1.-exp(-energy/.86));
  vec3 color=light/max(energy,.00001);
  // Premultiplied alpha leaves the existing starfield genuinely visible.
  gl_FragColor=vec4(color*alpha,alpha);
}`;

export class HomeNetwork {
  constructor(container, placement = 'home') {
    if (!(container instanceof HTMLElement)) throw new TypeError('HomeNetwork requires a transition container.');
    this.container=container;this.listeners=[];this.time=17.3;this.frame=0;this.lastDraw=0;this.nextDraw=0;
    this.contact=placement==='contact';this.setupJob=null;
    this.anchor=this.contact?null:document.querySelector('#top .hero-scroll');
    this.hero=this.contact?null:document.querySelector('#top');this.heroCopy=this.hero?.querySelector('.hero-copy');
    this.featured=container.closest('.home-featured');this.heading=this.featured?.querySelector('.home-featured-heading');
    this.ready=false;this.destroyed=false;this.pageActive=true;this.inView=false;this.lost=false;
    this.pointer={x:0,y:0,targetX:0,targetY:0};this.size={width:0,height:0,left:0,top:0};
    this.motion=matchMedia('(prefers-reduced-motion:reduce)');this.fine=matchMedia('(hover:hover) and (pointer:fine)');
    this.canvas=this._canvas('home-network');this.canvas.dataset.state='idle';
    this.canvas.dataset.source='BigWings-The-Universe-Within';
    this.canvas.dataset.license='CC-BY-NC-SA-3.0';this.canvas.dataset.running='false';
    this.container.append(this.canvas);this._tick=this._tick.bind(this);
    this._listen(document,'visibilitychange',()=>this._sync());
    this._listen(window,'pagehide',event=>{this.pageActive=false;this._stop();if(!event.persisted)this.destroy();});
    this._listen(window,'pageshow',()=>{this.pageActive=true;this._measure();this._sync();});
    this._listen(window,'resize',()=>{this._measure();this._sync();});
    if(this.contact)this._listen(window,'portfolio:enter',()=>this._sync());
    this._listen(window,'pointermove',event=>{
      if(event.pointerType!=='mouse'||!this.fine.matches||this.motion.matches||!this.inView||document.hidden)return;
      const box=this.container.getBoundingClientRect();
      this.pointer.targetX=Math.max(-1,Math.min(1,(event.clientX-box.left)/Math.max(1,box.width)*2-1));
      this.pointer.targetY=Math.max(-1,Math.min(1,1-(event.clientY-box.top)/Math.max(1,box.height)*2));
    });
    const release=()=>{this.pointer.targetX=0;this.pointer.targetY=0;};
    this._listen(window,'blur',release);
    this._listen(document,'pointerout',event=>{if(!event.relatedTarget)release();});
    this._listen(this.canvas,'webglcontextlost',event=>{event.preventDefault();this.lost=true;this.ready=false;this._stop();this._fallback();this._sync();});
    this._listen(this.canvas,'webglcontextrestored',()=>{this.lost=false;this.gl=null;this._initialize();this._sync();});
    this.motionChanged=()=>{this.pointer.x=this.pointer.y=this.pointer.targetX=this.pointer.targetY=0;this._sync();};
    if(this.motion.addEventListener)this.motion.addEventListener('change',this.motionChanged);else this.motion.addListener(this.motionChanged);
    if('ResizeObserver'in window){this.resizeObserver=new ResizeObserver(()=>{this._measure();this._sync();});for(const element of new Set([container,this.anchor,this.hero,this.heroCopy,this.heading].filter(Boolean)))this.resizeObserver.observe(element);}
    if('IntersectionObserver'in window){
      this.intersectionObserver=new IntersectionObserver(entries=>{this.inView=entries[0].isIntersecting&&entries[0].intersectionRect.width>0&&entries[0].intersectionRect.height>0;this._measure();this._sync();},{threshold:0});
      this.intersectionObserver.observe(container);
    }else this._listen(window,'scroll',()=>{this._measure();this._sync();},{passive:true});
    this._measure();this._sync();
  }
  _canvas(className){
    const canvas=document.createElement('canvas');canvas.className=className;canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    return canvas;
  }
  _listen(target,type,callback,options){target.addEventListener(type,callback,options);this.listeners.push([target,type,callback,options]);}
  _measure(){
    if(this.destroyed)return;
    const anchorBox=this.anchor?.getBoundingClientRect(),host=this.container.offsetParent||this.featured;
    if(anchorBox?.width&&anchorBox.height&&host){
      const hostBox=host.getBoundingClientRect(),centerX=anchorBox.left+anchorBox.width*.5,centerY=anchorBox.top+anchorBox.height*.5;
      this.container.style.setProperty('--network-center-x',`${centerX-hostBox.left}px`);
      this.container.style.setProperty('--network-center-y',`${centerY-hostBox.top}px`);
      this.container.style.setProperty('--network-clear-x',`${anchorBox.width*.75}px`);
      this.container.style.setProperty('--network-clear-y',`${anchorBox.height*.80}px`);
      // Expansion is symmetric about the CTA. The existing upper feather may
      // reach the hero's empty margin; the lower canvas stays above the heading.
      const copyBox=this.heroCopy?.getBoundingClientRect(),headingBox=this.heading?.getBoundingClientRect();
      const above=copyBox?.height?centerY-copyBox.bottom-32:Infinity;
      const below=headingBox?.height?headingBox.top-centerY-36:Infinity;
      const maximumHeight=Math.min(above/.36,below*2);
      if(Number.isFinite(maximumHeight))this.container.style.setProperty('--network-max-height',`${Math.max(0,maximumHeight)}px`);
      else this.container.style.removeProperty('--network-max-height');
    }
    const box=this.container.getBoundingClientRect();
    this.size={width:box.width,height:box.height,left:box.left,top:box.top};
    if(!this.intersectionObserver)this.inView=box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight;
    // The smaller transition gets enough samples for solid diagonal strokes;
    // the capped buffer still avoids full-screen device-pixel rendering.
    const compact=box.width<=600;
    this.layers=this.contact?(compact?2:3):(compact?3:4);
    this.budget=this.contact?(compact?64000:172000):(compact?180000:480000);
    this.projectionScale=this.contact?(compact?.44:.39):.52;
    this.frameInterval=this.contact?1000/(compact?12:18):FRAME_INTERVAL;
    this.canvas.dataset.layers=String(this.layers);this.canvas.dataset.pixelBudget=String(this.budget);
    const scale=Math.min(devicePixelRatio||1,1.5,Math.sqrt(this.budget/Math.max(1,box.width*box.height)));
    const w=Math.max(1,Math.floor(box.width*scale)),h=Math.max(1,Math.floor(box.height*scale));
    for(const canvas of [this.canvas,this.fallbackCanvas].filter(Boolean))if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    this.canvas.dataset.pixels=String(w*h);
  }
  _initialize(){
    if(this.destroyed||this.lost)return;
    this._stop();
    const gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
    if(!gl){this._fallback();return;}
    this.gl=gl;let vs,fs,program,buffer;
    try{
      const compile=(type,source)=>{const shader=gl.createShader(type);if(!shader)throw Error('Shader allocation failed');gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw Error('Network shader compile failed');}return shader;};
      vs=compile(gl.VERTEX_SHADER,vertexSource);fs=compile(gl.FRAGMENT_SHADER,fragmentSource);program=gl.createProgram();
      if(!program)throw Error('Program allocation failed');gl.attachShader(program,vs);gl.attachShader(program,fs);gl.bindAttribLocation(program,0,'aPosition');gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Network shader link failed');
      buffer=gl.createBuffer();if(!buffer)throw Error('Buffer allocation failed');gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      this.program=program;this.buffer=buffer;this.uniforms=Object.fromEntries(['uCssSize','uPointer','uResolution','uTime','uLayers','uProjectionScale'].map(key=>[key,gl.getUniformLocation(program,key)]));
      gl.deleteShader(vs);gl.deleteShader(fs);this.ready=true;this.canvas.hidden=false;
      this.fallbackCanvas?.remove();this.fallbackCanvas=null;this.fallbackContext=null;this.canvas.dataset.state='ready';
    }catch{
      if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);if(program)gl.deleteProgram(program);if(buffer)gl.deleteBuffer(buffer);
      this._fallback();
    }
  }
  _fallback(){
    this.ready=false;this.canvas.hidden=true;
    if(!this.fallbackCanvas){this.fallbackCanvas=this._canvas('home-network-fallback');this.container.append(this.fallbackCanvas);this.fallbackContext=this.fallbackCanvas.getContext('2d',{alpha:true});}
    this.canvas.dataset.state=this.fallbackContext?'fallback':'unavailable';this._measure();
  }
  _drawFallback(){
    const ctx=this.fallbackContext,canvas=this.fallbackCanvas,{width:w,height:h}=this.size;if(!ctx||!canvas||!w||!h)return;
    ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);ctx.clearRect(0,0,w,h);
    const fract=x=>x-Math.floor(x),hash=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453);
    for(let layer=0;layer<2;layer++){
      const spacing=Math.min(w,1328)*(this.projectionScale/.52)/(layer?6.6:9.6),rows=Math.ceil(h/spacing)+2,points=[];
      for(let row=-1;row<rows;row++)for(let col=-1;col<Math.ceil(w/spacing)+1;col++){
        const n=hash(col+layer*17,row+layer*23),t=this.time*.42+n;
        points.push({col,row,x:(col+.5+Math.sin(t*fract(n*10))*.4)*spacing+this.pointer.x*5*(layer+1),y:(row+.5+Math.cos(t*fract(n*100))*.4)*spacing+this.pointer.y*5*(layer+1),n});
      }
      for(const p of points){
        for(const q of points){if(q.row<p.row||(q.row===p.row&&q.col<=p.col)||Math.abs(q.row-p.row)>1||Math.abs(q.col-p.col)>1)continue;
          const distance=Math.hypot(q.x-p.x,q.y-p.y)/spacing;if(distance>1.45)continue;
          ctx.strokeStyle=`rgba(${layer?'97,232,255':'71,196,255'},${(layer ? .2975 : .21)*.72*Math.max(0,(1.45-distance)/.85)})`;ctx.lineWidth=Math.max(layer?2.05:1.05,.95*w/canvas.width);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
        }
        const pulse=(.12+.16*Math.pow(Math.sin(this.time*.42+p.n*20)*.5+.5,8))*1.75*.72;
        const tint=layer?'97,232,255':'71,196,255';
        ctx.strokeStyle=`rgba(${tint},${pulse*.22})`;ctx.lineWidth=.35;ctx.beginPath();ctx.moveTo(p.x,p.y-3.2);ctx.lineTo(p.x,p.y+3.2);ctx.moveTo(p.x-2.4,p.y);ctx.lineTo(p.x+2.4,p.y);ctx.stroke();
        ctx.fillStyle=`rgba(${tint},${pulse})`;ctx.beginPath();ctx.arc(p.x,p.y,.6,0,Math.PI*2);ctx.fill();
      }
    }
    ctx.globalCompositeOperation='destination-in';
    for(const [length,horizontal,reach]of [[w,true,.18],[h,false,.20]]){
      const mask=ctx.createLinearGradient(0,0,horizontal?length:0,horizontal?0:length);
      for(let i=0;i<=24;i++){const x=i/24,edge=Math.min(x,1-x),v=Math.max(0,Math.min(1,(edge-.025)/(reach-.025))),smooth=v*v*(3-2*v);mask.addColorStop(x,`rgba(0,0,0,${Math.pow(smooth,1.2)})`);}
      ctx.fillStyle=mask;ctx.fillRect(0,0,w,h);
    }
    ctx.globalCompositeOperation='source-over';
  }
  _draw(){
    if(this.destroyed||!this.size.width||!this.size.height)return;
    if(this.ready){const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.disable(gl.BLEND);gl.uniform2f(this.uniforms.uCssSize,this.size.width,this.size.height);gl.uniform2f(this.uniforms.uResolution,this.canvas.width,this.canvas.height);gl.uniform2f(this.uniforms.uPointer,this.pointer.x,this.pointer.y);gl.uniform1f(this.uniforms.uTime,this.time);gl.uniform1f(this.uniforms.uLayers,this.layers);gl.uniform1f(this.uniforms.uProjectionScale,this.projectionScale);gl.drawArrays(gl.TRIANGLES,0,3);}else this._drawFallback();
    this.canvas.dataset.time=this.time.toFixed(3);
  }
  _tick(now){
    this.frame=0;if(!this._allowed()||this.motion.matches){this.canvas.dataset.running='false';return;}
    const interval=this.frameInterval,elapsed=this.lastDraw?now-this.lastDraw:interval;
    if(!this.nextDraw||now>=this.nextDraw){
      // Keep the deadline separate from elapsed time so throttling does not
      // change the animation's speed on different displays.
      this.nextDraw=this.nextDraw?now+interval-((now-this.nextDraw)%interval):now+interval;
      const dt=Math.min(elapsed,100)/1000;this.lastDraw=now;this.time+=dt;const ease=1-Math.exp(-dt*4);this.pointer.x+=(this.pointer.targetX-this.pointer.x)*ease;this.pointer.y+=(this.pointer.targetY-this.pointer.y)*ease;this._draw();
    }
    this.frame=requestAnimationFrame(this._tick);
  }
  _allowed(){return !this.destroyed&&this.pageActive&&!document.hidden&&this.inView&&this.size.width>0&&this.size.height>0&&(!this.contact||!window.PortfolioStartGate?.active);}
  _stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.lastDraw=0;this.nextDraw=0;this.canvas.dataset.running='false';}
  _queueContactSetup(){
    if(this.setupJob!==null)return;
    const prepare=()=>{
      this.setupJob=null;
      if(!this._allowed()||this.container.closest('[hidden]'))return;
      this._initialize();
      this._sync();
    };
    // Let the contact details paint before compiling the shader.
    this.setupJob=typeof requestIdleCallback==='function'?requestIdleCallback(prepare):setTimeout(prepare,150);
  }
  _sync(){
    this._stop();if(!this._allowed())return;
    if(!this.gl&&!this.fallbackCanvas&&!this.lost){
      if(this.contact){this._queueContactSetup();return;}
      this._initialize();
    }
    this._draw();if(!this.motion.matches&&(this.ready||this.fallbackContext)){this.canvas.dataset.running='true';this.frame=requestAnimationFrame(this._tick);}
  }
  destroy(){
    if(this.destroyed)return;this._stop();this.destroyed=true;
    if(this.setupJob!==null){
      if(typeof requestIdleCallback==='function')cancelIdleCallback(this.setupJob);
      else clearTimeout(this.setupJob);
    }
    this.resizeObserver?.disconnect();this.intersectionObserver?.disconnect();
    for(const [target,type,callback,options]of this.listeners)target.removeEventListener(type,callback,options);
    if(this.motion.removeEventListener)this.motion.removeEventListener('change',this.motionChanged);else this.motion.removeListener(this.motionChanged);
    if(this.gl&&!this.lost){if(this.buffer)this.gl.deleteBuffer(this.buffer);if(this.program)this.gl.deleteProgram(this.program);}
    this.canvas.remove();this.fallbackCanvas?.remove();
  }
}

for(const container of document.querySelectorAll('.home-transition')){
  if(!container.querySelector('.home-network'))new HomeNetwork(container);
}

const contactNetwork=document.querySelector('#contact .contact-network');
if(contactNetwork)new HomeNetwork(contactNetwork,'contact');
