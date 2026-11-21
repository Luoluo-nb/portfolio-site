/* Short, independent activation feedback. Never adds to the cursor trail. */
import {emitNavigationRipple} from './nav-click-effects.js';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const canvas = document.createElement('canvas');
canvas.id = 'click-effects-canvas'; canvas.setAttribute('aria-hidden','true'); canvas.dataset.noTranslate = '';
canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100vh;pointer-events:none;user-select:none;z-index:10;contain:strict;will-change:transform;';
document.body.append(canvas);
const ctx = canvas.getContext('2d', {alpha:true});
const ambientCanvas=document.createElement('canvas');
ambientCanvas.id='ambient-rings-canvas';ambientCanvas.setAttribute('aria-hidden','true');ambientCanvas.dataset.noTranslate='';
// body isolates its stack: -2 is the fallback background and the earlier -1
// starfield paints before this -1 sibling. All normal text stays above both.
ambientCanvas.style.cssText='position:absolute;top:0;left:0;width:100%;height:100vh;pointer-events:none;user-select:none;z-index:-1;contain:strict;will-change:transform;';
document.body.append(ambientCanvas);
const ambientCtx=ambientCanvas.getContext('2d',{alpha:true});
const projectionCanvas=ctx?canvas:ambientCanvas;
const outerSurface=document.createElement('canvas'),outerContext=outerSurface.getContext('2d',{alpha:true});
const bursts = [], ambientWaves = [], repeatQueue = [], cleanups = [], pending = new Set();
// Three independent fifteen-click groups own the live SDF slots. Inner-only
// afterglow and short group exits have their own bounded visual allowance.
const CLICKS_PER_GROUP=15,STYLE_COUNT=3,MAX_MAIN_GROUPS=3;
const MAX_BURSTS=CLICKS_PER_GROUP*MAX_MAIN_GROUPS,MAX_TAIL_BURSTS=90,MAX_VISUAL_BURSTS=MAX_BURSTS+MAX_TAIL_BURSTS;
const EXIT_MS=280,MIN_VISIBLE_MS=180,MATERIAL_BATCH_SIZE=8,MATERIAL_PIXEL_BUDGET=240000,FEATHER_PIXEL_BUDGET=1200000;
const AUTO_MIN_MS=6000,AUTO_MAX_MS=8000,AMBIENT_PIXEL_BUDGET=900000;
const REPEAT_DELAY_MS=200,MAX_PENDING_REPEATS=90;
const CROWDED_ENTER=36,CROWDED_EXIT=18,CROWDED_WIDTH=1.2;
const CONTINUITY_KEY='portfolio-click-continuity-v1';
// This ordinal belongs to the tab, not to the currently visible circles.
let clickSequence=0,crowdedMode=false;
let width = 0, height = 0, frame = 0, lastDraw = 0, gesture = null, destroyed = false, suspended = false;
let autoTimer=0,repeatTimer=0,repeatsPaused=false;
const ignored = 'input:not([type=button]):not([type=submit]):not([type=reset]),select,textarea,label,[contenteditable="true"],[role=slider],[data-click-effects="off"]';
const interactive = 'a[href],button,summary,[role=button],input[type=button],input[type=submit],input[type=reset]';
const listen = (target,type,fn,options) => { target.addEventListener(type,fn,options); cleanups.push(()=>target.removeEventListener(type,fn,options)); };
function state(value){canvas.dataset.state=value;canvas.dataset.bursts=String(bursts.length);canvas.dataset.ambientWaves=String(ambientWaves.length);canvas.dataset.running=String(Boolean(frame));canvas.dataset.activeSdf=String(bursts.filter(b=>b.liveSDF&&b.retiredAt===null).length);canvas.dataset.afterglow=String(bursts.filter(b=>b.mode!=='crowded'&&!b.liveSDF&&b.retiredAt===null).length);canvas.dataset.crowdedBursts=String(bursts.filter(b=>b.mode==='crowded').length);canvas.dataset.retiring=String(bursts.filter(b=>b.retiredAt!==null).length);ambientCanvas.dataset.state=value;ambientCanvas.dataset.waves=String(ambientWaves.length);}
function stop(reason='idle',cancelInput=false,preserveBursts=false){
 if(frame)cancelAnimationFrame(frame);frame=0;lastDraw=0;if(!preserveBursts){bursts.length=0;ambientWaves.length=0;}
 if(cancelInput){for(const id of pending)cancelAnimationFrame(id);pending.clear();gesture=null;}
 ctx?.clearRect(0,0,width,height);ambientCtx?.clearRect(0,0,width,height);
 for(const layer of [canvas,ambientCanvas]){layer.style.left='0px';layer.style.top='0px';}state(reason);
}
function resize(){
 const cssWidth=document.documentElement.clientWidth+'px',cssHeight=innerHeight+'px',left=scrollX+'px',top=scrollY+'px';
 for(const layer of [canvas,ambientCanvas]){layer.style.width=cssWidth;layer.style.height=cssHeight;layer.style.left=left;layer.style.top=top;}
 const r=projectionCanvas.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);
 const scale=Math.min(devicePixelRatio||1,1.5,Math.sqrt(4200000/(width*height)));
 canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(height*scale));ctx?.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
 canvas.dataset.pixelBudget=String(canvas.width*canvas.height);
 // Broad opaque color bands need a smaller backing store than thin manual lines.
 const ambientScale=Math.min(devicePixelRatio||1,1,Math.sqrt(AMBIENT_PIXEL_BUDGET/(width*height)));
 ambientCanvas.width=Math.max(1,Math.floor(width*ambientScale));ambientCanvas.height=Math.max(1,Math.floor(height*ambientScale));
 ambientCtx?.setTransform(ambientCanvas.width/width,0,0,ambientCanvas.height/height,0,0);
 ambientCanvas.dataset.pixelBudget=String(ambientCanvas.width*ambientCanvas.height);
}
function availability(){
 stopAuto();
 const unsupported=!ctx&&!ambientCtx,disabled=unsupported||reduced.matches||document.hidden||suspended;
 canvas.hidden=disabled||!ctx;ambientCanvas.hidden=disabled||!ambientCtx;
 stop(unsupported?'unsupported':reduced.matches?'disabled-motion':disabled?'suspended':'idle',true,!unsupported&&!reduced.matches);
 if(!ctx)bursts.length=0;if(!ambientCtx)ambientWaves.length=0;
 if(!disabled){resize();updateLifecycle(performance.now());updateAmbientWaves(performance.now());if(bursts.length||ambientWaves.length){frame=requestAnimationFrame(tick);state('active');}scheduleAuto();}
 syncRepeats();
}
// One material contains exactly three travelling bands, with no center flash,
// cloud sprites or extra shell. Distances are in CSS pixels before touch scaling.
const RIPPLE_RADIUS=825/1.9,RIPPLE_SIZE=RIPPLE_RADIUS*2+42,RIPPLE_BASE_SPEED=1/3/1.5,RIPPLE_SPEED=RIPPLE_BASE_SPEED*1.3;
const RIPPLE_DELAY=.14/RIPPLE_SPEED,RIPPLE_DURATION=1.42/RIPPLE_SPEED,RIPPLE_EASE=1.35;
// Inner lines keep their readable floor. The thin outer line exits by width
// alone, so its geometry must be allowed to reach exactly zero.
const RIPPLE_WIDTHS=[2,1.3,1.7],RIPPLE_MIN_WIDTHS=[0,.9,1.05];
// Expansion keeps its requested 1.3x travel speed. The outer band reaches zero
// width at its shorter lifetime; the unchanged inner lines outlive the SDF.
const RIPPLE_LIFE=(1.42+.14*2)/RIPPLE_BASE_SPEED*1000*.5,OUTER_LIFE_SHARE=.56;
const OUTER_END_RADIUS=8+(RIPPLE_RADIUS-8)*(1-(1-Math.min(1,RIPPLE_LIFE*OUTER_LIFE_SHARE/1000/RIPPLE_DURATION))**RIPPLE_EASE);
// Ambient color planes have their own clock and pool, never an SDF group.
const AUTO_RADIUS=RIPPLE_RADIUS*5,AUTO_EXPAND_MS=RIPPLE_DURATION*1000/1.6,AUTO_LIFE=AUTO_EXPAND_MS;
const AUTO_BANDS=[{width:200,gap:0},{width:5,gap:8}];
const OUTER_FEATHER=18;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function rippleWidthScale(radius){
 const halfRadius=RIPPLE_RADIUS*.1;
 return radius<=halfRadius?1-.5*smooth(8,halfRadius,radius):.5-.25*smooth(halfRadius,RIPPLE_RADIUS,radius);
}
function rippleState(elapsed,index,birthNested=false){
 const delay=(index-(birthNested?1:0))*RIPPLE_DELAY;
 const sinceBirth=elapsed-delay,age=sinceBirth/RIPPLE_DURATION;
 const fadeDuration=RIPPLE_LIFE/1000*(index===0?OUTER_LIFE_SHARE:1)-delay;
 const fadeAge=sinceBirth/fadeDuration;
 if(age<=0||age>=1||fadeAge>=1)return null;
 // Ease-out preserves the fast start and progressively slower expansion.
 const radius=8+(RIPPLE_RADIUS-8)*(1-(1-age)**RIPPLE_EASE);
 const width=index===0?RIPPLE_WIDTHS[0]*(1-smooth(.5,1,radius/OUTER_END_RADIUS)):Math.max(RIPPLE_MIN_WIDTHS[index],RIPPLE_WIDTHS[index]*rippleWidthScale(radius));
 return {age,radius,width,
  opacity:smooth(0,.115,sinceBirth)*(index===0?1:(1-fadeAge)**.62)*[.92,.62,.46][index]};
}
// Birth shape never changes when SDF influence dies. A nested first inner ring
// starts immediately, while all inner afterglow keeps the same 3.825s lifetime.
const visualElapsed=(burst,now)=>Math.max(.045,(now-burst.born)/1000);
const exitWeight=(burst,now)=>burst.retiredAt===null?1:1-smooth(0,EXIT_MS,now-burst.retiredAt);
const visualWeight=(burst,now)=>exitWeight(burst,now);
const RIPPLE_FRAGMENT=`#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;uniform vec2 uSize;uniform float uCount,uScale,uPixel,uStyle;
uniform vec4 uPulse[8];
uniform vec4 uFlowSeed0,uFlowSeed1;
float lightSpot(float angle,float center,float spread){
 float distance=abs(mod(angle-center+3.14159265359,6.28318530718)-3.14159265359);
 return exp(-.5*pow(distance/spread,2.));
}
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
   float r=length(p),angle=atan(p.y,p.x),elapsed=uPulse[pulse].z;
   float exitWeight=mod(uPulse[pulse].w,2.);
   // A bounded integer seed uses exact small divisions even on mediump GPUs.
   float seed=pulse==0?uFlowSeed0.x:pulse==1?uFlowSeed0.y:pulse==2?uFlowSeed0.z:pulse==3?uFlowSeed0.w:pulse==4?uFlowSeed1.x:pulse==5?uFlowSeed1.y:pulse==6?uFlowSeed1.z:uFlowSeed1.w;
   float direction=mod(floor(seed/256.),2.)<.5?-1.:1.;
   float start=mod(seed,32.)*6.28318530718/32.;
   float speed=.35+mod(floor(seed/32.),8.)*.08;
   float spread=.16+mod(floor(seed/512.),2.)*.12;
   float secondSpeed=.28+mod(floor(seed/16.),6.)*.09;
   float secondSpread=.14+mod(floor(seed/128.),3.)*.08;
   float separation=(.20+mod(floor(seed/4.),7.)*.07)*6.28318530718;
   float travel=uStyle>.5&&uStyle<1.5?.65:uStyle>1.5?1.45:1.;
   float spreadScale=uStyle>.5&&uStyle<1.5?1.6:uStyle>1.5?.65:1.;
   float highlight=lightSpot(angle,start+direction*speed*elapsed*travel,spread*spreadScale);
   if(mod(floor(seed/64.),2.)>.5)highlight=max(highlight,lightSpot(angle,start+separation-direction*secondSpeed*elapsed*travel,secondSpread*spreadScale)*.88);
   float coreScale=uStyle>.5&&uStyle<1.5?1.12:uStyle>1.5?.80:1.;
   vec3 localColor=uStyle>.5&&uStyle<1.5?vec3(.94,.985,1.):uStyle>1.5?vec3(1.,.975,.94):vec3(1.);
  for(int i=0;i<3;i++){
   if(i==0&&uPulse[pulse].w>=16.)continue;
   float baseWidth=(i==0?${RIPPLE_WIDTHS[0].toFixed(8)}:i==1?${RIPPLE_WIDTHS[1].toFixed(8)}:${RIPPLE_WIDTHS[2].toFixed(8)})*uScale;
   float index=float(i),delay=(index-(mod(floor(uPulse[pulse].w/8.),2.)>.5?1.:0.))*${RIPPLE_DELAY};
   float sinceBirth=elapsed-delay,age=sinceBirth/${RIPPLE_DURATION};
   float fadeDuration=${RIPPLE_LIFE/1000}*(i==0?${OUTER_LIFE_SHARE}:1.)-delay;
   float fadeAge=sinceBirth/fadeDuration;
   if(age<=0.||age>=1.||fadeAge>=1.)continue;
   float radius=8.+${(RIPPLE_RADIUS-8).toFixed(8)}*(1.-pow(1.-age,${RIPPLE_EASE}));
   float halfRadius=${(RIPPLE_RADIUS*.1).toFixed(8)};
   float widthScale=radius<=halfRadius?1.-.5*smoothstep(8.,halfRadius,radius):.5-.25*smoothstep(halfRadius,${RIPPLE_RADIUS.toFixed(1)},radius);
   float minWidth=(i==0?0.:i==1?.9:1.05)*uScale;
   float width=i==0?baseWidth*(1.-smoothstep(.5,1.,radius/${OUTER_END_RADIUS.toFixed(8)})):max(minWidth,baseWidth*widthScale);
   float strength=i==0?.92:i==1?.62:.46;
   // One or two non-uniform light locations are shared by this pulse's rings.
   float luminance=uStyle>.5&&uStyle<1.5?(i==0?.48:.58)+highlight*.95:uStyle>1.5?(i==0?.54:.58)+highlight*1.10:(i==0?.78:.66)+highlight*.55;
   float localFade=smoothstep(0.,.115,sinceBirth)*(i==0?1.:pow(1.-fadeAge,.62))*strength*luminance*exitWeight;
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
function bandTable(elapsed,index,seed,style,birthNested){
 const ring=rippleState(elapsed,index,birthNested);if(!ring)return null;
 const values=[],tau=Math.PI*2;
 const coreScale=style===1?1.12:style===2?.80:1;
 const color=style===1?[.94,.985,1]:style===2?[1,.975,.94]:[1,1,1];
 const direction=Math.floor(seed/256)%2<.5?-1:1,start=seed%32*tau/32;
 const speed=.35+(Math.floor(seed/32)%8)*.08,spread=.16+(Math.floor(seed/512)%2)*.12;
 const secondSpeed=.28+(Math.floor(seed/16)%6)*.09,secondSpread=.14+(Math.floor(seed/128)%3)*.08;
 const separation=(.20+(Math.floor(seed/4)%7)*.07)*tau,hasSecond=Math.floor(seed/64)%2===1;
 const travel=style===1?.65:style===2?1.45:1,spreadScale=style===1?1.6:style===2?.65:1;
 const center=start+direction*speed*elapsed*travel,secondCenter=start+separation-direction*secondSpeed*elapsed*travel;
 const spot=(angle,position,size)=>{const distance=Math.abs(((angle-position+Math.PI)%tau+tau)%tau-Math.PI);return Math.exp(-.5*(distance/size)**2);};
 for(let n=0;n<=256;n++){
  const angle=n/256*Math.PI*2;
  const radius=ring.radius,width=ring.width;
  let highlight=spot(angle,center,spread*spreadScale);
  if(hasSecond)highlight=Math.max(highlight,spot(angle,secondCenter,secondSpread*spreadScale)*.88);
  const luminance=style===1?(index===0?.48:.58)+highlight*.95:style===2?(index===0?.54:.58)+highlight*1.10:(index===0?.78:.66)+highlight*.55;
  values.push({radius,width,luminance});
 }
 return {values,opacity:ring.opacity,index,coreScale,color};
}
function createRippleRenderer(){
 const surface=document.createElement('canvas');
 const gl=surface.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
 let program=null,buffer=null,uniforms=null,lost=false;
 const cached=new Map();
 const pulses=new Float32Array(32),flowSeeds=new Float32Array(8);
 function initialize(){
  if(!gl)return false;
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);return null;}return shader;};
  const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}'),fragment=compile(gl.FRAGMENT_SHADER,RIPPLE_FRAGMENT);
  if(!vertex||!fragment){if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);return false;}
  program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);program=null;return false;}
  gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  uniforms=Object.fromEntries(['Size','Count','Scale','Pixel','Style','Pulse[0]','FlowSeed0','FlowSeed1'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);return true;
 }
 initialize();
 if(gl){listen(surface,'webglcontextlost',e=>{e.preventDefault();lost=true;});listen(surface,'webglcontextrestored',()=>{lost=!initialize();});}
 function fallback(group,w,h,scale,now,budget){
  const step=Math.floor((now-group[0].born)/50),key=`g${group[0].groupId}:s${group[0].style}:`+group.map(b=>`${b.id}@${b.localX.toFixed(1)},${b.localY.toFixed(1)}:n${+b.birthNested}:a${+b.liveSDF}:f${b.flowSeed}:r${b.retiredAt}`).join('|')+`:${w.toFixed(1)},${h.toFixed(1)}:${step}:${Math.floor(budget)}`;
  if(cached.has(key))return cached.get(key);
  const sprite=document.createElement('canvas'),ratio=Math.min(.7,Math.sqrt(Math.min(12000,budget)/(w*h)));
  sprite.width=Math.max(1,Math.floor(w*ratio));sprite.height=Math.max(1,Math.floor(h*ratio));
  const paint=sprite.getContext('2d');if(!paint)return null;
  const data=paint.createImageData(sprite.width,sprite.height),pixel=Math.max(w/sprite.width,h/sprite.height);
  const sampleTime=group[0].born+(step+.5)*50;
  const tables=group.map(b=>({x:b.localX,y:b.localY,weight:visualWeight(b,sampleTime),bands:[0,1,2].map(i=>i===0&&!b.liveSDF?null:bandTable(visualElapsed(b,sampleTime),i,b.flowSeed,b.style,b.birthNested))}));
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
  if(this.mode==='cached'){const sprite=fallback(group,w,h,scale,now,budget);canvas.dataset.lastTilePixels=String(sprite? sprite.width*sprite.height:0);return sprite;}
  const ratio=Math.min(1,Math.sqrt(Math.min(140000,budget,480000/group.length)/(w*h))),pw=Math.max(1,Math.floor(w*ratio)),ph=Math.max(1,Math.floor(h*ratio));
  if(surface.width!==pw)surface.width=pw;if(surface.height!==ph)surface.height=ph;
  // Separate bits preserve the immutable nested launch and the live outer state.
  group.forEach((b,i)=>{pulses.set([b.localX,b.localY,visualElapsed(b,now),b.variant*2+visualWeight(b,now)+(b.birthNested?8:0)+(b.liveSDF?0:16)],i*4);flowSeeds[i]=b.flowSeed;});
  gl.viewport(0,0,pw,ph);gl.useProgram(program);gl.uniform2f(uniforms.Size,w,h);gl.uniform1f(uniforms.Count,group.length);gl.uniform1f(uniforms.Scale,scale);gl.uniform1f(uniforms.Pixel,Math.max(w/pw,h/ph));
  gl.uniform1f(uniforms.Style,group[0].style);
  gl.uniform4f(uniforms.FlowSeed0,flowSeeds[0],flowSeeds[1],flowSeeds[2],flowSeeds[3]);
  gl.uniform4f(uniforms.FlowSeed1,flowSeeds[4],flowSeeds[5],flowSeeds[6],flowSeeds[7]);
  gl.uniform4fv(uniforms['Pulse[0]'],pulses);gl.drawArrays(gl.TRIANGLES,0,6);
  canvas.dataset.lastTilePixels=String(pw*ph);canvas.dataset.maxTilePixels=String(Math.max(Number(canvas.dataset.maxTilePixels)||0,pw*ph));return surface;
 },destroy(){cached.clear();if(gl){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}program=null;}};
}
const ripples=createRippleRenderer();let nextBurstId=0;
canvas.dataset.renderer=ripples.mode;canvas.dataset.material='three-flowing-ripples';canvas.dataset.rippleCount='3';
canvas.dataset.rippleDelays=[0,1,2].map(index=>index*RIPPLE_DELAY*1000).join(',');canvas.dataset.rippleWidths=RIPPLE_WIDTHS.join(',');canvas.dataset.composition='feathered-outer-circle-subtraction';canvas.dataset.anchor='document';canvas.dataset.overlapFeather=String(OUTER_FEATHER);
canvas.dataset.rippleSpeed=String(RIPPLE_SPEED);canvas.dataset.rippleDuration=String(RIPPLE_DURATION);canvas.dataset.widthHalfRadius=String(RIPPLE_RADIUS*.1);canvas.dataset.widthOrder='thin-lines';
canvas.dataset.crossing='outer-rings-only';canvas.dataset.motion='circular-flow-only';canvas.dataset.scrollProjection='native-document-layer';canvas.dataset.maxRadius=String(RIPPLE_RADIUS);canvas.dataset.clipMode='viewport-css-pixels';canvas.dataset.color='white';canvas.dataset.geometry='native-circular-clip';
canvas.dataset.groupSize=String(CLICKS_PER_GROUP);canvas.dataset.styleCount=String(STYLE_COUNT);canvas.dataset.groupInteraction='same-group-id-only';
canvas.dataset.maxMainGroups=String(MAX_MAIN_GROUPS);canvas.dataset.maxActive=String(MAX_BURSTS);canvas.dataset.maxVisuals=String(MAX_VISUAL_BURSTS);
canvas.dataset.outerEndRadius=String(OUTER_END_RADIUS);canvas.dataset.outerWidthHalfRadius=String(OUTER_END_RADIUS*.5);canvas.dataset.outerExit='width-to-zero';
canvas.dataset.flowHighlights='1-2';canvas.dataset.flowRandomness='fixed-per-birth';
function updateLifecycle(now,reservedLoad=0){
 for(let i=bursts.length-1;i>=0;i--){
  const burst=bursts[i];
  if(burst.retiredAt!==null&&burst.firstDrawAt===null&&now-burst.born<burst.life)burst.retiredAt=Math.max(burst.retiredAt,now+MIN_VISIBLE_MS);
  if(now-burst.born>=burst.life||(burst.retiredAt!==null&&now-burst.retiredAt>=EXIT_MS)){bursts.splice(i,1);continue;}
  if(burst.liveSDF&&now-burst.born>115){
   const outer=rippleState(visualElapsed(burst,now),0);
   if(!outer||outer.width<=0)burst.liveSDF=false;
  }
 }
 // Observe decay before a new action adds reservations, so a cleared scene can
 // leave crowded mode even if that new action immediately reserves more rings.
 resolveClickMode(reservedLoad);
}
function retireBurst(burst,now){
 if(burst.retiredAt!==null)return;
 // Protect the first visible frame, including a busy frame after the birth.
 burst.retiredAt=Math.max(now,(burst.firstDrawAt??now)+MIN_VISIBLE_MS);
}
function limitMainGroups(now,incomingGroup){
 const ids=new Set(bursts.filter(b=>b.liveSDF&&b.retiredAt===null).map(b=>b.groupId));
 if(incomingGroup!==undefined)ids.add(incomingGroup);
 const ordered=[...ids].sort((a,b)=>a-b);
 while(ordered.length>MAX_MAIN_GROUPS){
  const oldGroup=ordered.shift();
  for(const burst of bursts)if(burst.mode!=='crowded'&&burst.groupId===oldGroup)retireBurst(burst,now);
 }
}
function reserveVisualSlot(now){
 while(bursts.length>=MAX_VISUAL_BURSTS){
  // Live SDF does not compete with invisible outer shells' inner afterglow.
  // At pathological event rates, prefer already-seen tails before any fresh birth.
  const ranked=bursts.map((burst,index)=>({burst,index,seen:burst.firstDrawAt!==null,protected:burst.firstDrawAt===null||now-burst.firstDrawAt<MIN_VISIBLE_MS}));
  ranked.sort((a,b)=>Number(a.protected)-Number(b.protected)||Number(!a.seen)-Number(!b.seen)||Number(a.burst.liveSDF&&a.burst.retiredAt===null)-Number(b.burst.liveSDF&&b.burst.retiredAt===null)||a.burst.born-b.burst.born||a.burst.id-b.burst.id);
  bursts.splice(ranked[0].index,1);
  canvas.dataset.pressureReclaims=String((Number(canvas.dataset.pressureReclaims)||0)+1);
 }
}
// Boolean subtraction of whole disks with a soft alpha edge. Circle distance
// controls opacity only; neither radius nor the inner bands are distorted.
// Inner bands are drawn separately and do not participate in this operation.
function outerCircleField(now,viewLeft,viewTop){
 const circles=[];
 for(const burst of bursts){
  if(burst.mode==='crowded'||!burst.liveSDF)continue;
  const scale=burst.touch?.68:1;
  const band=rippleState(visualElapsed(burst,now),0);if(!band)continue;
  const opacity=band.opacity*visualWeight(burst,now),widthWeight=band.width/RIPPLE_WIDTHS[0];if(opacity<=.008||widthWeight<=0)continue;
  circles.push({id:burst.id,groupId:burst.groupId,x:burst.pageX-viewLeft,y:burst.pageY-viewTop,radius:band.radius*scale,opacity,widthWeight,scale});
 }
 canvas.dataset.cutoutResolution='independent-contour-alpha';
 return circles;
}
function featherOuterContour(material,x,y,w,h,cx,cy,r,half,occluders,budget){
 if(!outerContext||!occluders.length)return null;
 const left=Math.max(0,cx-r-half-2),top=Math.max(0,cy-r-half-2);
 const right=Math.min(width,cx+r+half+2),bottom=Math.min(height,cy+r+half+2);
 const tw=right-left,th=bottom-top;if(tw<=0||th<=0)return null;
 const ratio=Math.min(1,Math.sqrt(Math.min(600000,budget)/(tw*th)));
 const pw=Math.max(1,Math.floor(tw*ratio)),ph=Math.max(1,Math.floor(th*ratio));
 if(outerSurface.width!==pw)outerSurface.width=pw;if(outerSurface.height!==ph)outerSurface.height=ph;
 outerContext.setTransform(pw/tw,0,0,ph/th,0,0);
 outerContext.globalCompositeOperation='source-over';outerContext.globalAlpha=1;outerContext.clearRect(0,0,tw,th);
 outerContext.drawImage(material,x-left,y-top,w,h);
 outerContext.globalCompositeOperation='destination-out';
 for(const other of occluders){
  const ox=other.x-left,oy=other.y-top,feather=OUTER_FEATHER;
  const mask=outerContext.createRadialGradient(ox,oy,other.radius,ox,oy,other.radius+feather);
  const strength=smooth(.008,.18,other.opacity)*other.widthWeight*smooth(0,OUTER_FEATHER,other.partialDepth);
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
function drawBursts(now,viewLeft,viewTop){
 // Between material frames this absolute layer moves with native page scroll.
 // No scroll handler rebuilds the SDF or waits for the next 30fps material frame.
 canvas.dataset.godray='background-only';
 const clusters=[];
 for(const burst of bursts){
  if(burst.mode==='crowded')continue;
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
 let visibleGroups=0,framePixels=0;
 const circles=outerCircleField(now,viewLeft,viewTop);
 const outerCount=bursts.filter(b=>b.liveSDF&&rippleState(visualElapsed(b,now),0)).length;
 const featherBudget=FEATHER_PIXEL_BUDGET/Math.max(1,outerCount);
 for(const group of groups){
  const scale=group[0].touch?.68:1,pad=RIPPLE_SIZE*scale*.5;
  // Crop the sample domain, never stretch the geometry. Rings may leave the
  // screen without allocating their full RIPPLE_SIZE-square bounding box.
  const left=Math.max(Math.min(...group.map(b=>b.pageX))-pad,viewLeft),top=Math.max(Math.min(...group.map(b=>b.pageY))-pad,viewTop);
  const right=Math.min(Math.max(...group.map(b=>b.pageX))+pad,viewLeft+width),bottom=Math.min(Math.max(...group.map(b=>b.pageY))+pad,viewTop+height);
  const w=right-left,h=bottom-top,x=left-viewLeft,y=top-viewTop;
  if(w<=0||h<=0)continue;
  group.forEach(b=>{b.localX=b.pageX-left;b.localY=b.pageY-top;});
  const material=ripples.draw(group,w,h,scale,now,MATERIAL_PIXEL_BUDGET/groups.length);if(!material)continue;
  // Draw each contour independently so an outer cut cannot erase an inner ring
  // or another click's unrelated contour underneath it.
  for(const burst of group)for(let ring=0;ring<3;ring++){
   if(ring===0&&!burst.liveSDF)continue;
   const band=rippleState(visualElapsed(burst,now),ring,burst.birthNested);if(!band)continue;
   const cx=x+burst.localX,cy=y+burst.localY,r=band.radius*scale;
   const thickness=ring===0?band.width*scale:Math.max(band.width*scale,.95*width/canvas.width);
   if(thickness<=0)continue;
   const half=thickness*.5,insideRadius=Math.max(0,r-half);
   ctx.save();ctx.beginPath();
   ctx.moveTo(cx+r+half,cy);ctx.arc(cx,cy,r+half,0,Math.PI*2);
   if(insideRadius>0){ctx.moveTo(cx+insideRadius,cy);ctx.arc(cx,cy,insideRadius,0,Math.PI*2,true);}
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
   const feathered=featherOuterContour(material,x,y,w,h,cx,cy,r,half,occluders,featherBudget);
   ctx.globalCompositeOperation='source-over';ctx.globalAlpha=burst.touch?.82:1;
   if(feathered)ctx.drawImage(feathered.surface,feathered.x,feathered.y,feathered.w,feathered.h);
   else ctx.drawImage(material,x,y,w,h);
   ctx.restore();
   if(burst.firstDrawAt===null){burst.firstDrawAt=now;if(burst.retiredAt!==null)burst.retiredAt=Math.max(burst.retiredAt,now+MIN_VISIBLE_MS);}
  }
  visibleGroups++;framePixels+=Number(canvas.dataset.lastTilePixels)||0;
 }
 canvas.dataset.renderer=ripples.mode;canvas.dataset.groups=String(visibleGroups);canvas.dataset.mainGroups=String(new Set(bursts.filter(b=>b.liveSDF&&b.retiredAt===null).map(b=>b.groupId)).size);canvas.dataset.frameTexturePixels=String(framePixels);canvas.dataset.featherPixelBudget=String(FEATHER_PIXEL_BUDGET);
}
function drawCrowdedBursts(now,viewLeft,viewTop){
 // Native paths only: one complete cyan line and at most two short flow arcs.
 // These births never enter the material batches, circle field or feather pass.
 const tau=Math.PI*2;
 ctx.save();ctx.globalCompositeOperation='source-over';ctx.lineCap='round';
 for(const burst of bursts){
  if(burst.mode!=='crowded')continue;
  const elapsed=visualElapsed(burst,now),band=rippleState(elapsed,1,true);if(!band)continue;
  const scale=burst.touch?.68:1,radius=band.radius*scale,cx=burst.pageX-viewLeft,cy=burst.pageY-viewTop;
  const near=Math.hypot(Math.max(0,-cx,cx-width),Math.max(0,-cy,cy-height));
  const far=Math.hypot(Math.max(Math.abs(cx),Math.abs(width-cx)),Math.max(Math.abs(cy),Math.abs(height-cy)));
  if(radius<near-2||radius>far+2)continue;
  // Match the immediate inner ring's expansion and 3.825s fade, without its
  // nested geometry. Alpha stays translucent even at a flow highlight's peak.
  ctx.globalAlpha=band.opacity/.62*visualWeight(burst,now);
  ctx.lineWidth=Math.max(1,CROWDED_WIDTH*scale);ctx.strokeStyle='rgba(65,218,235,.44)';
  ctx.beginPath();ctx.arc(cx,cy,radius,0,tau);ctx.stroke();
  const seed=burst.flowSeed,direction=Math.floor(seed/256)%2===0?-1:1,start=(seed%32)*tau/32;
  const speed=.35+(Math.floor(seed/32)%8)*.08,spread=.16+(Math.floor(seed/512)%2)*.12;
  const secondSpeed=.28+(Math.floor(seed/16)%6)*.09,secondSpread=.14+(Math.floor(seed/128)%3)*.08;
  const separation=(.20+(Math.floor(seed/4)%7)*.07)*tau,count=Math.floor(seed/64)%2===1?2:1;
  for(let index=0;index<count;index++){
   const center=index?start+separation-direction*secondSpeed*elapsed:start+direction*speed*elapsed;
   const half=(index?secondSpread:spread)*2.5,a=center-half,b=center+half;
   const gradient=ctx.createLinearGradient(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,cx+Math.cos(b)*radius,cy+Math.sin(b)*radius);
   gradient.addColorStop(0,'rgba(205,254,255,0)');gradient.addColorStop(.5,'rgba(205,254,255,.10)');gradient.addColorStop(1,'rgba(205,254,255,0)');
   ctx.strokeStyle=gradient;ctx.beginPath();ctx.arc(cx,cy,radius,a,b);ctx.stroke();
  }
  if(burst.firstDrawAt===null){burst.firstDrawAt=now;if(burst.retiredAt!==null)burst.retiredAt=Math.max(burst.retiredAt,now+MIN_VISIBLE_MS);}
 }
 ctx.restore();
}
function updateAmbientWaves(now){
 for(let i=ambientWaves.length-1;i>=0;i--)if(now-ambientWaves[i].born>=AUTO_LIFE)ambientWaves.splice(i,1);
}
function drawAmbientWaves(now,viewLeft,viewTop){
 // Filled annular areas, not stroked outlines, sparkles, trails or SDF masks.
 // Native paths clip at the viewport; a fivefold radius needs no large texture.
 const paint=ambientCtx;if(!paint)return;
 paint.save();paint.globalCompositeOperation='source-over';paint.globalAlpha=1;paint.fillStyle='#ffffff';
 for(const wave of ambientWaves){
  const elapsed=Math.max(0,now-wave.born),progress=Math.min(1,elapsed/AUTO_EXPAND_MS);
  const radialProgress=1-(1-progress)**1.55;
  const radius=AUTO_RADIUS*(wave.touch?.68:1)*radialProgress;
  // Disappearance changes geometry only: the fill never becomes translucent.
  const widthScale=1-smooth(.5,1,radialProgress);
  const cx=wave.pageX-viewLeft,cy=wave.pageY-viewTop;
  const near=Math.hypot(Math.max(0,-cx,cx-width),Math.max(0,-cy,cy-height));
  const far=Math.hypot(Math.max(Math.abs(cx),Math.abs(width-cx)),Math.max(Math.abs(cy),Math.abs(height-cy)));
  let outside=radius;
  for(let index=0;index<AUTO_BANDS.length;index++){
   const band=AUTO_BANDS[index];
   outside-=band.gap;if(outside<=0)continue;
   const inside=Math.max(0,outside-band.width*widthScale);
   if(outside-inside<=0||outside<near-1||inside>far+1){outside=inside;continue;}
   paint.beginPath();paint.arc(cx,cy,outside,0,Math.PI*2);
   if(inside>0){paint.moveTo(cx+inside,cy);paint.arc(cx,cy,inside,0,Math.PI*2,true);}
   paint.fill();outside=inside;
  }
 }
 paint.restore();
}
function emitAmbientWave(x,y){
 if(!autoAllowed())return;
 updateAmbientWaves(performance.now());
 if(ambientWaves.length>=2)ambientWaves.shift();
 ambientWaves.push({pageX:x+scrollX,pageY:y+scrollY,born:performance.now(),touch:coarse.matches});
 canvas.dataset.autoMaterial='two-opaque-color-bands';canvas.dataset.autoWidths='200,5';canvas.dataset.autoGap='8';canvas.dataset.autoMaxRadius=String(AUTO_RADIUS);canvas.dataset.autoSdf='excluded';canvas.dataset.autoExit='width-to-zero';
 if(!frame)frame=requestAnimationFrame(tick);state('active');saveContinuity();
}
function tick(now){
 frame=0;if(destroyed||suspended||document.hidden||reduced.matches){stop(reduced.matches?'disabled-motion':'suspended',true,!reduced.matches);return;}
 let painted=false;
 if(now-lastDraw>=1000/30){
  lastDraw=now;ctx?.clearRect(0,0,width,height);ambientCtx?.clearRect(0,0,width,height);
  updateLifecycle(now);
  updateAmbientWaves(now);
  for(const layer of [canvas,ambientCanvas]){layer.style.left=scrollX+'px';layer.style.top=scrollY+'px';}
  // Both layers share their CSS projection, with one layout read per frame.
  const rect=projectionCanvas.getBoundingClientRect(),viewLeft=scrollX+rect.left,viewTop=scrollY+rect.top;
  if(ambientWaves.length)drawAmbientWaves(now,viewLeft,viewTop);
  if(ctx&&bursts.length){drawBursts(now,viewLeft,viewTop);drawCrowdedBursts(now,viewLeft,viewTop);}
  else if(canvas.dataset.groups!=='0'){canvas.dataset.groups='0';canvas.dataset.mainGroups='0';canvas.dataset.frameTexturePixels='0';}
  painted=true;
 }
 if(bursts.length||ambientWaves.length){frame=requestAnimationFrame(tick);if(painted)state('active');}else stop();
}
function emit(x,y,keyboard,touch,bornAt=performance.now(),fromReservation=false){
 if(!manualAllowed())return;
 const rect=canvas.getBoundingClientRect();if(Math.abs(rect.width-width)>.01||Math.abs(rect.height-height)>.01)resize();
 const born=bornAt;
 const reservedLoad=fromReservation?1:0;
 updateLifecycle(born,reservedLoad);
 const pageX=x+scrollX,pageY=y+scrollY;
 const mode=resolveClickMode(reservedLoad),groupId=mode==='crowded'?-1:Math.floor(clickSequence/CLICKS_PER_GROUP),style=mode==='crowded'?0:groupId%STYLE_COUNT;
 // Crowded accents do not consume a normal group's ordinal or start a group.
 if(mode!=='crowded')clickSequence++;
 // Capture containment at birth. A nested click stays a two-ring accent for
 // its entire life, even if its containing circle later fades or moves away.
 const birthNested=mode!=='crowded'&&bursts.some(other=>{
  if(!other.liveSDF||other.groupId!==groupId)return false;
  const band=rippleState(visualElapsed(other,born),0);if(!band)return false;
  return band.opacity*visualWeight(other,born)*(band.width/RIPPLE_WIDTHS[0])>.008&&Math.hypot(pageX-other.pageX,pageY-other.pageY)<band.radius*(other.touch?.68:1);
 });
 if(mode!=='crowded')limitMainGroups(born,groupId);
 reserveVisualSlot(born);
 const variant=Math.floor(Math.random()*4);
 const flowSeed=Math.floor(Math.random()*1024);
 bursts.push({id:++nextBurstId,mode,groupId,style,pageX,pageY,born,life:RIPPLE_LIFE,touch,birthNested,liveSDF:mode!=='crowded'&&!birthNested,flowSeed,variant,retiredAt:null,firstDrawAt:null});
 canvas.dataset.clickSequence=String(clickSequence);if(mode!=='crowded'){canvas.dataset.currentGroup=String(groupId);canvas.dataset.currentStyle=String(style);}
 canvas.dataset.lastOuterEnabled=String(mode!=='crowded'&&!birthNested);canvas.dataset.overlapRule='partial-intersections-only';
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode=mode==='crowded'?'single-cyan-flow':'three-flowing-ripples';canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(MAX_BURSTS);canvas.dataset.maxActive=String(MAX_BURSTS);canvas.dataset.tailSlots=String(MAX_TAIL_BURSTS);
 if(!frame)frame=requestAnimationFrame(tick);state('active');
 saveContinuity();
}
function manualAllowed(){return !!ctx&&!destroyed&&!suspended&&!document.hidden&&!reduced.matches&&!window.PortfolioStartGate?.active;}
function pendingRepeatCount(){return repeatQueue.reduce((count,action)=>count+action.remaining,0);}
function resolveClickMode(reservedLoad=0){
 // A due reservation is transferred into a visual, not briefly removed from
 // load. Carry that one in-flight slot until emit pushes its replacement.
 // Ambient waves and navigation accents are excluded.
 const load=bursts.length+pendingRepeatCount()+reservedLoad;
 if(crowdedMode?load<CROWDED_EXIT:load>=CROWDED_ENTER)crowdedMode=!crowdedMode;
 if(canvas.dataset.crowdedMode!==String(crowdedMode))canvas.dataset.crowdedMode=String(crowdedMode);
 if(canvas.dataset.crowdedLoad!==String(load))canvas.dataset.crowdedLoad=String(load);
 return crowdedMode?'crowded':'normal';
}
function stopRepeatTimer(){if(repeatTimer)clearTimeout(repeatTimer);repeatTimer=0;}
function pruneMissedRepeats(now){
 // A hidden page or a navigation gap never catches up with a burst of old jobs.
 for(let i=repeatQueue.length-1;i>=0;i--){
  const action=repeatQueue[i];
  const missed=Math.min(action.remaining,Math.max(0,Math.ceil((now-action.nextDue)/REPEAT_DELAY_MS)));
  action.remaining-=missed;action.nextDue+=missed*REPEAT_DELAY_MS;
  if(!action.remaining)repeatQueue.splice(i,1);
 }
 resolveClickMode();
}
function scheduleRepeats(){
 stopRepeatTimer();canvas.dataset.pendingRepeats=String(pendingRepeatCount());
 if(!manualAllowed()||!repeatQueue.length)return;
 const nextDue=Math.min(...repeatQueue.map(action=>action.nextDue));
 repeatTimer=setTimeout(runRepeat,Math.max(0,nextDue-performance.now()));
}
function syncRepeats(){
 stopRepeatTimer();
 if(!manualAllowed()){
  repeatsPaused=true;
  if(!ctx||reduced.matches){repeatQueue.length=0;resolveClickMode();}
  canvas.dataset.pendingRepeats=String(pendingRepeatCount());return;
 }
 if(repeatsPaused){pruneMissedRepeats(performance.now());repeatsPaused=false;saveContinuity();}
 scheduleRepeats();
}
function runRepeat(){
 repeatTimer=0;
 if(!manualAllowed()){syncRepeats();return;}
 const now=performance.now();
 let index=-1;
 for(let i=0;i<repeatQueue.length;i++)if(index<0||repeatQueue[i].nextDue<repeatQueue[index].nextDue)index=i;
 if(index<0)return;
 const action=repeatQueue[index];
 if(action.nextDue>now){scheduleRepeats();return;}
 // Mutate the reservation before emit snapshots it. Every birth gets a fresh
 // time; only a normal birth advances the fifteen-pulse group sequence.
 action.remaining--;
 if(!action.remaining)repeatQueue.splice(index,1);
 else action.nextDue=now+REPEAT_DELAY_MS;
 emit(action.pageX-scrollX,action.pageY-scrollY,action.keyboard,action.touch,now,true);
 scheduleRepeats();
}
function beginClickSequence(pageX,pageY,keyboard,touch,bornAt){
 if(!manualAllowed())return;
 updateLifecycle(bornAt);
 // Count manual visuals, including their tails, plus reserved emissions once.
 // 0–8 => 6; 9–17 => 5; 18–26 => 4; 27–35 => 3; 36+ => 2.
 const existing=bursts.length+pendingRepeatCount();
 const repetitions=Math.max(2,6-Math.floor(existing/9)),reserved=repetitions-1;
 let queued=pendingRepeatCount();
 while(queued+reserved>MAX_PENDING_REPEATS){
  // Bound pathological input: trim the furthest future OLD reservation first.
  // A new action always retains its immediate pulse and its new reservations.
  let furthest=0;
  for(let i=1;i<repeatQueue.length;i++)if(repeatQueue[i].nextDue+(repeatQueue[i].remaining-1)*REPEAT_DELAY_MS>repeatQueue[furthest].nextDue+(repeatQueue[furthest].remaining-1)*REPEAT_DELAY_MS)furthest=i;
  if(--repeatQueue[furthest].remaining===0)repeatQueue.splice(furthest,1);
  queued--;canvas.dataset.repeatReclaims=String((Number(canvas.dataset.repeatReclaims)||0)+1);
 }
 // Make room gradually ahead of the visual cap, using the existing 280ms exit.
 // Fresh/unpainted births retain their minimum visible time and hard-cap policy.
 let excess=Math.max(0,bursts.filter(b=>b.retiredAt===null).length+queued+repetitions-MAX_VISUAL_BURSTS);
 for(const burst of bursts){
  if(!excess)break;
  if(burst.retiredAt===null&&burst.firstDrawAt!==null&&bornAt-burst.firstDrawAt>=MIN_VISIBLE_MS){retireBurst(burst,bornAt);excess--;}
 }
 repeatQueue.push({pageX,pageY,keyboard,touch,remaining:reserved,nextDue:bornAt+REPEAT_DELAY_MS});
 canvas.dataset.repeatExisting=String(existing);canvas.dataset.repeatCount=String(repetitions);canvas.dataset.repeatDelay=String(REPEAT_DELAY_MS);
 // Reserve before the synchronous first birth: a link may navigate immediately.
 emit(pageX-scrollX,pageY-scrollY,keyboard,touch,bornAt);
 scheduleRepeats();
}
function saveContinuity(){
 const now=performance.now();
 try{sessionStorage.setItem(CONTINUITY_KEY,JSON.stringify({version:9,sequence:clickSequence,crowdedMode,savedAt:Date.now(),repeats:repeatQueue.map(action=>({x:action.pageX-scrollX,y:action.pageY-scrollY,remaining:action.remaining,wait:action.nextDue-now,keyboard:action.keyboard,touch:action.touch})),waves:ambientWaves.map(w=>({x:w.pageX-scrollX,y:w.pageY-scrollY,age:now-w.born,touch:w.touch})),pulses:bursts.map(b=>({mode:b.mode||'normal',groupId:b.groupId,style:b.style,x:b.pageX-scrollX,y:b.pageY-scrollY,age:now-b.born,touch:b.touch,birthNested:b.birthNested,liveSDF:b.liveSDF,variant:b.variant,flowSeed:b.flowSeed,retiredAge:b.retiredAt===null?null:now-b.retiredAt,drawnAge:b.firstDrawAt===null?null:now-b.firstDrawAt}))}));}catch{}
}
function restoreContinuity(){
 if(destroyed||suspended)return;
 let saved;try{const value=sessionStorage.getItem(CONTINUITY_KEY);if(!value)return;saved=JSON.parse(value);}catch{return;}
 if(!saved||typeof saved!=='object')return;
 crowdedMode=saved.version>=9&&saved.crowdedMode===true;
 canvas.dataset.crowdedMode=String(crowdedMode);
 // Older automatic rings must not re-enter the manual SDF pool on navigation.
 const pulses=Array.isArray(saved.pulses)?saved.pulses.filter(p=>p?.automatic!==true):[];
 const maxGroupId=Math.floor((Number.MAX_SAFE_INTEGER-CLICKS_PER_GROUP)/CLICKS_PER_GROUP);
 const validGroup=id=>Number.isSafeInteger(id)&&id>=0&&id<=maxGroupId;
 let latestGroup=-1;
 for(const pulse of pulses)if(pulse&&pulse.mode!=='crowded'&&validGroup(pulse.groupId))latestGroup=Math.max(latestGroup,pulse.groupId);
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
 // Consume carried visuals and reservations. Keep the tab's ordinal even if the gap
 // is long, every circle has expired, or motion is currently disabled.
 try{sessionStorage.setItem(CONTINUITY_KEY,JSON.stringify({version:9,sequence:clickSequence,crowdedMode,savedAt:Date.now(),pulses:[],waves:[],repeats:[]}));}catch{}
 if(reduced.matches||!ctx&&!ambientCtx)return;
 const gap=Date.now()-saved?.savedAt;
 if(!Number.isFinite(gap)||gap<0||gap>Math.max(RIPPLE_LIFE,AUTO_LIFE))return;
 const now=performance.now();
 // Use the same viewport anchor as carried rings, then keep document coordinates
 // fixed on this page. Only still-future slots survive the navigation interval.
 if(ctx)for(const action of (Array.isArray(saved.repeats)?saved.repeats:[]).slice(-MAX_PENDING_REPEATS)){
  if(!action||!Number.isFinite(action.x)||!Number.isFinite(action.y)||!Number.isFinite(action.wait)||action.wait>REPEAT_DELAY_MS*5||action.wait<-RIPPLE_LIFE||!Number.isInteger(action.remaining)||action.remaining<1||action.remaining>5)continue;
  const missed=Math.min(action.remaining,Math.max(0,Math.ceil((gap-action.wait)/REPEAT_DELAY_MS)));
  const remaining=Math.min(action.remaining-missed,MAX_PENDING_REPEATS-pendingRepeatCount());if(!remaining)continue;
  repeatQueue.push({pageX:action.x+scrollX,pageY:action.y+scrollY,remaining,nextDue:now+action.wait+missed*REPEAT_DELAY_MS-gap,keyboard:!!action.keyboard,touch:!!action.touch});
 }
 if(document.hidden){resolveClickMode();syncRepeats();return;}
 if(ctx)for(const p of pulses.slice(-MAX_VISUAL_BURSTS)){
  if(bursts.length>=MAX_VISUAL_BURSTS)break;
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.age))continue;
  const mode=saved.version>=9&&p.mode==='crowded'?'crowded':'normal';
  const birthNested=mode!=='crowded'&&(saved.version>=3?!!p.birthNested:p.outerEnabled===false),age=Math.max(0,p.age)+gap;
  const life=RIPPLE_LIFE;
  const retiredAge=p.retiredAge==null?null:Number(p.retiredAge)+gap;
  if(age>=life||retiredAge!==null&&(!Number.isFinite(retiredAge)||retiredAge>=EXIT_MS))continue;
  const variant=Math.max(0,Math.min(3,Math.floor(Number(p.variant)||0)));
  const groupId=mode!=='crowded'&&validGroup(p.groupId)?p.groupId:-1,style=groupId<0?0:groupId%STYLE_COUNT;
  const flowSeed=Number.isInteger(p.flowSeed)&&p.flowSeed>=0&&p.flowSeed<1024?p.flowSeed:((variant*239+(Math.max(0,groupId)%1024)*73)%1024);
  const outer=mode==='crowded'||birthNested?null:rippleState(Math.max(.045,age/1000),0);
  const liveSDF=!!outer&&outer.width>0&&(saved.version<6||p.liveSDF!==false);
  const drawnAge=p.drawnAge==null?null:Number(p.drawnAge)+gap;
  bursts.push({id:++nextBurstId,mode,groupId,style,pageX:p.x+scrollX,pageY:p.y+scrollY,born:now-age,life,touch:!!p.touch,birthNested,liveSDF,variant,flowSeed,retiredAt:retiredAge===null?null:now-retiredAge,firstDrawAt:drawnAge!==null&&Number.isFinite(drawnAge)?now-drawnAge:null});
 }
 if(ambientCtx)for(const wave of (Array.isArray(saved.waves)?saved.waves:[]).slice(-2)){
  if(!wave||!Number.isFinite(wave.x)||!Number.isFinite(wave.y)||!Number.isFinite(wave.age))continue;
  const age=Math.max(0,wave.age)+gap;if(age>=AUTO_LIFE)continue;
  // Ignore legacy palette fields: both bands now always render opaque white.
  ambientWaves.push({pageX:wave.x+scrollX,pageY:wave.y+scrollY,born:now-age,touch:!!wave.touch});
 }
 updateLifecycle(now);limitMainGroups(now);updateAmbientWaves(now);
 syncRepeats();
 if((bursts.length||ambientWaves.length)&&!frame){frame=requestAnimationFrame(tick);state('active');}
}
function stopAuto(){if(autoTimer)clearTimeout(autoTimer);autoTimer=0;canvas.dataset.autoPending='false';}
function autoAllowed(){return !!ambientCtx&&!destroyed&&!suspended&&!document.hidden&&!reduced.matches&&!window.PortfolioStartGate?.active;}
function findAutoPoint(){
 if([...document.querySelectorAll('dialog[open],[aria-modal="true"]')].some(dialog=>dialog.getClientRects().length))return null;
 const avoid='header,.header,nav,a,button,summary,[role="button"],[role="slider"],video,iframe,.project-preview,.detail-player,.poster-button,dialog,[role="dialog"],form,input,select,textarea,label,[contenteditable="true"],[data-click-effects="off"]';
 const content='img,picture,svg,canvas,h1,h2,h3,h4,h5,h6,p,li,figcaption,pre,code,blockquote';
 const viewWidth=document.documentElement.clientWidth,viewHeight=innerHeight;
 const insetX=Math.min(48,viewWidth*.12),insetY=Math.min(48,viewHeight*.12);
 for(let attempt=0;attempt<24;attempt++){
  const x=insetX+Math.random()*Math.max(1,viewWidth-insetX*2),y=insetY+Math.random()*Math.max(1,viewHeight-insetY*2);
  const target=document.elementFromPoint(x,y);
  if(!(target instanceof Element)||target.closest(avoid)||target.closest(content))continue;
  if([...target.childNodes].some(node=>node.nodeType===3&&node.textContent.trim()))continue;
  return {x,y};
 }
 return null;
}
function scheduleAuto(){
 stopAuto();if(!autoAllowed())return;
 const delay=AUTO_MIN_MS+Math.random()*(AUTO_MAX_MS-AUTO_MIN_MS);
 canvas.dataset.autoPending='true';canvas.dataset.autoDelay=String(Math.round(delay));
 autoTimer=setTimeout(()=>{
  autoTimer=0;canvas.dataset.autoPending='false';
  if(!autoAllowed())return;
  if(!gesture?.down){
   const point=findAutoPoint();
   if(point)emitAmbientWave(point.x,point.y);
  }
  // Busy content or an open dialog skips this occurrence instead of targeting UI.
  scheduleAuto();
 },delay);
}
listen(document,'pointerdown',e=>{
 if(!e.isPrimary||e.button!==0){gesture=null;return;}
 scheduleAuto();
 gesture={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),touch:e.pointerType==='touch',down:true,dragged:false,ignored:!!e.target.closest?.(ignored)};
},{passive:true});
listen(document,'pointermove',e=>{if(gesture&&gesture.id===e.pointerId&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>8)gesture.dragged=true;},{passive:true});
listen(document,'pointerup',e=>{if(gesture?.id===e.pointerId)gesture.down=false;},{passive:true});
listen(document,'pointercancel',()=>{if(gesture){gesture.dragged=true;gesture.down=false;}},{passive:true});
listen(document,'keydown',e=>{if(!e.repeat&&(e.key==='Enter'||e.key===' '))scheduleAuto();},{passive:true});
listen(window,'scroll',()=>{if(gesture)gesture.dragged=true;},{passive:true,capture:true});
listen(document,'click',e=>{
 if(e.button===0)scheduleAuto();
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
 // One native click starts one sequence, including keyboard activation.
 beginClickSequence(pageX,pageY,keyboard,touch,bornAt);gesture=null;
},true);
listen(window,'resize',availability,{passive:true});
// A completed click belongs to the page, even when focus enters a player or
// the pointer leaves the window. Only unfinished pointer gestures are canceled.
listen(window,'blur',()=>{gesture=null;});
listen(document,'pointerout',e=>{if(e.pointerType==='mouse'&&!e.relatedTarget)gesture=null;});
listen(document,'visibilitychange',availability);listen(reduced,'change',availability);
listen(window,'portfolio:enter',()=>{scheduleAuto();syncRepeats();});
export function destroyClickEffects(){if(destroyed)return;saveContinuity();destroyed=true;stopAuto();stopRepeatTimer();repeatQueue.length=0;stop('destroyed',true);ripples.destroy();cleanups.splice(0).forEach(fn=>fn());canvas.remove();ambientCanvas.remove();}
listen(window,'pagehide',e=>{stopAuto();saveContinuity();suspended=true;stopRepeatTimer();if(e.persisted)availability();else destroyClickEffects();});
// A normal load already consumes its snapshot below. BFCache needs one fresh
// restore after clearing its retained in-memory queue, never a second replay.
listen(window,'pageshow',e=>{suspended=false;if(e.persisted){stopRepeatTimer();repeatQueue.length=0;repeatsPaused=false;stop('idle',true);availability();restoreContinuity();}});
availability();
restoreContinuity();
