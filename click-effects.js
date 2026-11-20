/* Short, independent activation feedback. Never adds to the cursor trail. */
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const canvas = document.createElement('canvas');
canvas.id = 'click-effects-canvas'; canvas.setAttribute('aria-hidden','true'); canvas.dataset.noTranslate = '';
canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100vh;pointer-events:none;user-select:none;z-index:90;contain:strict;will-change:transform;';
document.body.append(canvas);
const ctx = canvas.getContext('2d', {alpha:true});
const raySource=document.createElement('canvas'),rayContext=raySource.getContext('2d',{alpha:true});
const rayPointer={x:innerWidth*.5,y:innerHeight*.5};
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
const RIPPLE_RADIUS=825,RIPPLE_SIZE=RIPPLE_RADIUS*2+42,RIPPLE_SPEED=1/3;
const RIPPLE_DELAY=.14/RIPPLE_SPEED,RIPPLE_DURATION=1.42/RIPPLE_SPEED,RIPPLE_EASE=1.35;
// The first band is outermost. Keep the inner bands stronger, at one third
// of the previous width range; expanding bands lose thickness independently.
const RIPPLE_WIDTHS=[.18,.35,1].map(width=>width/3),RIPPLE_LIFE=(RIPPLE_DURATION+RIPPLE_DELAY*2)*1000;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function rippleWidthScale(radius){
 const halfRadius=RIPPLE_RADIUS*.1;
 return radius<=halfRadius?1-.5*smooth(8,halfRadius,radius):.5-.25*smooth(halfRadius,RIPPLE_RADIUS,radius);
}
function rippleState(elapsed,index){
 const age=(elapsed-index*RIPPLE_DELAY)/RIPPLE_DURATION;
 if(age<=0||age>=1)return null;
 // The time scale reduces travel speed to one third. Ease-out makes its
 // derivative decrease continuously to zero, without a late snap or stop.
 const radius=8+(RIPPLE_RADIUS-8)*(1-(1-age)**RIPPLE_EASE);
 return {age,radius,width:RIPPLE_WIDTHS[index]*rippleWidthScale(radius),
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
 float alphas[8];vec3 colors[8];
 // This pass carries light only. Outer-ring SDF cuts are applied independently
 // at native geometry resolution so neither inner band can inherit a cut.
 for(int pulse=0;pulse<8;pulse++){
  alphas[pulse]=0.;colors[pulse]=vec3(0.);
  if(float(pulse)>=uCount)continue;
   vec2 p=(point-uPulse[pulse].xy)/uScale;
   float r=length(p),angle=atan(p.y,p.x),elapsed=uPulse[pulse].z,seed=floor(uPulse[pulse].w*.5)*1.37;
   float exitWeight=mod(uPulse[pulse].w,2.);
  for(int i=0;i<3;i++){
   float baseWidth=(i==0?${RIPPLE_WIDTHS[0].toFixed(8)}:i==1?${RIPPLE_WIDTHS[1].toFixed(8)}:${RIPPLE_WIDTHS[2].toFixed(8)})*uScale;
   float index=float(i),age=(elapsed-index*${RIPPLE_DELAY})/${RIPPLE_DURATION};
   if(age<=0.||age>=1.)continue;
   float radius=8.+${RIPPLE_RADIUS-8}.*(1.-pow(1.-age,${RIPPLE_EASE}));
   float halfRadius=${(RIPPLE_RADIUS*.1).toFixed(8)};
   float widthScale=radius<=halfRadius?1.-.5*smoothstep(8.,halfRadius,radius):.5-.25*smoothstep(halfRadius,${RIPPLE_RADIUS.toFixed(1)},radius);
   float width=baseWidth*widthScale;
   float strength=i==0?.92:i==1?.52:.34,phase=elapsed+index*.31;
   // The geometry stays circular. Flow affects only the color and luminance.
   float streamA=.5+.5*sin(angle*5.-phase*8.2+sin(angle*3.+phase*2.7)*.65+seed);
   float streamB=.5+.5*sin(angle*11.+phase*5.5+sin(angle*7.-phase*3.1)*.8);
   float flow=pow(streamA,.65)*.62+streamB*.38;
   float localFade=smoothstep(0.,.06,age)*pow(1.-age,.62)*strength*(.76+flow*.24)*exitWeight;
   vec3 localColor=vec3(1.);
   // This bounded texture carries luminance only. The final native circular
   // path clip sets the radius-dependent widths without a magnified AA halo.
   float core=exp(-.5*pow(abs(r-radius)*uScale/max(width*.6,uPixel*1.1),2.));
   float alpha=min(.93,core*localFade),weight=alpha*(1.-alphas[pulse]);
   colors[pulse]+=localColor*weight;alphas[pulse]+=weight;
  }
 }
 for(int pulse=0;pulse<8;pulse++){
  if(float(pulse)>=uCount)continue;
  rgb+=colors[pulse]*(1.-opacity);opacity+=alphas[pulse]*(1.-opacity);
 }
 gl_FragColor=vec4(rgb/max(.0001,opacity),opacity);
}`;
// CPU fallback samples the same light bands at a bounded resolution. Angular
// lookups avoid evaluating many sine fields per pixel; native cuts stay separate.
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
    const sample={red:0,green:0,blue:0,alpha:0};
    for(let ring=0;ring<3;ring++){
     const band=tables[pulse].bands[ring];if(!band)continue;
     const g=geometry[pulse],at=Math.floor(g.angle),fraction=g.angle-at,a=band.values[at],b=band.values[at+1],mix=key=>a[key]+(b[key]-a[key])*fraction;
     const width=mix('width')*scale;
     const streamA=.5+.5*Math.sin(mix('a')),streamB=.5+.5*Math.sin(mix('b'));
     const flow=streamA**.65*.62+streamB*.38;
     const localFade=band.opacity*(.76+flow*.24)*tables[pulse].weight;
     const core=Math.exp(-.5*(Math.abs(g.radius-mix('radius'))*scale/Math.max(width*.6,pixel*1.1))**2);
     const alpha=Math.min(.93,core*localFade),weight=alpha*(1-sample.alpha);
     sample.red+=weight;sample.green+=weight;sample.blue+=weight;sample.alpha+=weight;
    }
    samples.push(sample);
   }
   for(let pulse=0;pulse<samples.length;pulse++){
    const sample=samples[pulse],weight=1-opacity;
    red+=sample.red*weight;green+=sample.green*weight;blue+=sample.blue*weight;opacity+=sample.alpha*weight;
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
canvas.dataset.rippleDelays=[0,1,2].map(index=>index*RIPPLE_DELAY*1000).join(',');canvas.dataset.rippleWidths=RIPPLE_WIDTHS.join(',');canvas.dataset.composition='symmetric-sdf-cutouts';canvas.dataset.anchor='document';
canvas.dataset.rippleSpeed=String(RIPPLE_SPEED);canvas.dataset.rippleDuration=String(RIPPLE_DURATION);canvas.dataset.widthHalfRadius=String(RIPPLE_RADIUS*.1);canvas.dataset.widthOrder='inner-thicker';
canvas.dataset.crossing='outer-rings-only';canvas.dataset.motion='circular-flow-only';canvas.dataset.scrollProjection='native-document-layer';canvas.dataset.maxRadius=String(RIPPLE_RADIUS);canvas.dataset.clipMode='viewport-css-pixels';canvas.dataset.color='white';canvas.dataset.geometry='native-circular-clip';
// Radial texture accumulation, restricted to the outer shell. The light origin
// follows viewport pointer coordinates; the emitting rings stay in the document.
function drawOuterGodrays(material,group,x,y,w,h,scale,now,loudness){
 if(!rayContext)return;
 const bands=group.map(burst=>({burst,band:rippleState((now-burst.born)/1000,0)})).filter(item=>item.band);
 if(!bands.length)return;
 const ratio=Math.min(.6,Math.sqrt(48000/(w*h))),pw=Math.max(1,Math.ceil(w*ratio)),ph=Math.max(1,Math.ceil(h*ratio));
 if(raySource.width!==pw)raySource.width=pw;if(raySource.height!==ph)raySource.height=ph;
 rayContext.setTransform(pw/w,0,0,ph/h,0,0);rayContext.clearRect(0,0,w,h);
 rayContext.save();rayContext.beginPath();
 for(const {burst,band} of bands){
  const cx=burst.localX,cy=burst.localY,r=band.radius*scale,half=1.8*scale;
  rayContext.moveTo(cx+r+half,cy);rayContext.arc(cx,cy,r+half,0,Math.PI*2);
  rayContext.moveTo(cx+r-half,cy);rayContext.arc(cx,cy,r-half,0,Math.PI*2,true);
 }
 rayContext.clip();rayContext.drawImage(material,0,0,w,h);rayContext.restore();
 const strength=.022+loudness*.065,reach=(28+loudness*46)*scale;
 const steps=coarse.matches?12:18,decay=.88,normalizer=(1-decay**steps)/(1-decay);
 const stretchRange=reach/Math.max(180,Math.hypot(width,height)*.5);
 ctx.save();ctx.beginPath();
 for(const {burst,band} of bands){
  const cx=x+burst.localX,cy=y+burst.localY,r=band.radius*scale;
  ctx.moveTo(cx+r+reach*2,cy);ctx.arc(cx,cy,r+reach*2,0,Math.PI*2);
  ctx.moveTo(cx+r+2*scale,cy);ctx.arc(cx,cy,r+2*scale,0,Math.PI*2,true);
 }
 ctx.clip();ctx.globalCompositeOperation='screen';
 for(let sample=1;sample<=steps;sample++){
  const stretch=1+stretchRange*sample/steps;
  ctx.globalAlpha=strength*decay**(sample-1)/normalizer;
  ctx.drawImage(raySource,rayPointer.x+(x-rayPointer.x)*stretch,rayPointer.y+(y-rayPointer.y)*stretch,w*stretch,h*stretch);
 }
 ctx.restore();canvas.dataset.rayStrength=strength.toFixed(4);canvas.dataset.raySourcePixels=String(pw*ph);
}
// Only the outer band of each click participates in the intersection field.
// The disks become negative space in that band's clip, never in the whole image.
function outerIntersectionCutouts(now,viewLeft,viewTop){
 const circles=[];
 for(const burst of bursts){
  const scale=burst.touch?.68:1,exitWeight=burst.retiredAt===null?1:1-smooth(0,EXIT_MS,now-burst.retiredAt);
  const band=rippleState((now-burst.born)/1000,0);if(!band)continue;
  const opacity=band.opacity*exitWeight;if(opacity<=.008)continue;
  circles.push({id:burst.id,x:burst.pageX-viewLeft,y:burst.pageY-viewTop,radius:band.radius*scale,opacity,scale});
 }
 const cuts=[];
 for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++){
  const a=circles[i],b=circles[j];if(a.id===b.id)continue;
  const dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),ra=a.radius,rb=b.radius;
  if(distance<=Math.abs(ra-rb)+.1||distance>=ra+rb-.1)continue;
  const along=(ra*ra-rb*rb+distance*distance)/(2*distance),across=Math.sqrt(Math.max(0,ra*ra-along*along));
  const ux=dx/distance,uy=dy/distance,mx=a.x+ux*along,my=a.y+uy*along,sx=-uy*across,sy=ux*across;
  const cutRadius=9*Math.min(a.scale,b.scale)*smooth(.008,.06,Math.min(a.opacity,b.opacity));
  for(const sign of [-1,1]){
   const x=mx+sx*sign,y=my+sy*sign;
   if(x+cutRadius<0||x-cutRadius>width||y+cutRadius<0||y-cutRadius>height)continue;
   cuts.push({x,y,radius:cutRadius,ids:[a.id,b.id]});
  }
 }
 canvas.dataset.intersectionCuts=String(cuts.length);canvas.dataset.cutoutResolution='native-outer-geometry';
 return cuts;
}
function drawBursts(now){
 // Between material frames this absolute layer moves with native page scroll.
 // No scroll handler rebuilds the SDF or waits for the next 30fps material frame.
 canvas.style.left=scrollX+'px';canvas.style.top=scrollY+'px';
 const audio=window.PortfolioAudioAnalysis?.getLevels(),loudness=audio?.active?Math.max(0,Math.min(1,audio.loudness||0)):0;
 canvas.dataset.rayCenter='pointer';canvas.dataset.rayControl='audio-loudness';canvas.dataset.rayLoudness=loudness.toFixed(4);canvas.dataset.rayStrength='0';
 const groups=[];
 for(const burst of bursts){
  const group=[burst],pad=RIPPLE_SIZE*(burst.touch?.68:1);
  for(let i=groups.length-1;i>=0;i--)if(groups[i].some(a=>group.some(b=>a.touch===b.touch&&Math.abs(a.pageX-b.pageX)<pad&&Math.abs(a.pageY-b.pageY)<pad))){group.push(...groups.splice(i,1)[0]);}
  groups.push(group);
 }
 let visibleGroups=0,framePixels=0;const rect=canvas.getBoundingClientRect(),viewLeft=scrollX+rect.left,viewTop=scrollY+rect.top;
 const cuts=outerIntersectionCutouts(now,viewLeft,viewTop);
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
  drawOuterGodrays(material,group,x,y,w,h,scale,now,loudness);
  // Draw each contour independently so an outer cut cannot erase an inner ring
  // or another click's unrelated contour underneath it.
  for(const burst of group)for(let ring=0;ring<3;ring++){
   const band=rippleState((now-burst.born)/1000,ring);if(!band)continue;
   const cx=x+burst.localX,cy=y+burst.localY,r=band.radius*scale,half=band.width*scale*.5;
   ctx.save();ctx.beginPath();
   ctx.moveTo(cx+r+half,cy);ctx.arc(cx,cy,r+half,0,Math.PI*2);
   ctx.moveTo(cx+r-half,cy);ctx.arc(cx,cy,r-half,0,Math.PI*2,true);
   ctx.clip();
   if(ring===0)for(const cut of cuts){
    if(!cut.ids.includes(burst.id))continue;
    // Sequential disk subtraction also keeps overlapping cut masks closed.
    ctx.beginPath();ctx.rect(0,0,width,height);ctx.moveTo(cut.x+cut.radius,cut.y);ctx.arc(cut.x,cut.y,cut.radius,0,Math.PI*2);ctx.clip('evenodd');
   }
   ctx.globalCompositeOperation='source-over';ctx.globalAlpha=burst.touch?.82:1;ctx.drawImage(material,x,y,w,h);ctx.restore();
  }
  visibleGroups++;framePixels+=Number(canvas.dataset.lastTilePixels)||0;
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
 rayPointer.x=e.clientX;rayPointer.y=e.clientY;
 gesture={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),touch:e.pointerType==='touch',dragged:false,ignored:!!e.target.closest?.(ignored)};
},{passive:true});
listen(document,'pointermove',e=>{rayPointer.x=e.clientX;rayPointer.y=e.clientY;if(gesture&&gesture.id===e.pointerId&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>8)gesture.dragged=true;},{passive:true});
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
 if(keyboard){rayPointer.x=x;rayPointer.y=y;}
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
