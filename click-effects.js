/* Short, independent activation feedback. Never adds to the cursor trail. */
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const canvas = document.createElement('canvas');
canvas.id = 'click-effects-canvas'; canvas.setAttribute('aria-hidden','true'); canvas.dataset.noTranslate = '';
canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100vh;pointer-events:none;user-select:none;z-index:90;contain:strict;will-change:transform;';
document.body.append(canvas);
const ctx = canvas.getContext('2d', {alpha:true});
const bursts = [], cleanups = [], pending = new Set();
const MAX_BURSTS = 6, EXIT_SLOTS = 2, EXIT_MS = 220;
let width = 0, height = 0, frame = 0, lastDraw = 0, gesture = null, destroyed = false, suspended = false;
const ignored = 'input:not([type=button]):not([type=submit]):not([type=reset]),select,textarea,label,[contenteditable="true"],[role=slider],[data-click-effects="off"]';
const interactive = 'a[href],button,summary,[role=button],input[type=button],input[type=submit],input[type=reset]';
const listen = (target,type,fn,options) => { target.addEventListener(type,fn,options); cleanups.push(()=>target.removeEventListener(type,fn,options)); };
function state(value){canvas.dataset.state=value;canvas.dataset.bursts=String(bursts.length);canvas.dataset.running=String(Boolean(frame));}
function stop(reason='idle',cancelInput=false){
 if(frame)cancelAnimationFrame(frame);frame=0;lastDraw=0;bursts.length=0;
 if(cancelInput){for(const id of pending)cancelAnimationFrame(id);pending.clear();gesture=null;}
 ctx?.clearRect(0,0,width,height);canvas.style.left='0px';canvas.style.top='0px';state(reason);
}
function resize(){
 canvas.style.width=document.documentElement.clientWidth+'px';canvas.style.height=innerHeight+'px';
 canvas.style.left=scrollX+'px';canvas.style.top=scrollY+'px';
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
// One material contains exactly three travelling bands, with no center flash,
// cloud sprites or extra shell. Distances are in CSS pixels before touch scaling.
const RIPPLE_RADIUS=825,RIPPLE_SIZE=RIPPLE_RADIUS*2+42,RIPPLE_DELAY=.14,RIPPLE_DURATION=1.42;
const RIPPLE_WIDTHS=[1,.35,.18],RIPPLE_LIFE=(RIPPLE_DURATION+RIPPLE_DELAY*2)*1000;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function rippleState(elapsed,index){
 const age=(elapsed-index*RIPPLE_DELAY)/RIPPLE_DURATION;
 if(age<=0||age>=1)return null;
 return {age,radius:8+(RIPPLE_RADIUS-8)*(1-(1-age)**1.35),width:RIPPLE_WIDTHS[index],
  opacity:smooth(0,.06,age)*(1-age)**.62*[.92,.52,.34][index]};
}
const RIPPLE_FRAGMENT=`#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;uniform vec2 uSize;uniform float uCount,uScale,uPixel;
uniform vec4 uPulse[8];
void main(){
 vec2 point=vec2(vUv.x,1.-vUv.y)*uSize;
 vec3 rgb=vec3(0.);float opacity=0.;
 float fields[8],radii[8],alphas[8],fades[8];vec3 colors[8];
 // Each click owns three exact circles. At true intersections both circles
 // receive the same short negative-space cut; neither ring covers the other.
 for(int pulse=0;pulse<8;pulse++){
  fields[pulse]=10000.;radii[pulse]=0.;alphas[pulse]=0.;fades[pulse]=0.;colors[pulse]=vec3(0.);
  if(float(pulse)>=uCount)continue;
   vec2 p=(point-uPulse[pulse].xy)/uScale;
   float r=length(p),angle=atan(p.y,p.x),elapsed=uPulse[pulse].z,seed=floor(uPulse[pulse].w*.5)*1.37;
   float exitWeight=mod(uPulse[pulse].w,2.);
  for(int i=0;i<3;i++){
   float width=(i==0?${RIPPLE_WIDTHS[0].toFixed(2)}:i==1?${RIPPLE_WIDTHS[1].toFixed(2)}:${RIPPLE_WIDTHS[2].toFixed(2)})*uScale;
   float index=float(i),age=(elapsed-index*${RIPPLE_DELAY})/${RIPPLE_DURATION};
   if(age<=0.||age>=1.)continue;
   float radius=8.+${RIPPLE_RADIUS-8}.*(1.-pow(1.-age,1.35));
   float strength=i==0?.92:i==1?.52:.34,phase=elapsed+index*.31;
   // The geometry stays circular. Flow affects only the color and luminance.
   float streamA=.5+.5*sin(angle*5.-phase*8.2+sin(angle*3.+phase*2.7)*.65+seed);
   float streamB=.5+.5*sin(angle*11.+phase*5.5+sin(angle*7.-phase*3.1)*.8);
   float flow=pow(streamA,.65)*.62+streamB*.38,localField=abs(r-radius)*uScale-width*.5;
   float localFade=smoothstep(0.,.06,age)*pow(1.-age,.62)*strength*(.76+flow*.24)*exitWeight;
   vec3 localColor=vec3(1.);
   if(localField<fields[pulse]){fields[pulse]=localField;radii[pulse]=radius*uScale;fades[pulse]=localFade;}
   // This bounded texture carries luminance only. The final native circular
   // path clip sets the actual 1/.35/.18px widths, without a magnified AA halo.
   float core=exp(-.5*pow(abs(r-radius)*uScale/max(width*.6,uPixel*1.1),2.));
   float alpha=min(.93,core*localFade),weight=alpha*(1.-alphas[pulse]);
   colors[pulse]+=localColor*weight;alphas[pulse]+=weight;
  }
 }
 for(int pulse=0;pulse<8;pulse++){
  if(float(pulse)>=uCount)continue;
  float keep=1.;
  for(int other=0;other<8;other++){
   if(other==pulse||float(other)>=uCount||fades[other]<=.018)continue;
   vec2 delta=uPulse[other].xy-uPulse[pulse].xy;
   float separation=length(delta),ra=radii[pulse],rb=radii[other];
   // Concentric / nested waves have no crossing and retain all their contours.
   if(separation<=abs(ra-rb)+.1*uScale||separation>=ra+rb-.1*uScale)continue;
   float along=(ra*ra-rb*rb+separation*separation)/(2.*separation);
   float across=sqrt(max(0.,ra*ra-along*along));
   vec2 unit=delta/separation,middle=uPulse[pulse].xy+unit*along;
   vec2 side=vec2(-unit.y,unit.x)*across;
   // Subtract two small disk SDFs at the analytical crossing points. Limiting
   // the cut spatially prevents near-concentric rings from erasing long arcs.
   float gapDistance=min(length(point-middle-side),length(point-middle+side));
   float outside=smoothstep(4.5*uScale,6.5*uScale,gapDistance);
   keep*=mix(1.,outside,smoothstep(.018,.12,fades[other]));
  }
  float alpha=alphas[pulse]*keep;
  rgb+=colors[pulse]*keep*(1.-opacity);opacity+=alpha*(1.-opacity);
 }
 gl_FragColor=vec4(rgb/max(.0001,opacity),opacity);
}`;
// CPU fallback samples the same signed bands and crossing cutouts at a bounded
// resolution. Angular lookups avoid evaluating many sine fields per pixel.
function bandTable(elapsed,index,seed){
 const ring=rippleState(elapsed,index);if(!ring)return null;
 const values=[],phase=elapsed+index*.31;
 for(let n=0;n<=256;n++){
  const angle=n/256*Math.PI*2;
  const radius=ring.radius,width=ring.width;
  const a=angle*5-phase*8.2+Math.sin(angle*3+phase*2.7)*.65+seed;
  const b=angle*11+phase*5.5+Math.sin(angle*7-phase*3.1)*.8;
  values.push({radius,width,a,b});
 }
 return {values,opacity:ring.opacity,index};
}
function createRippleRenderer(){
 const surface=document.createElement('canvas');
 const gl=surface.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
 let program=null,buffer=null,uniforms=null,lost=false;
 const cached=new Map();
 function initialize(){
  if(!gl)return false;
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);return null;}return shader;};
  const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}'),fragment=compile(gl.FRAGMENT_SHADER,RIPPLE_FRAGMENT);
  if(!vertex||!fragment){if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);return false;}
  program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);program=null;return false;}
  gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  uniforms=Object.fromEntries(['Size','Count','Scale','Pixel','Pulse[0]'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);return true;
 }
 initialize();
 if(gl){listen(surface,'webglcontextlost',e=>{e.preventDefault();lost=true;});listen(surface,'webglcontextrestored',()=>{lost=!initialize();});}
 function fallback(group,w,h,scale,now){
  const step=Math.floor((now-group[0].born)/50),key=group.map(b=>`${b.id}@${b.localX.toFixed(1)},${b.localY.toFixed(1)}`).join('|')+`:${w.toFixed(1)},${h.toFixed(1)}:${step}`;
  if(cached.has(key))return cached.get(key);
  const sprite=document.createElement('canvas'),ratio=Math.min(.7,Math.sqrt(12000/(w*h)));
  sprite.width=Math.max(1,Math.floor(w*ratio));sprite.height=Math.max(1,Math.floor(h*ratio));
  const paint=sprite.getContext('2d');if(!paint)return null;
  const data=paint.createImageData(sprite.width,sprite.height),pixel=Math.max(w/sprite.width,h/sprite.height);
  const sampleTime=group[0].born+(step+.5)*50;
  const tables=group.map(b=>({x:b.localX,y:b.localY,weight:b.retiredAt===null?1:1-smooth(0,EXIT_MS,sampleTime-b.retiredAt),bands:[0,1,2].map(i=>bandTable((sampleTime-b.born)/1000,i,b.seed))}));
  for(let y=0;y<sprite.height;y++)for(let x=0;x<sprite.width;x++){
   const px=(x+.5)/sprite.width*w,py=(y+.5)/sprite.height*h;
   const geometry=tables.map(pulse=>{const dx=(px-pulse.x)/scale,dy=(py-pulse.y)/scale;return{radius:Math.hypot(dx,dy),angle:(Math.atan2(dy,dx)/Math.PI/2+1)%1*256};});
   let red=0,green=0,blue=0,opacity=0;const samples=[];
   for(let pulse=0;pulse<tables.length;pulse++){
    const sample={field:10000,radius:0,fade:0,red:0,green:0,blue:0,alpha:0};
    for(let ring=0;ring<3;ring++){
     const band=tables[pulse].bands[ring];if(!band)continue;
     const width=RIPPLE_WIDTHS[ring]*scale;
     const g=geometry[pulse],at=Math.floor(g.angle),fraction=g.angle-at,a=band.values[at],b=band.values[at+1],mix=key=>a[key]+(b[key]-a[key])*fraction;
     const localField=Math.abs(g.radius-mix('radius'))*scale-width*.5,streamA=.5+.5*Math.sin(mix('a')),streamB=.5+.5*Math.sin(mix('b'));
     const flow=streamA**.65*.62+streamB*.38;
     const localFade=band.opacity*(.76+flow*.24)*tables[pulse].weight;
     if(localField<sample.field){sample.field=localField;sample.radius=mix('radius')*scale;sample.fade=localFade;}
     const core=Math.exp(-.5*(Math.abs(g.radius-mix('radius'))*scale/Math.max(width*.6,pixel*1.1))**2);
     const alpha=Math.min(.93,core*localFade),weight=alpha*(1-sample.alpha);
     sample.red+=weight;sample.green+=weight;sample.blue+=weight;sample.alpha+=weight;
    }
    samples.push(sample);
   }
   for(let pulse=0;pulse<samples.length;pulse++){
    const sample=samples[pulse];let keep=1;
    for(let other=0;other<samples.length;other++){
     if(other===pulse||samples[other].fade<=.018)continue;
     const next=samples[other],dx=tables[other].x-tables[pulse].x,dy=tables[other].y-tables[pulse].y,separation=Math.hypot(dx,dy),ra=sample.radius,rb=next.radius;
     if(separation<=Math.abs(ra-rb)+.1*scale||separation>=ra+rb-.1*scale)continue;
     const along=(ra*ra-rb*rb+separation*separation)/(2*separation),across=Math.sqrt(Math.max(0,ra*ra-along*along)),ux=dx/separation,uy=dy/separation;
     const mx=tables[pulse].x+ux*along,my=tables[pulse].y+uy*along,sx=-uy*across,sy=ux*across;
     const gapDistance=Math.min(Math.hypot(px-mx-sx,py-my-sy),Math.hypot(px-mx+sx,py-my+sy)),outside=smooth(4.5*scale,6.5*scale,gapDistance);
     keep*=1-(1-outside)*smooth(.018,.12,next.fade);
    }
    const weight=keep*(1-opacity);red+=sample.red*weight;green+=sample.green*weight;blue+=sample.blue*weight;opacity+=sample.alpha*weight;
   }
   const i=(y*sprite.width+x)*4,denominator=Math.max(.0001,opacity);
   data.data[i]=red/denominator*255;data.data[i+1]=green/denominator*255;data.data[i+2]=blue/denominator*255;data.data[i+3]=opacity*255;
  }
  paint.putImageData(data,0,0);if(cached.size>=32)cached.delete(cached.keys().next().value);cached.set(key,sprite);return sprite;
 }
 return {get mode(){return gl&&program&&!lost&&!gl.isContextLost()?'webgl':'cached';},get cacheSize(){return cached.size;},draw(group,w,h,scale,now,budget){
  if(this.mode==='cached'){const sprite=fallback(group,w,h,scale,now);canvas.dataset.lastTilePixels=String(sprite? sprite.width*sprite.height:0);return sprite;}
  const ratio=Math.min(1,Math.sqrt(Math.min(140000,budget,480000/group.length)/(w*h))),pw=Math.max(1,Math.floor(w*ratio)),ph=Math.max(1,Math.floor(h*ratio));
  if(surface.width!==pw)surface.width=pw;if(surface.height!==ph)surface.height=ph;
  const pulses=new Float32Array(32);
  group.forEach((b,i)=>{const weight=b.retiredAt===null?1:1-smooth(0,EXIT_MS,now-b.retiredAt);pulses.set([b.localX,b.localY,(now-b.born)/1000,b.variant*2+weight],i*4);});
  gl.viewport(0,0,pw,ph);gl.useProgram(program);gl.uniform2f(uniforms.Size,w,h);gl.uniform1f(uniforms.Count,group.length);gl.uniform1f(uniforms.Scale,scale);gl.uniform1f(uniforms.Pixel,Math.max(w/pw,h/ph));
  gl.uniform4fv(uniforms['Pulse[0]'],pulses);gl.drawArrays(gl.TRIANGLES,0,6);
  canvas.dataset.lastTilePixels=String(pw*ph);canvas.dataset.maxTilePixels=String(Math.max(Number(canvas.dataset.maxTilePixels)||0,pw*ph));return surface;
 },destroy(){cached.clear();if(gl){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}program=null;}};
}
const ripples=createRippleRenderer();let nextBurstId=0;
canvas.dataset.renderer=ripples.mode;canvas.dataset.material='three-flowing-ripples';canvas.dataset.rippleCount='3';
canvas.dataset.rippleDelays='0,140,280';canvas.dataset.rippleWidths=RIPPLE_WIDTHS.join(',');canvas.dataset.composition='symmetric-sdf-cutouts';canvas.dataset.anchor='document';
canvas.dataset.crossing='both-rings-cut';canvas.dataset.motion='circular-flow-only';canvas.dataset.scrollProjection='native-document-layer';canvas.dataset.maxRadius=String(RIPPLE_RADIUS);canvas.dataset.clipMode='viewport-css-pixels';canvas.dataset.color='white';canvas.dataset.geometry='native-circular-clip';
function drawBursts(now){
 // Between material frames this absolute layer moves with native page scroll.
 // No scroll handler rebuilds the SDF or waits for the next 30fps material frame.
 canvas.style.left=scrollX+'px';canvas.style.top=scrollY+'px';
 const groups=[];
 for(const burst of bursts){
  const group=[burst],pad=RIPPLE_SIZE*(burst.touch?.68:1);
  for(let i=groups.length-1;i>=0;i--)if(groups[i].some(a=>group.some(b=>a.touch===b.touch&&Math.abs(a.pageX-b.pageX)<pad&&Math.abs(a.pageY-b.pageY)<pad))){group.push(...groups.splice(i,1)[0]);}
  groups.push(group);
 }
 let visibleGroups=0,framePixels=0;const rect=canvas.getBoundingClientRect(),viewLeft=scrollX+rect.left,viewTop=scrollY+rect.top;
 for(const group of groups){
  group.sort((a,b)=>a.id-b.id);
  const scale=group[0].touch?.68:1,pad=RIPPLE_SIZE*scale*.5;
  // Crop the sample domain, never stretch the geometry. An 825px ring may
  // leave the screen without allocating its full 1692px-square bounding box.
  const left=Math.max(Math.min(...group.map(b=>b.pageX))-pad,viewLeft),top=Math.max(Math.min(...group.map(b=>b.pageY))-pad,viewTop);
  const right=Math.min(Math.max(...group.map(b=>b.pageX))+pad,viewLeft+width),bottom=Math.min(Math.max(...group.map(b=>b.pageY))+pad,viewTop+height);
  const w=right-left,h=bottom-top,x=left-viewLeft,y=top-viewTop;
  if(w<=0||h<=0)continue;
  group.forEach(b=>{b.localX=b.pageX-left;b.localY=b.pageY-top;});
  const material=ripples.draw(group,w,h,scale,now,240000/groups.length);if(!material)continue;
  ctx.save();ctx.beginPath();
  // Keep geometry at the main canvas resolution. The cheaper GL texture only
  // carries flow and the SDF cuts, so upscaling it cannot thicken a thin line.
  for(const burst of group)for(let ring=0;ring<3;ring++){
   const band=rippleState((now-burst.born)/1000,ring);if(!band)continue;
   const cx=x+burst.localX,cy=y+burst.localY,r=band.radius*scale,half=band.width*scale*.5;
   ctx.moveTo(cx+r+half,cy);ctx.arc(cx,cy,r+half,0,Math.PI*2);
   ctx.moveTo(cx+r-half,cy);ctx.arc(cx,cy,r-half,0,Math.PI*2,true);
  }
  ctx.clip();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=group[0].touch?.82:1;ctx.drawImage(material,x,y,w,h);ctx.restore();visibleGroups++;framePixels+=Number(canvas.dataset.lastTilePixels)||0;
 }
 canvas.dataset.renderer=ripples.mode;canvas.dataset.groups=String(visibleGroups);canvas.dataset.frameTexturePixels=String(framePixels);
}
function tick(now){
 frame=0;if(destroyed||suspended||document.hidden||reduced.matches){stop(reduced.matches?'disabled-motion':'suspended',true);return;}
 if(now-lastDraw>=1000/30){
  lastDraw=now;ctx.clearRect(0,0,width,height);
  for(let i=bursts.length-1;i>=0;i--)if(now-bursts[i].born>=bursts[i].life||(bursts[i].retiredAt!==null&&now-bursts[i].retiredAt>=EXIT_MS))bursts.splice(i,1);
  drawBursts(now);
 }
 if(bursts.length){frame=requestAnimationFrame(tick);state('active');}else stop();
}
function emit(x,y,keyboard,touch,bornAt=performance.now()){
 if(!ctx||destroyed||suspended||document.hidden||reduced.matches)return;
 const rect=canvas.getBoundingClientRect();if(Math.abs(rect.width-width)>.01||Math.abs(rect.height-height)>.01)resize();
 const born=bornAt;
 const limit=touch?3:MAX_BURSTS,active=bursts.filter(b=>b.retiredAt===null);
 if(active.length>=limit)active[0].retiredAt=born;
 // Normal/nearby clicks never replace an existing pulse. Extreme floods may
 // reclaim only the oldest exit slot; six active desktop pulses stay distinct.
 while(bursts.length>=limit+EXIT_SLOTS){const oldest=bursts.findIndex(b=>b.retiredAt!==null);bursts.splice(oldest<0?0:oldest,1);}
 const variant=Math.floor(Math.random()*4);
 bursts.push({id:++nextBurstId,pageX:x+scrollX,pageY:y+scrollY,born,life:RIPPLE_LIFE,touch,seed:variant*1.37,variant,retiredAt:null});
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode='three-flowing-ripples';canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(limit);canvas.dataset.exitSlots=String(EXIT_SLOTS);
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
 const pageX=x+scrollX,pageY=y+scrollY,bornAt=performance.now();
 const touch=!keyboard&&(gesture?.touch||coarse.matches);
 // Create the independent pulse immediately. Only its drawing waits for RAF;
 // a busy material frame must not coalesce several input births into one time.
 emit(pageX-scrollX,pageY-scrollY,keyboard,touch,bornAt);gesture=null;
},true);
listen(window,'resize',()=>{stop('idle',true);resize();},{passive:true});
listen(window,'blur',()=>stop('suspended',true));
listen(document,'pointerout',e=>{if(e.pointerType==='mouse'&&!e.relatedTarget)stop('idle',true);});
listen(document,'visibilitychange',availability);listen(reduced,'change',availability);
export function destroyClickEffects(){if(destroyed)return;destroyed=true;stop('destroyed',true);ripples.destroy();cleanups.splice(0).forEach(fn=>fn());canvas.remove();}
listen(window,'pagehide',e=>{suspended=true;if(e.persisted)availability();else destroyClickEffects();});
listen(window,'pageshow',()=>{suspended=false;availability();});
availability();
