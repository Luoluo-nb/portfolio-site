/* Short, independent activation feedback. Never adds to the cursor trail. */
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const canvas = document.createElement('canvas');
canvas.id = 'click-effects-canvas'; canvas.setAttribute('aria-hidden','true'); canvas.dataset.noTranslate = '';
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;user-select:none;z-index:90;contain:strict;';
document.body.append(canvas);
const ctx = canvas.getContext('2d', {alpha:true});
const bursts = [], cleanups = [], pending = new Set();
const MAX_BURSTS = 3;
let width = 0, height = 0, frame = 0, lastDraw = 0, gesture = null, destroyed = false, suspended = false;
const ignored = 'input:not([type=button]):not([type=submit]):not([type=reset]),select,textarea,label,[contenteditable="true"],[role=slider],[data-click-effects="off"]';
const interactive = 'a[href],button,summary,[role=button],input[type=button],input[type=submit],input[type=reset]';
const listen = (target,type,fn,options) => { target.addEventListener(type,fn,options); cleanups.push(()=>target.removeEventListener(type,fn,options)); };
function state(value){canvas.dataset.state=value;canvas.dataset.bursts=String(bursts.length);canvas.dataset.running=String(Boolean(frame));}
function stop(reason='idle',cancelInput=false){
 if(frame)cancelAnimationFrame(frame);frame=0;lastDraw=0;bursts.length=0;
 if(cancelInput){for(const id of pending)cancelAnimationFrame(id);pending.clear();gesture=null;}
 ctx?.clearRect(0,0,width,height);state(reason);
}
function resize(){
 const r=canvas.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);
 const scale=Math.min(devicePixelRatio||1,1.25,Math.sqrt(700000/(width*height)));
 canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(height*scale));ctx?.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
 canvas.dataset.pixelBudget=String(canvas.width*canvas.height);
}
function availability(){
 const disabled=!ctx||reduced.matches||document.hidden||suspended;
 canvas.hidden=disabled;
 stop(!ctx?'unsupported':reduced.matches?'disabled-motion':disabled?'suspended':'idle',true);
 if(!disabled)resize();
}
// Small cached cloud fields, not outlines: noise and a warped falloff produce
// uneven wisps with transparent edges. Each click only transforms these sprites.
function noise(x,y,seed){
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const hash=(a,b)=>{const n=Math.sin(a*127.1+b*311.7+seed*73.3)*43758.5453;return n-Math.floor(n);};
 const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
 return (hash(ix,iy)*(1-sx)+hash(ix+1,iy)*sx)*(1-sy)
  +(hash(ix,iy+1)*(1-sx)+hash(ix+1,iy+1)*sx)*sy;
}
const clouds=Array.from({length:4},(_,seed)=>{
 const sprite=document.createElement('canvas');sprite.width=sprite.height=96;
 const paint=sprite.getContext('2d');if(!paint)return null;
 const pixels=paint.createImageData(96,96);
 const tint=seed===3?[139,132,241]:seed===1?[100,169,250]:[133,214,255];
 for(let y=0;y<96;y++)for(let x=0;x<96;x++){
  const px=(x+.5-48)/48,py=(y+.5-48)/48,r=Math.hypot(px,py),angle=Math.atan2(py,px);
  const swirl=angle+r*2.2+seed*.8,u=Math.cos(swirl)*r,v=Math.sin(swirl)*r;
  const field=noise(u*3.3+7,v*3.3+11,seed)*.57+noise(u*7.1,v*7.1,seed+3)*.29+noise(u*15,v*15,seed+7)*.14;
  const shape=r*(1+.14*Math.sin(angle*3+seed)+.09*Math.sin(angle*5-seed));
  const edge=Math.max(0,Math.min(1,(1-r)/.14));
  const body=Math.max(0,1-shape*shape)**1.65;
  const density=Math.max(0,field-.30)*1.6*body*edge*edge*(3-2*edge);
  const i=(y*96+x)*4;
  pixels.data[i]=tint[0]+field*24;pixels.data[i+1]=tint[1]+field*12;pixels.data[i+2]=tint[2];
  pixels.data[i+3]=255*density*(seed===3?.62:1);
 }
 paint.putImageData(pixels,0,0);return sprite;
});
const flash=document.createElement('canvas');flash.width=flash.height=32;
const flashContext=flash.getContext('2d');
if(flashContext){const light=flashContext.createRadialGradient(16,16,0,16,16,16);light.addColorStop(0,'rgba(224,247,255,.65)');light.addColorStop(.25,'rgba(128,209,255,.24)');light.addColorStop(1,'rgba(105,164,255,0)');flashContext.fillStyle=light;flashContext.fillRect(0,0,32,32);}
// A periodic height field is differentiated into an actual RG normal texture.
// B retains height for erosion; the fragment shader uses RG to displace its UVs.
const NORMAL_SIZE=64,SHELL_SIZE=192;
const normalPixels=new Uint8Array(NORMAL_SIZE*NORMAL_SIZE*4);
const materialHeight=(u,v)=>.5+.17*Math.sin(Math.PI*2*(u*3+v*2)+.8*Math.sin(Math.PI*2*v))+.12*Math.sin(Math.PI*2*(u*7-v*4)+Math.sin(Math.PI*4*u))+.075*Math.sin(Math.PI*2*(u*13+v*9));
for(let y=0;y<NORMAL_SIZE;y++)for(let x=0;x<NORMAL_SIZE;x++){
 const u=x/NORMAL_SIZE,v=y/NORMAL_SIZE,e=1/NORMAL_SIZE;
 const nx=(materialHeight(u-e,v)-materialHeight(u+e,v))*3.7,ny=(materialHeight(u,v-e)-materialHeight(u,v+e))*3.7,length=Math.hypot(nx,ny,1),i=(y*NORMAL_SIZE+x)*4;
 normalPixels[i]=Math.round((nx/length*.5+.5)*255);normalPixels[i+1]=Math.round((ny/length*.5+.5)*255);normalPixels[i+2]=Math.round(materialHeight(u,v)*255);normalPixels[i+3]=255;
}
const SHELL_FRAGMENT=`precision mediump float;
varying vec2 vUv;uniform sampler2D uNormal;uniform float uAge,uSeed,uVariant,uNormalStrength;
const float TAU=6.2831853;
float band(float distance,float thickness){return 1.-smoothstep(.18,1.35,abs(distance)/thickness);}
void main(){
 vec2 p=(vUv-.5)*2.;float r=length(p),angle=atan(p.y,p.x),age=clamp(uAge,0.,1.);
 float expansion=1.-pow(1.-age,2.1),radius=.09+.70*expansion;
 // Angular UV wraps around the shell, radial UV scrolls through the material.
 vec2 uv=vec2(angle/TAU*2.+uSeed*.13+age*.12,r*1.8-age*.48+uVariant*.19);
 vec3 source=texture2D(uNormal,uv).rgb;vec2 normalRG=(source.rg*2.-1.)*uNormalStrength;
 vec2 warpedUV=uv+normalRG*.115;
 vec3 material=texture2D(uNormal,warpedUV+vec2(age*.035,-age*.06)).rgb;
 float thickness=.042+.045*(.5+.5*sin(angle*3.+material.b*6.+age*2.));
 float shellRadius=radius+(material.b-.5)*.075+normalRG.y*.018;
 float distance=r-shellRadius,profile=distance/thickness;
 float erosion=smoothstep(.19,.52,material.b+normalRG.x*.10);
 float mask=band(distance,thickness*(distance<0.?1.25:.78))*erosion;
 float innerFold=band(distance+thickness*.88,thickness*.30)*smoothstep(.40,.64,material.b)*.16;
 vec3 normal=normalize(vec3(normalRG*.5+normalize(p+vec2(.0001))*clamp(profile,-1.,1.)*.65,sqrt(max(.02,1.-profile*profile))+.3));
 float lighting=.28+.72*max(0.,dot(normal,normalize(vec3(-.45,.62,.8))));
 float crest=pow(max(0.,1.-abs(profile-.18)),2.);
 // Small radial channel offsets and a low-amplitude grating only tint local crests.
 float separation=.0045*(.45+abs(normalRG.x));
 vec3 channelMask=vec3(band(distance+separation,thickness),band(distance,thickness),band(distance-separation,thickness));
 float grating=.5+.5*sin(angle*16.+material.b*27.-age*5.);
 float pink=smoothstep(.72,.95,grating)*smoothstep(.38,.64,material.b)*.90*(.65+.35*smoothstep(.15,.85,abs(profile)));
 vec3 color=mix(vec3(.40,.72,1.),vec3(.95,.98,1.),.15+crest*lighting*.60);
 color=mix(color,vec3(1.,.62,.82),pink);
 color=color*(.45+lighting*.55)+crest*lighting*vec3(.12,.14,.16);
 color*=mix(vec3(1.),channelMask,.32);
 float halo=exp(-pow(distance/(thickness*2.8),2.))*erosion*.075;
 float fade=pow(max(0.,1.-age),.86)*smoothstep(.015,.075,age);
 float alpha=(mask*.88+innerFold+halo)*fade*(1.-smoothstep(.91,.99,r));
 gl_FragColor=vec4(color,alpha);
}`;
function createShellRenderer(){
 const surface=document.createElement('canvas');surface.width=surface.height=SHELL_SIZE;
 const gl=surface.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
 let program=null,buffer=null,texture=null,uniforms=null,lost=false;
 const cached=new Map();
 function initialize(){
  if(!gl)return false;
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);return null;}return shader;};
  const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}'),fragment=compile(gl.FRAGMENT_SHADER,SHELL_FRAGMENT);
  if(!vertex||!fragment){if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);return false;}
  program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);program=null;return false;}
  gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,NORMAL_SIZE,NORMAL_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,normalPixels);
  uniforms=Object.fromEntries(['uAge','uSeed','uVariant','uNormalStrength','uNormal'].map(name=>[name,gl.getUniformLocation(program,name)]));gl.uniform1i(uniforms.uNormal,0);gl.viewport(0,0,SHELL_SIZE,SHELL_SIZE);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);return true;
 }
 initialize();
 if(gl){listen(surface,'webglcontextlost',e=>{e.preventDefault();lost=true;});listen(surface,'webglcontextrestored',()=>{lost=!initialize();});}
 const sample=(u,v)=>{const x=((u%1+1)%1)*NORMAL_SIZE,y=((v%1+1)%1)*NORMAL_SIZE,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;return [0,1,2].map(c=>{const at=(a,b)=>normalPixels[((b%NORMAL_SIZE)*NORMAL_SIZE+a%NORMAL_SIZE)*4+c]/255;return(at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;});};
 function fallback(age,variant,strength){
  const step=Math.min(19,Math.floor(age*20)),key=`${variant}:${step}:${strength?1:0}`;if(cached.has(key))return cached.get(key);
  const sprite=document.createElement('canvas');sprite.width=sprite.height=112;const paint=sprite.getContext('2d');if(!paint)return null;const pixels=paint.createImageData(112,112),a=(step+.5)/20,spread=1-(1-a)**2.1,rad=.09+.70*spread,fade=(1-a)**.86*Math.min(1,a/.075);
  for(let y=0;y<112;y++)for(let x=0;x<112;x++){
   const px=(x+.5-56)/56,py=(y+.5-56)/56,r=Math.hypot(px,py);if(Math.abs(r-rad)>.29)continue;
   const angle=Math.atan2(py,px),u=angle/Math.PI+a*.12,v=r*1.8-a*.48+variant*.19,n=sample(u,v),nx=(n[0]*2-1)*strength,ny=(n[1]*2-1)*strength,m=sample(u+nx*.115+a*.035,v+ny*.115-a*.06);
   const thick=.042+.045*(.5+.5*Math.sin(angle*3+m[2]*6+a*2)),d=r-rad-(m[2]-.5)*.075-ny*.018,profile=d/thick,t=Math.max(0,Math.min(1,(Math.abs(profile)/(d<0?1.25:.78)-.18)/1.17)),erosion=Math.max(0,Math.min(1,(m[2]+nx*.10-.19)/.33));
   const mask=(1-t*t*(3-2*t))*erosion,halo=Math.exp(-((d/(thick*2.8))**2))*erosion*.075,light=.56+.28*Math.sin(angle+1.2)+.1*ny,crest=Math.max(0,1-Math.abs(profile-.18))**2,i=(y*112+x)*4;
   const smooth=(a,b,x)=>{const k=Math.max(0,Math.min(1,(x-a)/(b-a)));return k*k*(3-2*k);},pink=smooth(.72,.95,.5+.5*Math.sin(angle*16+m[2]*27-a*5))*smooth(.38,.64,m[2])*.90*(.65+.35*smooth(.15,.85,Math.abs(profile))),white=.15+crest*light*.60,shade=.45+light*.55,innerFold=(1-smooth(.18,1.35,Math.abs(d+thick*.88)/(thick*.30)))*smooth(.40,.64,m[2])*.16;
   pixels.data[i]=255*((.40+.55*white)*(1-pink)+pink)*shade+255*crest*light*.12;pixels.data[i+1]=255*((.72+.26*white)*(1-pink)+.62*pink)*shade+255*crest*light*.14;pixels.data[i+2]=255*(1-.18*pink)*shade+255*crest*light*.16;pixels.data[i+3]=255*(mask*.88+innerFold+halo)*fade*(1-smooth(.91,.99,r));
  }
  paint.putImageData(pixels,0,0);cached.set(key,sprite);return sprite;
 }
 return {get mode(){return gl&&program&&!lost&&!gl.isContextLost()?'webgl':'cached';},get cacheSize(){return cached.size;},draw(age,seed,variant,strength=1){
  if(age>=1)return null;
  if(this.mode==='cached')return fallback(age,variant,strength);
  gl.useProgram(program);gl.uniform1f(uniforms.uAge,age);gl.uniform1f(uniforms.uSeed,seed);gl.uniform1f(uniforms.uVariant,variant);gl.uniform1f(uniforms.uNormalStrength,strength);gl.drawArrays(gl.TRIANGLES,0,6);return surface;
 },destroy(){cached.clear();if(gl){if(texture)gl.deleteTexture(texture);if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}program=null;}};
}
const shell=createShellRenderer();
canvas.dataset.renderer=shell.mode;canvas.dataset.material='polar-normal-shell';canvas.dataset.normalTexture=`${NORMAL_SIZE}x${NORMAL_SIZE}`;canvas.dataset.shellPixels=String(SHELL_SIZE*SHELL_SIZE);
function draw(b,now){
 const age=Math.max(0,Math.min(1,(now-b.born)/b.life));
 const fade=(1-age)**.95,spread=1-(1-age)**1.3,attack=Math.min(1,age/.07);
 const size=b.touch?.62:1,count=b.touch?2:3;
 ctx.save();ctx.globalCompositeOperation='screen';
 for(let i=0;i<count;i++){
  const sprite=clouds[(i+b.variant)%clouds.length];if(!sprite)continue;
  const turn=(i%2?-.28:.34)*age,angle=b.seed+i*2.399+turn;
  const distance=spread*(9+i*4.1)*size;
  const diameter=(25+spread*58)*(.78+i*.085)*size;
  ctx.save();ctx.translate(b.x+Math.cos(angle)*distance,b.y+Math.sin(angle)*distance*.82);
  ctx.rotate(b.seed+i*.71+turn);ctx.scale(1,.78+(i%3)*.11);
  ctx.globalAlpha=fade*attack*(b.touch?.16:.23);
  ctx.drawImage(sprite,-diameter/2,-diameter/2,diameter,diameter);ctx.restore();
 }
 const shellAge=(now-b.born)/(b.touch?690:900),material=shell.draw(shellAge,b.seed,b.variant);
 if(material){const diameter=SHELL_SIZE*size;ctx.globalAlpha=b.touch?.85:1;ctx.drawImage(material,b.x-diameter/2,b.y-diameter/2,diameter,diameter);}
 canvas.dataset.renderer=shell.mode;
 if(flashContext){const diameter=(14+spread*11)*size;ctx.globalAlpha=Math.exp(-age*15)*(b.touch?.22:.32);ctx.drawImage(flash,b.x-diameter/2,b.y-diameter/2,diameter,diameter);}
 // A restrained trace of dust belongs to the slower translucent underlayer.
 ctx.fillStyle='#c9edff';
 for(let i=0;i<(b.touch?1:3);i++){
  const angle=b.seed+i*2.399+age*(i%2?-.5:.65),radius=(5+spread*(23+i*4))*size;
  ctx.globalAlpha=fade*attack*(b.touch?.12:.18);
  ctx.beginPath();ctx.arc(b.x+Math.cos(angle)*radius,b.y+Math.sin(angle)*radius*.84,(.55+(i%3)*.13)*size,0,Math.PI*2);ctx.fill();
 }
 ctx.restore();
}
function tick(now){
 frame=0;if(destroyed||suspended||document.hidden||reduced.matches){stop(reduced.matches?'disabled-motion':'suspended',true);return;}
 if(now-lastDraw>=1000/30){
  lastDraw=now;ctx.clearRect(0,0,width,height);
  for(let i=bursts.length-1;i>=0;i--)if(now-bursts[i].born>=bursts[i].life)bursts.splice(i,1);
  for(const burst of bursts)draw(burst,now);
 }
 if(bursts.length){frame=requestAnimationFrame(tick);state('active');}else stop();
}
function emit(x,y,keyboard,touch){
 if(!ctx||destroyed||suspended||document.hidden||reduced.matches)return;
 const rect=canvas.getBoundingClientRect();if(Math.abs(rect.width-width)>.01||Math.abs(rect.height-height)>.01)resize();
 while(bursts.length>=(touch?1:MAX_BURSTS))bursts.shift();
 const born=performance.now();
 bursts.push({x:x-rect.left,y:y-rect.top,born,life:touch?780:1000,touch,seed:Math.random()*Math.PI*2,variant:Math.floor(Math.random()*4)});
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode='layered-shell-burst';canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(touch?1:MAX_BURSTS);
 if(!frame)frame=requestAnimationFrame(tick);state('active');
}
listen(document,'pointerdown',e=>{
 if(!e.isPrimary||e.button!==0){gesture=null;return;}
 gesture={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),touch:e.pointerType==='touch',dragged:false,ignored:!!e.target.closest?.(ignored)};
},{passive:true});
listen(document,'pointermove',e=>{if(gesture&&gesture.id===e.pointerId&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>8)gesture.dragged=true;},{passive:true});
listen(document,'pointercancel',()=>{if(gesture)gesture.dragged=true;},{passive:true});
listen(window,'scroll',()=>{if(gesture)gesture.dragged=true;},{passive:true,capture:true});
listen(document,'click',e=>{
 if(e.button!==0||!(e.target instanceof Element)||e.target.closest(ignored))return;
 const keyboard=e.detail===0,el=e.target.closest(interactive);
 if(el?.matches(':disabled,[aria-disabled="true"]'))return;
 if(keyboard&&!el)return;
 if(!keyboard&&gesture&&(gesture.dragged||gesture.ignored||performance.now()-gesture.time>1000))return;
 const r=keyboard?el.getBoundingClientRect():null;
 const x=keyboard?r.left+r.width/2:e.clientX,y=keyboard?r.top+r.height/2:e.clientY;
 const touch=!keyboard&&(gesture?.touch||coarse.matches);
 // Spawn the cloud on the next frame, after the control's activation handlers,
 // without delaying native clicks or navigation.
 const id=requestAnimationFrame(()=>{pending.delete(id);emit(x,y,keyboard,touch);});pending.add(id);gesture=null;
},true);
listen(window,'resize',()=>{stop('idle',true);resize();},{passive:true});
listen(window,'blur',()=>stop('suspended',true));
listen(document,'pointerout',e=>{if(e.pointerType==='mouse'&&!e.relatedTarget)stop('idle',true);});
listen(document,'visibilitychange',availability);listen(reduced,'change',availability);
export function destroyClickEffects(){if(destroyed)return;destroyed=true;stop('destroyed',true);shell.destroy();cleanups.splice(0).forEach(fn=>fn());canvas.remove();}
listen(window,'pagehide',e=>{suspended=true;if(e.persisted)availability();else destroyClickEffects();});
listen(window,'pageshow',()=>{suspended=false;availability();});
availability();
