/* Short, independent activation feedback. Never adds to the cursor trail. */
import {emitNavigationRipple} from './nav-click-effects.js';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const canvas = document.createElement('canvas');
canvas.id = 'click-effects-canvas'; canvas.setAttribute('aria-hidden','true'); canvas.dataset.noTranslate = '';
canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100vh;pointer-events:none;user-select:none;z-index:10;contain:strict;will-change:transform;';
document.body.append(canvas);
const ctx = canvas.getContext('2d', {alpha:true});
const outerSurface=document.createElement('canvas'),outerContext=outerSurface.getContext('2d',{alpha:true});
const bursts = [], cleanups = [], pending = new Set();
// Thirty visible points total, including two short retirement slots.
const MAX_BURSTS = 30, EXIT_SLOTS = 2, EXIT_MS = 220, MATERIAL_BATCH_SIZE = 8;
const CLICKS_PER_GROUP=15,STYLE_COUNT=3;
const CONTINUITY_KEY='portfolio-click-continuity-v1';
// This ordinal belongs to the tab, not to the currently visible circles.
let clickSequence=0;
let width = 0, height = 0, frame = 0, lastDraw = 0, gesture = null, destroyed = false, suspended = false;
const ignored = 'input:not([type=button]):not([type=submit]):not([type=reset]),select,textarea,label,[contenteditable="true"],[role=slider],[data-click-effects="off"]';
const interactive = 'a[href],button,summary,[role=button],input[type=button],input[type=submit],input[type=reset]';
const listen = (target,type,fn,options) => { target.addEventListener(type,fn,options); cleanups.push(()=>target.removeEventListener(type,fn,options)); };
function state(value){canvas.dataset.state=value;canvas.dataset.bursts=String(bursts.length);canvas.dataset.running=String(Boolean(frame));}
function stop(reason='idle',cancelInput=false,preserveBursts=false){
 if(frame)cancelAnimationFrame(frame);frame=0;lastDraw=0;if(!preserveBursts)bursts.length=0;
 if(cancelInput){for(const id of pending)cancelAnimationFrame(id);pending.clear();gesture=null;}
 ctx?.clearRect(0,0,width,height);canvas.style.left='0px';canvas.style.top='0px';state(reason);
}
function resize(){
 canvas.style.width=document.documentElement.clientWidth+'px';canvas.style.height=innerHeight+'px';
 canvas.style.left=scrollX+'px';canvas.style.top=scrollY+'px';
 const r=canvas.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);
 const scale=Math.min(devicePixelRatio||1,1.5,Math.sqrt(4200000/(width*height)));
 canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(height*scale));ctx?.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
 canvas.dataset.pixelBudget=String(canvas.width*canvas.height);
}
function availability(){
 const disabled=!ctx||reduced.matches||document.hidden||suspended;
 canvas.hidden=disabled;
 stop(!ctx?'unsupported':reduced.matches?'disabled-motion':disabled?'suspended':'idle',true,!!ctx&&!reduced.matches);
 if(!disabled){resize();if(bursts.length){frame=requestAnimationFrame(tick);state('active');}}
}
// One material contains exactly three travelling bands, with no center flash,
// cloud sprites or extra shell. Distances are in CSS pixels before touch scaling.
const RIPPLE_RADIUS=825/1.9,RIPPLE_SIZE=RIPPLE_RADIUS*2+42,RIPPLE_BASE_SPEED=1/3/1.5,RIPPLE_SPEED=RIPPLE_BASE_SPEED*1.3;
const RIPPLE_DELAY=.14/RIPPLE_SPEED,RIPPLE_DURATION=1.42/RIPPLE_SPEED,RIPPLE_EASE=1.35;
// A continuous stroke needs pixel coverage, not a subpixel annulus multiplied
// by another low-resolution alpha texture. Keep a readable floor as it ages.
const RIPPLE_WIDTHS=[2.4,1.3,1.7],RIPPLE_MIN_WIDTHS=[1.2,.9,1.05];
// Fade and expansion use independent clocks: half the previous lifetime does
// not accidentally double the requested 1.3x travel speed. Inner rings outlive
// the SDF contour; shortening its alpha also releases its cuts smoothly.
const RIPPLE_LIFE=(1.42+.14*2)/RIPPLE_BASE_SPEED*1000*.5,OUTER_LIFE_SHARE=.56;
const OUTER_FEATHER=18;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function rippleWidthScale(radius){
 const halfRadius=RIPPLE_RADIUS*.1;
 return radius<=halfRadius?1-.5*smooth(8,halfRadius,radius):.5-.25*smooth(halfRadius,RIPPLE_RADIUS,radius);
}
function rippleState(elapsed,index){
 const sinceBirth=elapsed-index*RIPPLE_DELAY,age=sinceBirth/RIPPLE_DURATION;
 const fadeDuration=RIPPLE_LIFE/1000*(index===0?OUTER_LIFE_SHARE:1)-index*RIPPLE_DELAY;
 const fadeAge=sinceBirth/fadeDuration;
 if(age<=0||age>=1||fadeAge>=1)return null;
 // Ease-out preserves the fast start and progressively slower expansion.
 const radius=8+(RIPPLE_RADIUS-8)*(1-(1-age)**RIPPLE_EASE);
 return {age,radius,width:Math.max(RIPPLE_MIN_WIDTHS[index],RIPPLE_WIDTHS[index]*rippleWidthScale(radius)),
  opacity:smooth(0,.115,sinceBirth)*(1-fadeAge)**(index===0?1.1:.62)*[.92,.62,.46][index]};
}
const visualElapsed=(burst,now)=>(now-burst.born)/1000+(burst.outerEnabled?0:RIPPLE_DELAY);
const RIPPLE_FRAGMENT=`#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;uniform vec2 uSize;uniform float uCount,uScale,uPixel,uStyle;
uniform vec4 uPulse[8];
void main(){
 vec2 point=vec2(vUv.x,1.-vUv.y)*uSize;
 vec3 rgb=vec3(0.);float opacity=0.;
 float alphas[8];vec3 colors[8];
 // This material carries light only. Each outer contour receives its own
 // feathered circle-distance mask after sampling, so other bands cannot refill it.
 for(int pulse=0;pulse<8;pulse++){
  alphas[pulse]=0.;colors[pulse]=vec3(0.);
  if(float(pulse)>=uCount)continue;
   vec2 p=(point-uPulse[pulse].xy)/uScale;
   float r=length(p),angle=atan(p.y,p.x),elapsed=uPulse[pulse].z,seed=mod(floor(uPulse[pulse].w*.5),4.)*1.37;
   float exitWeight=mod(uPulse[pulse].w,2.);
  for(int i=0;i<3;i++){
   if(i==0&&uPulse[pulse].w>=8.)continue;
   float baseWidth=(i==0?${RIPPLE_WIDTHS[0].toFixed(8)}:i==1?${RIPPLE_WIDTHS[1].toFixed(8)}:${RIPPLE_WIDTHS[2].toFixed(8)})*uScale;
   float index=float(i),sinceBirth=elapsed-index*${RIPPLE_DELAY},age=sinceBirth/${RIPPLE_DURATION};
   float fadeDuration=${RIPPLE_LIFE/1000}*(i==0?${OUTER_LIFE_SHARE}:1.)-index*${RIPPLE_DELAY};
   float fadeAge=sinceBirth/fadeDuration;
   if(age<=0.||age>=1.||fadeAge>=1.)continue;
   float radius=8.+${(RIPPLE_RADIUS-8).toFixed(8)}*(1.-pow(1.-age,${RIPPLE_EASE}));
   float halfRadius=${(RIPPLE_RADIUS*.1).toFixed(8)};
   float widthScale=radius<=halfRadius?1.-.5*smoothstep(8.,halfRadius,radius):.5-.25*smoothstep(halfRadius,${RIPPLE_RADIUS.toFixed(1)},radius);
   float minWidth=(i==0?1.2:i==1?.9:1.05)*uScale;
   float width=max(minWidth,baseWidth*widthScale);
   float strength=i==0?.92:i==1?.62:.46,phase=elapsed+index*.31;
   // The geometry stays circular. Flow affects only the color and luminance.
   float streamA=.5+.5*sin(angle*5.-phase*8.2+sin(angle*3.+phase*2.7)*.65+seed);
   float streamB=.5+.5*sin(angle*3.+phase*2.5);
   float flow=pow(streamA,.65)*.62+streamB*.38;
   float sweep=pow(.5+.5*sin(angle*3.-phase*4.8+seed+index*1.7),3.);
   float luminance=i==0?.80+flow*.22:.42+flow*.35+sweep*.25;
   float coreScale=1.;vec3 localColor=vec3(1.);
   if(uStyle>.5&&uStyle<1.5){
    // Broad, softly bundled light arcs; geometry is still a complete circle.
    float bundle=pow(.5+.5*sin(angle*2.-phase*3.8+sin(angle*3.+phase*.9)*.4+seed),1.65);
    luminance=i==0?.52+bundle*.65:.40+bundle*.85+pow(streamB,3.)*.18;
    coreScale=1.12;localColor=vec3(.94,.985,1.);
   }else if(uStyle>1.5){
    // Narrower light pulses travel inside the same circular contour.
    float pulseLight=pow(.5+.5*sin(angle*6.-phase*6.6+sin(angle*2.+phase)*.3+seed),9.);
    luminance=i==0?.62+pulseLight*.72:.24+pulseLight*.95;
    coreScale=.80;localColor=vec3(1.,.975,.94);
   }
   float localFade=smoothstep(0.,.115,sinceBirth)*pow(1.-fadeAge,i==0?1.1:.62)*strength*luminance*exitWeight;
   // This bounded texture carries luminance only. The final native circular
   // path clip sets the radius-dependent widths without a magnified AA halo.
   float core=exp(-.5*pow(abs(r-radius)*uScale/max(width*.6*coreScale,uPixel*1.1),2.));
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
function bandTable(elapsed,index,seed,style){
 const ring=rippleState(elapsed,index);if(!ring)return null;
 const values=[],phase=elapsed+index*.31;
 const coreScale=style===1?1.12:style===2?.80:1;
 const color=style===1?[.94,.985,1]:style===2?[1,.975,.94]:[1,1,1];
 for(let n=0;n<=256;n++){
  const angle=n/256*Math.PI*2;
  const radius=ring.radius,width=ring.width;
  const streamA=.5+.5*Math.sin(angle*5-phase*8.2+Math.sin(angle*3+phase*2.7)*.65+seed);
  const streamB=.5+.5*Math.sin(angle*3+phase*2.5);
  const flow=streamA**.65*.62+streamB*.38;
  const sweep=(.5+.5*Math.sin(angle*3-phase*4.8+seed+index*1.7))**3;
  let luminance=index===0?.80+flow*.22:.42+flow*.35+sweep*.25;
  if(style===1){
   const bundle=(.5+.5*Math.sin(angle*2-phase*3.8+Math.sin(angle*3+phase*.9)*.4+seed))**1.65;
   luminance=index===0?.52+bundle*.65:.40+bundle*.85+streamB**3*.18;
  }else if(style===2){
   const pulseLight=(.5+.5*Math.sin(angle*6-phase*6.6+Math.sin(angle*2+phase)*.3+seed))**9;
   luminance=index===0?.62+pulseLight*.72:.24+pulseLight*.95;
  }
  values.push({radius,width,luminance});
 }
 return {values,opacity:ring.opacity,index,coreScale,color};
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
  uniforms=Object.fromEntries(['Size','Count','Scale','Pixel','Style','Pulse[0]'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);return true;
 }
 initialize();
 if(gl){listen(surface,'webglcontextlost',e=>{e.preventDefault();lost=true;});listen(surface,'webglcontextrestored',()=>{lost=!initialize();});}
 function fallback(group,w,h,scale,now){
  const step=Math.floor((now-group[0].born)/50),key=`g${group[0].groupId}:s${group[0].style}:`+group.map(b=>`${b.id}@${b.localX.toFixed(1)},${b.localY.toFixed(1)}`).join('|')+`:${w.toFixed(1)},${h.toFixed(1)}:${step}`;
  if(cached.has(key))return cached.get(key);
  const sprite=document.createElement('canvas'),ratio=Math.min(.7,Math.sqrt(12000/(w*h)));
  sprite.width=Math.max(1,Math.floor(w*ratio));sprite.height=Math.max(1,Math.floor(h*ratio));
  const paint=sprite.getContext('2d');if(!paint)return null;
  const data=paint.createImageData(sprite.width,sprite.height),pixel=Math.max(w/sprite.width,h/sprite.height);
  const sampleTime=group[0].born+(step+.5)*50;
  const tables=group.map(b=>({x:b.localX,y:b.localY,weight:b.retiredAt===null?1:1-smooth(0,EXIT_MS,sampleTime-b.retiredAt),bands:[0,1,2].map(i=>i===0&&!b.outerEnabled?null:bandTable(visualElapsed(b,sampleTime),i,b.seed,b.style))}));
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
     const luminance=mix('luminance');
     const localFade=band.opacity*luminance*tables[pulse].weight;
     const core=Math.exp(-.5*(Math.abs(g.radius-mix('radius'))*scale/Math.max(width*.6*band.coreScale,pixel*1.1))**2);
     const alpha=Math.min(.93,core*localFade),weight=alpha*(1-sample.alpha);
     sample.red+=band.color[0]*weight;sample.green+=band.color[1]*weight;sample.blue+=band.color[2]*weight;sample.alpha+=weight;
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
  // Bit 3 of the packed phase disables the outer band without more uniforms.
  group.forEach((b,i)=>{const weight=b.retiredAt===null?1:1-smooth(0,EXIT_MS,now-b.retiredAt);pulses.set([b.localX,b.localY,visualElapsed(b,now),b.variant*2+weight+(b.outerEnabled?0:8)],i*4);});
  gl.viewport(0,0,pw,ph);gl.useProgram(program);gl.uniform2f(uniforms.Size,w,h);gl.uniform1f(uniforms.Count,group.length);gl.uniform1f(uniforms.Scale,scale);gl.uniform1f(uniforms.Pixel,Math.max(w/pw,h/ph));
  gl.uniform1f(uniforms.Style,group[0].style);
  gl.uniform4fv(uniforms['Pulse[0]'],pulses);gl.drawArrays(gl.TRIANGLES,0,6);
  canvas.dataset.lastTilePixels=String(pw*ph);canvas.dataset.maxTilePixels=String(Math.max(Number(canvas.dataset.maxTilePixels)||0,pw*ph));return surface;
 },destroy(){cached.clear();if(gl){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}program=null;}};
}
const ripples=createRippleRenderer();let nextBurstId=0;
canvas.dataset.renderer=ripples.mode;canvas.dataset.material='three-flowing-ripples';canvas.dataset.rippleCount='3';
canvas.dataset.rippleDelays=[0,1,2].map(index=>index*RIPPLE_DELAY*1000).join(',');canvas.dataset.rippleWidths=RIPPLE_WIDTHS.join(',');canvas.dataset.composition='feathered-outer-circle-subtraction';canvas.dataset.anchor='document';canvas.dataset.overlapFeather=String(OUTER_FEATHER);
canvas.dataset.rippleSpeed=String(RIPPLE_SPEED);canvas.dataset.rippleDuration=String(RIPPLE_DURATION);canvas.dataset.widthHalfRadius=String(RIPPLE_RADIUS*.1);canvas.dataset.widthOrder='outer-thicker';
canvas.dataset.crossing='outer-rings-only';canvas.dataset.motion='circular-flow-only';canvas.dataset.scrollProjection='native-document-layer';canvas.dataset.maxRadius=String(RIPPLE_RADIUS);canvas.dataset.clipMode='viewport-css-pixels';canvas.dataset.color='white';canvas.dataset.geometry='native-circular-clip';
canvas.dataset.groupSize=String(CLICKS_PER_GROUP);canvas.dataset.styleCount=String(STYLE_COUNT);canvas.dataset.groupInteraction='same-group-id-only';
// Boolean subtraction of whole disks with a soft alpha edge. Circle distance
// controls opacity only; neither radius nor the inner bands are distorted.
// Inner bands are drawn separately and do not participate in this operation.
function outerCircleField(now,viewLeft,viewTop){
 const circles=[];
 for(const burst of bursts){
  if(!burst.outerEnabled)continue;
  const scale=burst.touch?.68:1,exitWeight=burst.retiredAt===null?1:1-smooth(0,EXIT_MS,now-burst.retiredAt);
  const band=rippleState((now-burst.born)/1000,0);if(!band)continue;
  const opacity=band.opacity*exitWeight;if(opacity<=.008)continue;
  circles.push({id:burst.id,groupId:burst.groupId,x:burst.pageX-viewLeft,y:burst.pageY-viewTop,radius:band.radius*scale,opacity,scale});
 }
 canvas.dataset.cutoutResolution='independent-contour-alpha';
 return circles;
}
function featherOuterContour(material,x,y,w,h,cx,cy,r,half,occluders){
 if(!outerContext||!occluders.length)return null;
 const left=Math.max(0,cx-r-half-2),top=Math.max(0,cy-r-half-2);
 const right=Math.min(width,cx+r+half+2),bottom=Math.min(height,cy+r+half+2);
 const tw=right-left,th=bottom-top;if(tw<=0||th<=0)return null;
 const ratio=Math.min(1,Math.sqrt(600000/(tw*th)));
 const pw=Math.max(1,Math.ceil(tw*ratio)),ph=Math.max(1,Math.ceil(th*ratio));
 if(outerSurface.width!==pw)outerSurface.width=pw;if(outerSurface.height!==ph)outerSurface.height=ph;
 outerContext.setTransform(pw/tw,0,0,ph/th,0,0);
 outerContext.globalCompositeOperation='source-over';outerContext.globalAlpha=1;outerContext.clearRect(0,0,tw,th);
 outerContext.drawImage(material,x-left,y-top,w,h);
 outerContext.globalCompositeOperation='destination-out';
 for(const other of occluders){
  const ox=other.x-left,oy=other.y-top,feather=OUTER_FEATHER;
  const mask=outerContext.createRadialGradient(ox,oy,other.radius,ox,oy,other.radius+feather);
  const strength=smooth(.008,.18,other.opacity)*smooth(0,OUTER_FEATHER,other.partialDepth);
  // sdCircle = distance - radius. Sample 1 - smoothstep(0, feather, sd)
  // as a radial alpha mask. Every disk is applied independently (no XOR).
  for(let stop=0;stop<=12;stop++){
   const t=stop/12,alpha=(1-smooth(0,1,t))*strength;
   mask.addColorStop(t,`rgba(0,0,0,${alpha})`);
  }
  outerContext.fillStyle=mask;outerContext.fillRect(0,0,tw,th);
 }
 outerContext.globalCompositeOperation='source-over';
 return {surface:outerSurface,x:left,y:top,w:tw,h:th};
}
function drawBursts(now){
 // Between material frames this absolute layer moves with native page scroll.
 // No scroll handler rebuilds the SDF or waits for the next 30fps material frame.
 canvas.style.left=scrollX+'px';canvas.style.top=scrollY+'px';
 canvas.dataset.godray='background-only';
 const clusters=[];
 for(const burst of bursts){
  const group=[burst],pad=RIPPLE_SIZE*(burst.touch?.68:1);
  for(let i=clusters.length-1;i>=0;i--)if(clusters[i].some(a=>group.some(b=>a.groupId===b.groupId&&a.touch===b.touch&&Math.abs(a.pageX-b.pageX)<pad&&Math.abs(a.pageY-b.pageY)<pad))){group.push(...clusters.splice(i,1)[0]);}
  clusters.push(group);
 }
 // Keep eight pulses per material and one style uniform. Batches are isolated
 // by groupId, while their outer SDF field still spans every batch of that group.
 const groups=[];
 for(const cluster of clusters){
  cluster.sort((a,b)=>a.id-b.id);
  for(let offset=0;offset<cluster.length;offset+=MATERIAL_BATCH_SIZE)groups.push(cluster.slice(offset,offset+MATERIAL_BATCH_SIZE));
 }
 let visibleGroups=0,framePixels=0;const rect=canvas.getBoundingClientRect(),viewLeft=scrollX+rect.left,viewTop=scrollY+rect.top;
 const circles=outerCircleField(now,viewLeft,viewTop);
 for(const group of groups){
  group.sort((a,b)=>a.id-b.id);
  const scale=group[0].touch?.68:1,pad=RIPPLE_SIZE*scale*.5;
  // Crop the sample domain, never stretch the geometry. Rings may leave the
  // screen without allocating their full RIPPLE_SIZE-square bounding box.
  const left=Math.max(Math.min(...group.map(b=>b.pageX))-pad,viewLeft),top=Math.max(Math.min(...group.map(b=>b.pageY))-pad,viewTop);
  const right=Math.min(Math.max(...group.map(b=>b.pageX))+pad,viewLeft+width),bottom=Math.min(Math.max(...group.map(b=>b.pageY))+pad,viewTop+height);
  const w=right-left,h=bottom-top,x=left-viewLeft,y=top-viewTop;
  if(w<=0||h<=0)continue;
  group.forEach(b=>{b.localX=b.pageX-left;b.localY=b.pageY-top;});
  const material=ripples.draw(group,w,h,scale,now,240000/groups.length);if(!material)continue;
  // Draw each contour independently so an outer cut cannot erase an inner ring
  // or another click's unrelated contour underneath it.
  for(const burst of group)for(let ring=0;ring<3;ring++){
   if(ring===0&&!burst.outerEnabled)continue;
   const band=rippleState(visualElapsed(burst,now),ring);if(!band)continue;
   const cx=x+burst.localX,cy=y+burst.localY,r=band.radius*scale;
   const half=Math.max(band.width*scale,.95*width/canvas.width)*.5;
   ctx.save();ctx.beginPath();
   ctx.moveTo(cx+r+half,cy);ctx.arc(cx,cy,r+half,0,Math.PI*2);
   ctx.moveTo(cx+r-half,cy);ctx.arc(cx,cy,r-half,0,Math.PI*2,true);
   ctx.clip();
   const occluders=[];
   if(ring===0)for(const other of circles){
    if(other.id===burst.id||other.groupId!==burst.groupId)continue;
    const distance=Math.hypot(cx-other.x,cy-other.y);
    const partialDepth=Math.min(distance-Math.abs(r-other.radius),r+other.radius-distance);
    // Only partial intersection cuts arcs. Concentric/contained circles and
    // both kinds of tangency stay whole; the pair's influence eases in afterward.
    if(partialDepth>0)occluders.push({...other,partialDepth});
   }
   const feathered=featherOuterContour(material,x,y,w,h,cx,cy,r,half,occluders);
   ctx.globalCompositeOperation='source-over';ctx.globalAlpha=burst.touch?.82:1;
   if(feathered)ctx.drawImage(feathered.surface,feathered.x,feathered.y,feathered.w,feathered.h);
   else ctx.drawImage(material,x,y,w,h);
   ctx.restore();
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
 const pageX=x+scrollX,pageY=y+scrollY;
 const groupId=Math.floor(clickSequence/CLICKS_PER_GROUP),style=groupId%STYLE_COUNT;
 clickSequence++;
 // Capture containment at birth. A nested click stays a two-ring accent for
 // its entire life, even if its containing circle later fades or moves away.
 const outerEnabled=!bursts.some(other=>{
  if(!other.outerEnabled||other.groupId!==groupId)return false;
  const band=rippleState((born-other.born)/1000,0);if(!band)return false;
  const weight=other.retiredAt===null?1:1-smooth(0,EXIT_MS,born-other.retiredAt);
  return band.opacity*weight>.008&&Math.hypot(pageX-other.pageX,pageY-other.pageY)<band.radius*(other.touch?.68:1);
 });
 const limit=MAX_BURSTS-EXIT_SLOTS,active=bursts.filter(b=>b.retiredAt===null);
 if(active.length>=limit)active[0].retiredAt=born;
 // Normal/nearby clicks never replace an existing pulse. Extreme floods may
 // reclaim only the oldest exit slot; 28 normal + 2 retiring points never exceed 30.
 while(bursts.length>=MAX_BURSTS){const oldest=bursts.findIndex(b=>b.retiredAt!==null);bursts.splice(oldest<0?0:oldest,1);}
 const variant=Math.floor(Math.random()*4);
 bursts.push({id:++nextBurstId,groupId,style,pageX,pageY,born,life:RIPPLE_LIFE-(outerEnabled?0:RIPPLE_DELAY*1000),touch,outerEnabled,seed:variant*1.37,variant,retiredAt:null});
 canvas.dataset.clickSequence=String(clickSequence);canvas.dataset.currentGroup=String(groupId);canvas.dataset.currentStyle=String(style);
 canvas.dataset.lastOuterEnabled=String(outerEnabled);canvas.dataset.overlapRule='partial-intersections-only';
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode='three-flowing-ripples';canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(MAX_BURSTS);canvas.dataset.maxActive=String(limit);canvas.dataset.exitSlots=String(EXIT_SLOTS);
 if(!frame)frame=requestAnimationFrame(tick);state('active');
 saveContinuity();
}
function saveContinuity(){
 const now=performance.now();
 try{sessionStorage.setItem(CONTINUITY_KEY,JSON.stringify({version:2,sequence:clickSequence,savedAt:Date.now(),pulses:bursts.map(b=>({groupId:b.groupId,style:b.style,x:b.pageX-scrollX,y:b.pageY-scrollY,age:now-b.born,touch:b.touch,outerEnabled:b.outerEnabled,variant:b.variant,retiredAge:b.retiredAt===null?null:now-b.retiredAt}))}));}catch{}
}
function restoreContinuity(){
 if(destroyed||suspended)return;
 let saved;try{const value=sessionStorage.getItem(CONTINUITY_KEY);if(!value)return;saved=JSON.parse(value);}catch{return;}
 if(!saved||typeof saved!=='object')return;
 const pulses=Array.isArray(saved.pulses)?saved.pulses:[];
 const maxGroupId=Math.floor((Number.MAX_SAFE_INTEGER-CLICKS_PER_GROUP)/CLICKS_PER_GROUP);
 const validGroup=id=>Number.isSafeInteger(id)&&id>=0&&id<=maxGroupId;
 let latestGroup=-1;
 for(const pulse of pulses)if(pulse&&validGroup(pulse.groupId))latestGroup=Math.max(latestGroup,pulse.groupId);
 const validSequence=Number.isSafeInteger(saved.sequence)&&saved.sequence>=0;
 let restoredSequence=validSequence?saved.sequence:0;
 // A partial/new-format record must never let a later click reuse an older
 // group's identity. Pre-group records use the reserved legacy group -1.
 const lastRecordedGroup=Math.floor((restoredSequence-1)/CLICKS_PER_GROUP);
 if(latestGroup>=0&&(!validSequence||latestGroup>lastRecordedGroup))restoredSequence=(latestGroup+1)*CLICKS_PER_GROUP;
 clickSequence=Math.max(clickSequence,restoredSequence);
 canvas.dataset.clickSequence=String(clickSequence);
 const currentGroup=Math.floor(Math.max(0,clickSequence-1)/CLICKS_PER_GROUP);
 canvas.dataset.currentGroup=String(currentGroup);canvas.dataset.currentStyle=String(currentGroup%STYLE_COUNT);
 // Consume only the carried visuals. Keep the tab's ordinal even if the gap
 // is long, every circle has expired, or motion is currently disabled.
 try{sessionStorage.setItem(CONTINUITY_KEY,JSON.stringify({version:2,sequence:clickSequence,savedAt:Date.now(),pulses:[]}));}catch{}
 if(document.hidden||reduced.matches||!ctx)return;
 const gap=Date.now()-saved?.savedAt;
 if(!Number.isFinite(gap)||gap<0||gap>RIPPLE_LIFE)return;
 const now=performance.now();
 for(const p of pulses.slice(-MAX_BURSTS)){
  if(bursts.length>=MAX_BURSTS)break;
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.age))continue;
  const outerEnabled=p.outerEnabled!==false,age=Math.max(0,p.age)+gap;
  const life=RIPPLE_LIFE-(outerEnabled?0:RIPPLE_DELAY*1000);
  const retiredAge=p.retiredAge==null?null:Number(p.retiredAge)+gap;
  if(age>=life||retiredAge!==null&&(!Number.isFinite(retiredAge)||retiredAge>=EXIT_MS))continue;
  const variant=Math.max(0,Math.min(3,Math.floor(Number(p.variant)||0)));
  const groupId=validGroup(p.groupId)?p.groupId:-1,style=groupId<0?0:groupId%STYLE_COUNT;
  bursts.push({id:++nextBurstId,groupId,style,pageX:p.x+scrollX,pageY:p.y+scrollY,born:now-age,life,touch:!!p.touch,outerEnabled,variant,seed:variant*1.37,retiredAt:retiredAge===null?null:now-retiredAge});
 }
 if(bursts.length&&!frame){frame=requestAnimationFrame(tick);state('active');}
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
 if(el?.closest('.header')){emitNavigationRipple(x,y);gesture=null;return;}
 const pageX=x+scrollX,pageY=y+scrollY,bornAt=performance.now();
 const touch=!keyboard&&(gesture?.touch||coarse.matches);
 // Create the independent pulse immediately. Only its drawing waits for RAF;
 // a busy material frame must not coalesce several input births into one time.
 emit(pageX-scrollX,pageY-scrollY,keyboard,touch,bornAt);gesture=null;
},true);
listen(window,'resize',availability,{passive:true});
// A completed click belongs to the page, even when focus enters a player or
// the pointer leaves the window. Only unfinished pointer gestures are canceled.
listen(window,'blur',()=>{gesture=null;});
listen(document,'pointerout',e=>{if(e.pointerType==='mouse'&&!e.relatedTarget)gesture=null;});
listen(document,'visibilitychange',availability);listen(reduced,'change',availability);
export function destroyClickEffects(){if(destroyed)return;destroyed=true;stop('destroyed',true);ripples.destroy();cleanups.splice(0).forEach(fn=>fn());canvas.remove();}
listen(window,'pagehide',e=>{saveContinuity();suspended=true;if(e.persisted)availability();else destroyClickEffects();});
listen(window,'pageshow',e=>{suspended=false;if(e.persisted){stop('idle',true);availability();}restoreContinuity();});
availability();
restoreContinuity();
