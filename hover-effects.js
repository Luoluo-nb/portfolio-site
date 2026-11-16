/* One WebGL atlas renders the selected controls and the hovered control.
   The small 2D copies stay behind text and never intercept pointer input. */
const targets = '.header nav a,.category-tabs button,.subcategory-row button,.language-switch button,.action,.project-detail-link,.back-button,.video-chapters button';
const selected = '.header nav a[aria-current="page"],.category-tabs button[aria-pressed="true"],.subcategory-row button[aria-pressed="true"],.language-switch button[aria-pressed="true"],.video-chapters button[aria-pressed="true"]';
const fine = matchMedia('(hover:hover) and (pointer:fine)'), reduced = matchMedia('(prefers-reduced-motion:reduce)');
const atlas = document.createElement('canvas');
atlas.id='button-shader-renderer'; atlas.hidden=true; atlas.dataset.noTranslate=''; atlas.setAttribute('aria-hidden','true');
atlas.dataset.state='idle'; atlas.dataset.time='0'; document.body.append(atlas);
const vertex=`attribute vec2 aPosition;varying mediump vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const fragment=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying mediump vec2 vUv;
uniform vec2 uSize,uCenter,uRadius;
uniform float uTime,uStrength;
float random(float n){return fract(sin(n*1.79+.61)*17.17);}
void main(){
 vec2 p=(vUv-uCenter)*uSize;
 vec2 ellipse=p/uRadius;
 float r=length(ellipse),angle=atan(ellipse.y,ellipse.x);
 float grad=length(ellipse/uRadius)/max(r,.001);
 float d=(r-1.)/max(grad,.001);
 float rim=exp(-pow(d/.8,2.)),bloom=exp(-pow(d/2.8,2.));
 float arc=pow(.5+.5*cos(angle-uTime*.6),5.);
 float counter=pow(.5+.5*cos(angle+uTime*.35+2.4),9.);
 float light=rim*(.10+arc*.38+counter*.12)+bloom*(.025+arc*.035);
 float dust=pow(.5+.5*cos(angle*2.-uTime*.45+r*2.),4.);
 light+=dust*exp(-pow((r-1.15)*3.4,2.))*.025;
 float stars=0.;
 for(int i=0;i<8;i++){
  float seed=float(i)+1.;
  float phase=random(seed+9.)*6.283185+uTime*mix(.26,.48,random(seed+17.));
  vec2 point=vec2(cos(phase),sin(phase))*uRadius*mix(1.10,1.38,random(seed));
  float dist=length(p-point);
  stars+=(exp(-dist*dist*1.5)+exp(-dist*dist*.14)*.10)*(.76+.24*sin(uTime*1.5+seed*2.6));
 }
 vec2 edgeDist=min(vUv,1.-vUv)*uSize;
 float edge=smoothstep(0.,6.,min(edgeDist.x,edgeDist.y));
 float alpha=min((light+stars*.64)*uStrength*edge,.48);
 vec3 tint=mix(vec3(.35,.69,1.),vec3(.88,.97,1.),clamp(stars+arc*.35,0.,1.));
 gl_FragColor=vec4(tint*alpha,alpha);
}`;
let gl,program,buffer,uniforms,ready=false,failed=false,lost=false,destroyed=false,suspended=false,blurred=false;
let hover=null,focus=null,frame=0,refreshFrame=0,lastDraw=0,time=0,atlasHeight=1;
const surfaces=new Map(),cleanups=[];
const allowed=()=>!destroyed&&!suspended&&!blurred&&!document.hidden&&!reduced.matches;
const enabled=el=>el?.isConnected&&!el.matches(':disabled,[aria-disabled="true"]');
function listen(el,event,callback,options){el.addEventListener(event,callback,options);cleanups.push(()=>el.removeEventListener(event,callback,options));}
function stop(){if(frame)cancelAnimationFrame(frame);frame=0;lastDraw=0;atlas.dataset.running='false';}
function clear(){for(const [el,s]of surfaces){s.context.clearRect(0,0,s.canvas.width,s.canvas.height);delete el.dataset.shaderActive;}}
function initialize(){
 if(ready)return true;if(failed||lost||!allowed())return false;
 let vs,fs,p,b;
 try{
  gl=atlas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
  if(!gl)throw Error('WebGL unavailable');
  const compile=(type,source)=>{const s=gl.createShader(type);if(!s)throw Error('Shader unavailable');gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error('Shader compile');}return s;};
  vs=compile(gl.VERTEX_SHADER,vertex);fs=compile(gl.FRAGMENT_SHADER,fragment);
  p=gl.createProgram();if(!p)throw Error('Program unavailable');gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Shader link');
  b=gl.createBuffer();if(!b)throw Error('Buffer unavailable');gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.useProgram(p);const pos=gl.getAttribLocation(p,'aPosition');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
  program=p;buffer=b;uniforms=Object.fromEntries(['Size','Center','Radius','Time','Strength'].map(n=>[n,gl.getUniformLocation(p,'u'+n)]));ready=true;return true;
 }catch{if(b)gl?.deleteBuffer(b);if(p)gl?.deleteProgram(p);failed=true;return false;}
 finally{if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);}
}
function measure(el){
 const rect=el.getBoundingClientRect(),width=el.clientWidth,height=el.clientHeight;
 if(!width||!height||rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth||getComputedStyle(el).visibility==='hidden')return null;
 let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
 const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
 for(let node=walker.nextNode();node;node=walker.nextNode()){
  if(!/[\p{L}\p{N}]/u.test(node.nodeValue)||node.parentElement.closest('canvas,svg,[aria-hidden="true"],[hidden],.chapter-time'))continue;
  const text=node.nodeValue,start=text.search(/\S/);if(start<0)continue;
  const range=document.createRange();range.setStart(node,start);range.setEnd(node,text.trimEnd().length);
  for(const q of range.getClientRects()){if(!q.width||!q.height)continue;l=Math.min(l,q.left);t=Math.min(t,q.top);r=Math.max(r,q.right);b=Math.max(b,q.bottom);}
 }
 const has=Number.isFinite(l),cx=has?(l+r)/2-rect.left-el.clientLeft:width/2,cy=has?(t+b)/2-rect.top-el.clientTop:height/2;
 const rx=Math.max(8,Math.min(has?(r-l)/2+8:12,cx-4,width-cx-4)),ry=Math.max(7,Math.min(has?(b-t)/2+4:12,cy-4,height-cy-4));
 return{width,height,cx,cy,rx,ry};
}
function schedule(){if(!destroyed&&!refreshFrame)refreshFrame=requestAnimationFrame(refresh);}
const resizeObserver='ResizeObserver'in window?new ResizeObserver(schedule):null;
function remove(el,s){resizeObserver?.unobserve(el);s.canvas.remove();delete el.dataset.shaderActive;surfaces.delete(el);}
function create(el){
 const canvas=document.createElement('canvas');canvas.className='button-shader-surface';canvas.dataset.noTranslate='';canvas.setAttribute('aria-hidden','true');
 const context=canvas.getContext('2d',{alpha:true});if(!context)return null;
 const s={canvas,context};el.append(canvas);surfaces.set(el,s);resizeObserver?.observe(el);return s;
}
function refresh(){
 refreshFrame=0;if(destroyed)return;
 for(const el of document.querySelectorAll(targets))el.classList.add('fx-button');
 if(!allowed()){stop();clear();atlas.dataset.state=reduced.matches?'disabled-motion':'suspended';return;}
 const candidates=new Set(document.querySelectorAll(selected));
 if(fine.matches&&enabled(hover))candidates.add(hover);
 if(enabled(focus)&&focus.matches(':focus-visible'))candidates.add(focus);
 const visible=new Map();for(const el of candidates){if(!enabled(el))continue;const m=measure(el);if(m)visible.set(el,m);}
 for(const [el,s]of surfaces)if(!visible.has(el))remove(el,s);
 for(const [el,m]of visible){const s=surfaces.get(el)||create(el);if(!s)continue;if(s.canvas.parentElement!==el)el.append(s.canvas);Object.assign(s,m);s.canvas.dataset.center=m.cx.toFixed(3)+','+m.cy.toFixed(3);s.canvas.dataset.radius=m.rx.toFixed(3)+','+m.ry.toFixed(3);}
 atlas.dataset.targets=String(surfaces.size);
 if(!surfaces.size){stop();atlas.dataset.state='idle';return;}
 if(!initialize()){stop();clear();atlas.dataset.state='fallback';return;}
 const entries=[...surfaces.values()],maxWidth=Math.max(...entries.map(s=>s.width)),sumHeight=entries.reduce((sum,s)=>sum+s.height,0);
 const scale=Math.min(devicePixelRatio||1,fine.matches?1.5:1,Math.sqrt(140000/(maxWidth*sumHeight)),1024/maxWidth,2048/sumHeight);
 let atlasWidth=1;atlasHeight=0;
 for(const s of entries){s.pw=Math.max(1,Math.floor(s.width*scale));s.ph=Math.max(1,Math.floor(s.height*scale));s.y=atlasHeight;atlasHeight+=s.ph;atlasWidth=Math.max(atlasWidth,s.pw);if(s.canvas.width!==s.pw)s.canvas.width=s.pw;if(s.canvas.height!==s.ph)s.canvas.height=s.ph;}
 if(atlas.width!==atlasWidth)atlas.width=atlasWidth;if(atlas.height!==atlasHeight)atlas.height=atlasHeight;
 atlas.dataset.layoutpixels=String(atlasWidth*atlasHeight);draw();if(!frame)frame=requestAnimationFrame(tick);
}
function draw(){
 if(!ready||!allowed()||!surfaces.size)return;
 gl.useProgram(program);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
 for(const [el,s]of surfaces){
  gl.viewport(0,atlasHeight-s.y-s.ph,s.pw,s.ph);gl.uniform2f(uniforms.Size,s.width,s.height);gl.uniform2f(uniforms.Center,s.cx/s.width,1-s.cy/s.height);gl.uniform2f(uniforms.Radius,s.rx,s.ry);gl.uniform1f(uniforms.Time,time);gl.uniform1f(uniforms.Strength,el === hover ? .72 : .56);gl.drawArrays(gl.TRIANGLES,0,3);
 }
 // Synchronous copies precede drawing-buffer invalidation at the end of the task.
 for(const [el,s]of surfaces){s.context.clearRect(0,0,s.pw,s.ph);s.context.drawImage(atlas,0,s.y,s.pw,s.ph,0,0,s.pw,s.ph);if(el.dataset.shaderActive!=='true')el.dataset.shaderActive='true';}
 atlas.dataset.state='ready';atlas.dataset.time=time.toFixed(3);atlas.dataset.running='true';
}
function tick(now){frame=0;if(!allowed()||!ready||!surfaces.size){stop();return;}const elapsed=lastDraw?now-lastDraw:(fine.matches?34:50);if(elapsed>=(fine.matches?32:49)){lastDraw=now;time+=Math.min(elapsed,80)/1000;draw();}frame=requestAnimationFrame(tick);}
const own=node=>node instanceof Element&&node.matches('.button-shader-surface,#button-shader-renderer');
const observer=new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'?r.oldValue!==r.target.getAttribute(r.attributeName):r.type==='characterData'?Boolean(r.target.parentElement?.closest(targets)):[...r.addedNodes,...r.removedNodes].some(n=>!own(n))))schedule();});
observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['aria-current','aria-pressed','disabled','aria-disabled','hidden']});
listen(document,'pointerover',e=>{if(e.pointerType!=='mouse'||!(e.target instanceof Element))return;const el=e.target.closest(targets);if(el!==hover){hover=el;schedule();}});
listen(document,'pointerout',e=>{if(hover&&(!(e.relatedTarget instanceof Node)||!hover.contains(e.relatedTarget))){hover=null;schedule();}});
listen(document,'focusin',e=>{focus=e.target.closest?.(targets)||null;schedule();});listen(document,'focusout',()=>{focus=null;schedule();});
listen(window,'resize',schedule,{passive:true});listen(window,'scroll',schedule,{passive:true});
listen(window,'blur',()=>{blurred=true;hover=null;stop();clear();atlas.dataset.state='suspended';});listen(window,'focus',()=>{blurred=false;schedule();});
listen(document,'visibilitychange',refresh);listen(document,'portfolio:languagechange',schedule);listen(fine,'change',schedule);listen(reduced,'change',refresh);
if(document.fonts){document.fonts.ready.then(schedule);listen(document.fonts,'loadingdone',schedule);}
listen(atlas,'webglcontextlost',e=>{e.preventDefault();lost=true;ready=false;stop();clear();atlas.dataset.state='fallback';});
listen(atlas,'webglcontextrestored',()=>{lost=false;failed=false;program=null;buffer=null;schedule();});
export function destroyHoverEffects(){
 if(destroyed)return;destroyed=true;stop();if(refreshFrame)cancelAnimationFrame(refreshFrame);refreshFrame=0;observer.disconnect();resizeObserver?.disconnect();cleanups.splice(0).forEach(fn=>fn());for(const [el,s]of surfaces)remove(el,s);
 if(gl&&!gl.isContextLost()){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}ready=false;atlas.remove();
}
listen(window,'pagehide',e=>{suspended=true;if(e.persisted){stop();clear();}else destroyHoverEffects();});
listen(window,'pageshow',e=>{if(e.persisted){suspended=false;blurred=false;schedule();}});
schedule();
