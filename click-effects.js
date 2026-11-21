/* Short, independent activation feedback. Never adds to the cursor trail. */
import {emitNavigationRipple} from './nav-click-effects.js';
import {createAmbientTextFlow} from './ambient-text-flow.js';
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
const ambientTextFlow=createAmbientTextFlow();
let ambientTextActive=false;
const bursts = [], ambientWaves = [], repeatQueue = [], cleanups = [], pending = new Set();
// Three independent fifteen-click groups own the live outer rings. Inner-only
// afterglow and short group exits have their own bounded visual allowance.
const CLICKS_PER_GROUP=15,STYLE_COUNT=3,MAX_MAIN_GROUPS=3;
const MAX_BURSTS=CLICKS_PER_GROUP*MAX_MAIN_GROUPS,MAX_TAIL_BURSTS=90,MAX_VISUAL_BURSTS=MAX_BURSTS+MAX_TAIL_BURSTS;
const EXIT_MS=280,MIN_VISIBLE_MS=180;
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
function state(value){canvas.dataset.state=value;canvas.dataset.bursts=String(bursts.length);canvas.dataset.ambientWaves=String(ambientWaves.length);canvas.dataset.running=String(Boolean(frame));canvas.dataset.activeOuter=String(bursts.filter(b=>b.outerAlive&&b.retiredAt===null).length);canvas.dataset.afterglow=String(bursts.filter(b=>b.mode!=='crowded'&&!b.outerAlive&&b.retiredAt===null).length);canvas.dataset.crowdedBursts=String(bursts.filter(b=>b.mode==='crowded').length);canvas.dataset.retiring=String(bursts.filter(b=>b.retiredAt!==null).length);ambientCanvas.dataset.state=value;ambientCanvas.dataset.waves=String(ambientWaves.length);}
function stop(reason='idle',cancelInput=false,preserveBursts=false){
 if(frame)cancelAnimationFrame(frame);frame=0;lastDraw=0;if(!preserveBursts){bursts.length=0;ambientWaves.length=0;}
 if(cancelInput){for(const id of pending)cancelAnimationFrame(id);pending.clear();gesture=null;}
 ctx?.clearRect(0,0,width,height);ambientCtx?.clearRect(0,0,width,height);
 clearAmbientTextFlow();
 for(const layer of [canvas,ambientCanvas]){layer.style.left='0px';layer.style.top='0px';}state(reason);
}
function resize(){
 clearAmbientTextFlow();
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
 ambientTextFlow.resize(width,height);
}
function clearAmbientTextFlow(){if(ambientTextActive){ambientTextFlow.clear();ambientTextActive=false;}}
function availability(){
 stopAuto();
 const unsupported=!ctx&&!ambientCtx,disabled=unsupported||reduced.matches||document.hidden||suspended;
 canvas.hidden=disabled||!ctx;ambientCanvas.hidden=disabled||!ambientCtx;
 stop(unsupported?'unsupported':reduced.matches?'disabled-motion':disabled?'suspended':'idle',true,!unsupported&&!reduced.matches);
 if(!ctx)bursts.length=0;if(!ambientCtx)ambientWaves.length=0;
 if(!disabled){resize();updateLifecycle(performance.now());updateAmbientWaves(performance.now());if(bursts.length||ambientWaves.length){frame=requestAnimationFrame(tick);state('active');}scheduleAuto();}
 syncRepeats();
}
// A normal click owns three travelling bands, with no center flash,
// cloud sprites or extra shell. Distances are in CSS pixels before touch scaling.
const RIPPLE_RADIUS=825/1.9,RIPPLE_BASE_SPEED=1/3/1.5,RIPPLE_SPEED=RIPPLE_BASE_SPEED*1.3;
const RIPPLE_DELAY=.14/RIPPLE_SPEED,RIPPLE_DURATION=1.42/RIPPLE_SPEED,RIPPLE_EASE=1.35;
// Inner lines keep their readable floor. The thin outer line exits by width
// alone, so its geometry must be allowed to reach exactly zero.
const RIPPLE_WIDTHS=[2,1.3,1.7],RIPPLE_MIN_WIDTHS=[0,.9,1.05];
// Expansion keeps its requested 1.3x travel speed. The outer band reaches zero
// width at its shorter lifetime; the unchanged inner lines outlive the outer.
const RIPPLE_LIFE=(1.42+.14*2)/RIPPLE_BASE_SPEED*1000*.5,OUTER_LIFE_SHARE=.56;
const OUTER_END_RADIUS=8+(RIPPLE_RADIUS-8)*(1-(1-Math.min(1,RIPPLE_LIFE*OUTER_LIFE_SHARE/1000/RIPPLE_DURATION))**RIPPLE_EASE);
// Ambient color planes have their own clock and pool, never a manual group.
const AUTO_RADIUS=RIPPLE_RADIUS*5,AUTO_EXPAND_MS=RIPPLE_DURATION*1000/1.6,AUTO_LIFE=AUTO_EXPAND_MS;
const AUTO_BANDS=[{width:200,gap:0},{width:5,gap:8}];
const AUTO_MOBILE_BANDS=[{width:72,gap:0},{width:2,gap:8}],AUTO_MOBILE_DURATION_SCALE=1.6;
const AUTO_MAX_LIFE=AUTO_LIFE*AUTO_MOBILE_DURATION_SCALE;
// The birth-time touch flag survives navigation; a carried wave keeps its clock
// and band widths even if the current page's pointer media query changes.
const autoWaveLife=wave=>AUTO_LIFE*(wave.touch?AUTO_MOBILE_DURATION_SCALE:1);
const autoWaveBands=wave=>wave.touch?AUTO_MOBILE_BANDS:AUTO_BANDS;
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
// Birth shape never changes when the outer dies. A nested first inner ring
// starts immediately, while all inner afterglow keeps the same 3.825s lifetime.
const visualElapsed=(burst,now)=>Math.max(.045,(now-burst.born)/1000);
const exitWeight=(burst,now)=>burst.retiredAt===null?1:1-smooth(0,EXIT_MS,now-burst.retiredAt);
const visualWeight=(burst,now)=>exitWeight(burst,now);
let nextBurstId=0;
canvas.dataset.renderer='native-conic-flow';canvas.dataset.material='independent-flowing-arcs';canvas.dataset.rippleCount='3';
canvas.dataset.rippleDelays=[0,1,2].map(index=>index*RIPPLE_DELAY*1000).join(',');canvas.dataset.rippleWidths=RIPPLE_WIDTHS.join(',');canvas.dataset.composition='independent-circle-overlap';canvas.dataset.anchor='document';canvas.dataset.sdf='disabled';
canvas.dataset.rippleSpeed=String(RIPPLE_SPEED);canvas.dataset.rippleDuration=String(RIPPLE_DURATION);canvas.dataset.widthHalfRadius=String(RIPPLE_RADIUS*.1);canvas.dataset.widthOrder='thin-lines';
canvas.dataset.crossing='uncut-overlap';canvas.dataset.motion='center-lit-conic';canvas.dataset.scrollProjection='native-document-layer';canvas.dataset.maxRadius=String(RIPPLE_RADIUS);canvas.dataset.color='white';canvas.dataset.geometry='native-tapered-arc';
canvas.dataset.groupSize=String(CLICKS_PER_GROUP);canvas.dataset.styleCount=String(STYLE_COUNT);canvas.dataset.groupInteraction='none';
canvas.dataset.maxMainGroups=String(MAX_MAIN_GROUPS);canvas.dataset.maxActive=String(MAX_BURSTS);canvas.dataset.maxVisuals=String(MAX_VISUAL_BURSTS);
canvas.dataset.outerEndRadius=String(OUTER_END_RADIUS);canvas.dataset.outerWidthHalfRadius=String(OUTER_END_RADIUS*.5);canvas.dataset.outerExit='width-to-zero';
canvas.dataset.flowHighlights='1';canvas.dataset.flowArcRange='60-360';canvas.dataset.flowRandomness='fixed-per-ring';
function updateLifecycle(now,reservedLoad=0){
 for(let i=bursts.length-1;i>=0;i--){
  const burst=bursts[i];
  if(burst.retiredAt!==null&&burst.firstDrawAt===null&&now-burst.born<burst.life)burst.retiredAt=Math.max(burst.retiredAt,now+MIN_VISIBLE_MS);
  if(now-burst.born>=burst.life||(burst.retiredAt!==null&&now-burst.retiredAt>=EXIT_MS)){bursts.splice(i,1);continue;}
  if(burst.outerAlive&&now-burst.born>115){
   const outer=rippleState(visualElapsed(burst,now),0);
   if(!outer||outer.width<=0)burst.outerAlive=false;
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
 const ids=new Set(bursts.filter(b=>b.outerAlive&&b.retiredAt===null).map(b=>b.groupId));
 if(incomingGroup!==undefined)ids.add(incomingGroup);
 const ordered=[...ids].sort((a,b)=>a-b);
 while(ordered.length>MAX_MAIN_GROUPS){
  const oldGroup=ordered.shift();
  for(const burst of bursts)if(burst.mode!=='crowded'&&burst.groupId===oldGroup)retireBurst(burst,now);
 }
}
function reserveVisualSlot(now){
 while(bursts.length>=MAX_VISUAL_BURSTS){
  // Live outer rings do not compete with invisible outer shells' inner afterglow.
  // At pathological event rates, prefer already-seen tails before any fresh birth.
  const ranked=bursts.map((burst,index)=>({burst,index,seen:burst.firstDrawAt!==null,protected:burst.firstDrawAt===null||now-burst.firstDrawAt<MIN_VISIBLE_MS}));
  ranked.sort((a,b)=>Number(a.protected)-Number(b.protected)||Number(!a.seen)-Number(!b.seen)||Number(a.burst.outerAlive&&a.burst.retiredAt===null)-Number(b.burst.outerAlive&&b.burst.retiredAt===null)||a.burst.born-b.burst.born||a.burst.id-b.burst.id);
  bursts.splice(ranked[0].index,1);
  canvas.dataset.pressureReclaims=String((Number(canvas.dataset.pressureReclaims)||0)+1);
 }
}
function createFlowBands(seed,mode,style){
 const tau=Math.PI*2,count=mode==='crowded'?1:3,flows=[];
 const base=mode==='crowded'?[55,213,237]:style===1?[210,240,255]:style===2?[255,231,209]:[226,241,255];
 const center=mode==='crowded'?[195,253,255]:[255,255,255],peak=mode==='crowded'?.56:.98;
 for(let ring=0;ring<count;ring++){
  let randomState=(seed^Math.imul(ring+1,0x9e3779b9))>>>0;
  const random=()=>{randomState=(randomState+0x6d2b79f5)>>>0;let value=randomState;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return ((value^(value>>>14))>>>0)/4294967296;};
  // Every visible ring gets independent, stable arc length and motion.
  const arc=(60+300*random())*Math.PI/180,start=random()*tau,direction=random()<.5?-1:1,speed=.38+.92*random();
  const taper=(style===1?.62:style===2?1.18:.82)*(.85+.3*random());
  // Sample after the existing shape/motion sequence so saved seeds retain it.
  const alphaPower=1+4*random();
  const segments=Math.max(16,Math.ceil(arc*16)*2),points=new Float32Array((segments+1)*3);
  for(let n=0;n<=segments;n++){
   const t=n/segments,angle=direction*arc*(t-1);
   const gain=n===0||n===segments?0:Math.pow(Math.sin(Math.PI*t),taper);
   points.set([Math.cos(angle),Math.sin(angle),gain],n*3);
  }
  // The local arc midpoint is widest, brightest and whitest. Both endpoints
  // taper to exactly zero, including the shared seam of a full 360-degree arc.
  const profile=[[0,0],[.12,.04],[.28,.24],[.42,.68],[.5,1],[.58,.68],[.72,.24],[.88,.04],[1,0]];
  const color=(t,alpha)=>{const blend=smooth(.35,1,1-Math.abs(t*2-1)),rgb=base.map((value,i)=>Math.round(value+(center[i]-value)*blend));return 'rgba('+rgb.join(',')+','+(Math.pow(alpha,alphaPower)*peak)+')';};
  const linearStops=profile.map(([t,alpha])=>({offset:t,color:color(t,alpha)}));
  const fraction=arc/tau;
  const stops=linearStops.map(stop=>({offset:direction>0?stop.offset*fraction:1-stop.offset*fraction,color:stop.color}));
  stops.push({offset:0,color:color(0,0)},{offset:1,color:color(0,0)});stops.sort((a,b)=>a.offset-b.offset);
  // Radial fallback is centered on the same midpoint. Its chord-distance
  // mapping stays non-degenerate even when the endpoints meet at 360 degrees.
  const radialStops=linearStops.filter(stop=>stop.offset>=.5).map(stop=>({offset:Math.min(1,Math.sin((stop.offset-.5)*arc/2)/Math.sin(arc/4)),color:stop.color}));
  flows.push({arc,start,direction,speed,alphaPower,segments,points,stops,radialStops});
 }
 return flows;
}
function drawFlowBursts(now,viewLeft,viewTop){
 const visibleGroups=new Set();
 ctx.save();ctx.globalCompositeOperation='source-over';
 for(const burst of bursts){
  const crowded=burst.mode==='crowded',elapsed=visualElapsed(burst,now),scale=burst.touch?.68:1;
  // Use raw birth age here, independent of the first-visible geometry floor.
  const birthOpacity=2/3+smooth(0,240,Math.max(0,now-burst.born))/3;
  const cx=burst.pageX-viewLeft,cy=burst.pageY-viewTop;
  const near=Math.hypot(Math.max(0,-cx,cx-width),Math.max(0,-cy,cy-height));
  const far=Math.hypot(Math.max(Math.abs(cx),Math.abs(width-cx)),Math.max(Math.abs(cy),Math.abs(height-cy)));
  const flows=burst.flows||(burst.flows=createFlowBands(burst.flowSeed,burst.mode,burst.style));
  for(let ring=0;ring<flows.length;ring++){
   if(!crowded&&ring===0&&!burst.outerAlive)continue;
   const band=crowded?rippleState(elapsed,1,true):rippleState(elapsed,ring,burst.birthNested);if(!band)continue;
   const radius=band.radius*scale;
   if(radius<near-3||radius>far+3)continue;
   const thickness=crowded?Math.max(1,CROWDED_WIDTH*scale):ring===0?band.width*scale:Math.max(band.width*scale,.95*width/canvas.width);
   if(thickness<=0)continue;
   const flow=flows[ring];
   const angle=flow.start+flow.direction*flow.speed*elapsed,cos=Math.cos(angle),sin=Math.sin(angle),half=thickness*.5;
   const tail=angle-flow.direction*flow.arc;
   let gradient;
   if(typeof ctx.createConicGradient==='function'){
    gradient=ctx.createConicGradient(tail,cx,cy);
    for(const stop of flow.stops)gradient.addColorStop(stop.offset,stop.color);
   }else{
    // Older Canvas implementations keep the same moving midpoint highlight.
    const middle=angle-flow.direction*flow.arc*.5,mx=cx+Math.cos(middle)*radius,my=cy+Math.sin(middle)*radius;
    gradient=ctx.createRadialGradient(mx,my,0,mx,my,Math.max(1,2*radius*Math.sin(flow.arc/4)));
    for(const stop of flow.radialStops)gradient.addColorStop(stop.offset,stop.color);
   }
   ctx.globalAlpha=(crowded?band.opacity/.62:band.opacity)*visualWeight(burst,now)*birthOpacity*(!crowded&&burst.touch?.82:1);
   ctx.fillStyle=gradient;ctx.beginPath();
   // These cached points describe only this arc. Its centerline stays circular;
   // both ends meet at zero width, so no circle masking or extra pass is needed.
   const points=flow.points;
   for(let n=0;n<=flow.segments;n++){
    const at=n*3,x=points[at]*cos-points[at+1]*sin,y=points[at]*sin+points[at+1]*cos,r=radius+half*points[at+2];
    if(n===0)ctx.moveTo(cx+x*r,cy+y*r);else ctx.lineTo(cx+x*r,cy+y*r);
   }
   for(let n=flow.segments;n>=0;n--){
    const at=n*3,x=points[at]*cos-points[at+1]*sin,y=points[at]*sin+points[at+1]*cos,r=Math.max(0,radius-half*points[at+2]);
    ctx.lineTo(cx+x*r,cy+y*r);
   }
   ctx.closePath();ctx.fill();
   if(!crowded)visibleGroups.add(burst.groupId);
   if(burst.firstDrawAt===null){burst.firstDrawAt=now;if(burst.retiredAt!==null)burst.retiredAt=Math.max(burst.retiredAt,now+MIN_VISIBLE_MS);}
  }
 }
 ctx.restore();
 canvas.dataset.groups=String(visibleGroups.size);canvas.dataset.mainGroups=String(new Set(bursts.filter(b=>b.outerAlive&&b.retiredAt===null).map(b=>b.groupId)).size);canvas.dataset.frameTexturePixels='0';
}
function updateAmbientWaves(now){
 for(let i=ambientWaves.length-1;i>=0;i--)if(now-ambientWaves[i].born>=autoWaveLife(ambientWaves[i]))ambientWaves.splice(i,1);
}
function drawAmbientWaves(now,viewLeft,viewTop,viewportLeft,viewportTop){
 // Filled annular areas, not stroked outlines, sparkles, trails or SDF masks.
 // Native paths clip at the viewport; a fivefold radius needs no large texture.
 const visibleBands=[],paint=ambientCtx;if(!paint)return visibleBands;
 paint.save();paint.globalCompositeOperation='source-over';paint.globalAlpha=1;paint.fillStyle='#ffffff';
 for(const wave of ambientWaves){
  const elapsed=Math.max(0,now-wave.born),progress=Math.min(1,elapsed/autoWaveLife(wave)),bands=autoWaveBands(wave);
  const radialProgress=1-(1-progress)**1.55;
  const radius=AUTO_RADIUS*(wave.touch?.68:1)*radialProgress;
  // Disappearance changes geometry only: the fill never becomes translucent.
  const widthScale=1-smooth(.5,1,radialProgress);
  const cx=wave.pageX-viewLeft,cy=wave.pageY-viewTop;
  const near=Math.hypot(Math.max(0,-cx,cx-width),Math.max(0,-cy,cy-height));
  const far=Math.hypot(Math.max(Math.abs(cx),Math.abs(width-cx)),Math.max(Math.abs(cy),Math.abs(height-cy)));
  let outside=radius;
  for(let index=0;index<bands.length;index++){
   const band=bands[index];
   outside-=band.gap;if(outside<=0)continue;
   const inside=Math.max(0,outside-band.width*widthScale);
   if(outside-inside<=0||outside<near-1||inside>far+1){outside=inside;continue;}
   paint.beginPath();paint.arc(cx,cy,outside,0,Math.PI*2);
   if(inside>0){paint.moveTo(cx+inside,cy);paint.arc(cx,cy,inside,0,Math.PI*2,true);}
   paint.fill();
   // Reuse the exact filled annulus, including its shrinking width and inner
   // radius clamped at zero. The text overlay consumes viewport CSS coordinates.
   visibleBands.push({cx:cx+viewportLeft,cy:cy+viewportTop,outer:outside,inner:inside,elapsed:elapsed/1000,bandIndex:index});
   outside=inside;
  }
 }
 paint.restore();
 return visibleBands;
}
function emitAmbientWave(x,y){
 if(!autoAllowed())return;
 updateAmbientWaves(performance.now());
 if(ambientWaves.length>=2)ambientWaves.shift();
 const wave={pageX:x+scrollX,pageY:y+scrollY,born:performance.now(),touch:coarse.matches};ambientWaves.push(wave);
 canvas.dataset.autoMaterial='two-opaque-color-bands';canvas.dataset.autoWidths=autoWaveBands(wave).map(band=>band.width).join(',');canvas.dataset.autoDuration=String(autoWaveLife(wave));canvas.dataset.autoGap='8';canvas.dataset.autoMaxRadius=String(AUTO_RADIUS);canvas.dataset.autoSdf='excluded';canvas.dataset.autoExit='width-to-zero';
 if(!frame)frame=requestAnimationFrame(tick);state('active');saveContinuity();
}
function tick(now){
 frame=0;if(destroyed||suspended||document.hidden||reduced.matches){stop(reduced.matches?'disabled-motion':'suspended',true,!reduced.matches);return;}
 let painted=false;
 if(now-lastDraw>=1000/30){
  lastDraw=now;ctx?.clearRect(0,0,width,height);ambientCtx?.clearRect(0,0,width,height);
  updateLifecycle(now);
  updateAmbientWaves(now);
  const frameScrollX=scrollX,frameScrollY=scrollY;
  for(const layer of [canvas,ambientCanvas]){layer.style.left=frameScrollX+'px';layer.style.top=frameScrollY+'px';}
  // Both layers share their CSS projection, with one layout read per frame.
  const rect=projectionCanvas.getBoundingClientRect(),viewLeft=frameScrollX+rect.left,viewTop=frameScrollY+rect.top;
  const bands=ambientWaves.length?drawAmbientWaves(now,viewLeft,viewTop,rect.left,rect.top):[];
  if(bands.length){ambientTextFlow.render(bands,{now,width,height,left:frameScrollX,top:frameScrollY});ambientTextActive=true;}
  else clearAmbientTextFlow();
  if(ctx&&bursts.length)drawFlowBursts(now,viewLeft,viewTop);
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
  if(!other.outerAlive||other.groupId!==groupId)return false;
  const band=rippleState(visualElapsed(other,born),0);if(!band)return false;
  return band.opacity*visualWeight(other,born)*(band.width/RIPPLE_WIDTHS[0])>.008&&Math.hypot(pageX-other.pageX,pageY-other.pageY)<band.radius*(other.touch?.68:1);
 });
 if(mode!=='crowded')limitMainGroups(born,groupId);
 reserveVisualSlot(born);
 const flowSeed=Math.floor(Math.random()*4294967296);
 bursts.push({id:++nextBurstId,mode,groupId,style,pageX,pageY,born,life:RIPPLE_LIFE,touch,birthNested,outerAlive:mode!=='crowded'&&!birthNested,flowSeed,retiredAt:null,firstDrawAt:null});
 canvas.dataset.clickSequence=String(clickSequence);if(mode!=='crowded'){canvas.dataset.currentGroup=String(groupId);canvas.dataset.currentStyle=String(style);}
 canvas.dataset.lastOuterEnabled=String(mode!=='crowded'&&!birthNested);canvas.dataset.overlapRule='uncut';
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode=mode==='crowded'?'single-cyan-conic':'flowing-conic-arcs';canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(MAX_BURSTS);canvas.dataset.maxActive=String(MAX_BURSTS);canvas.dataset.tailSlots=String(MAX_TAIL_BURSTS);
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
 try{sessionStorage.setItem(CONTINUITY_KEY,JSON.stringify({version:10,sequence:clickSequence,crowdedMode,savedAt:Date.now(),repeats:repeatQueue.map(action=>({x:action.pageX-scrollX,y:action.pageY-scrollY,remaining:action.remaining,wait:action.nextDue-now,keyboard:action.keyboard,touch:action.touch})),waves:ambientWaves.map(w=>({x:w.pageX-scrollX,y:w.pageY-scrollY,age:now-w.born,touch:w.touch})),pulses:bursts.map(b=>({mode:b.mode||'normal',groupId:b.groupId,style:b.style,x:b.pageX-scrollX,y:b.pageY-scrollY,age:now-b.born,touch:b.touch,birthNested:b.birthNested,outerAlive:b.outerAlive,flowSeed:b.flowSeed,retiredAge:b.retiredAt===null?null:now-b.retiredAt,drawnAge:b.firstDrawAt===null?null:now-b.firstDrawAt}))}));}catch{}
}
function restoreContinuity(){
 if(destroyed||suspended)return;
 let saved;try{const value=sessionStorage.getItem(CONTINUITY_KEY);if(!value)return;saved=JSON.parse(value);}catch{return;}
 if(!saved||typeof saved!=='object')return;
 crowdedMode=saved.version>=9&&saved.crowdedMode===true;
 canvas.dataset.crowdedMode=String(crowdedMode);
 // Older automatic rings must not re-enter the manual pool on navigation.
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
 try{sessionStorage.setItem(CONTINUITY_KEY,JSON.stringify({version:10,sequence:clickSequence,crowdedMode,savedAt:Date.now(),pulses:[],waves:[],repeats:[]}));}catch{}
 if(reduced.matches||!ctx&&!ambientCtx)return;
 const gap=Date.now()-saved?.savedAt;
 if(!Number.isFinite(gap)||gap<0||gap>Math.max(RIPPLE_LIFE,AUTO_MAX_LIFE))return;
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
  const flowSeed=Number.isInteger(p.flowSeed)&&p.flowSeed>=0&&p.flowSeed<4294967296?p.flowSeed:((variant*239+(Math.max(0,groupId)%1024)*73)%1024);
  const outer=mode==='crowded'||birthNested?null:rippleState(Math.max(.045,age/1000),0);
  const outerAlive=!!outer&&outer.width>0&&(saved.version<6||(p.outerAlive??p.liveSDF)!==false);
  const drawnAge=p.drawnAge==null?null:Number(p.drawnAge)+gap;
  bursts.push({id:++nextBurstId,mode,groupId,style,pageX:p.x+scrollX,pageY:p.y+scrollY,born:now-age,life,touch:!!p.touch,birthNested,outerAlive,flowSeed,retiredAt:retiredAge===null?null:now-retiredAge,firstDrawAt:drawnAge!==null&&Number.isFinite(drawnAge)?now-drawnAge:null});
 }
 if(ambientCtx)for(const wave of (Array.isArray(saved.waves)?saved.waves:[]).slice(-2)){
  if(!wave||!Number.isFinite(wave.x)||!Number.isFinite(wave.y)||!Number.isFinite(wave.age))continue;
  const age=Math.max(0,wave.age)+gap;if(age>=autoWaveLife(wave))continue;
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
export function destroyClickEffects(){if(destroyed)return;saveContinuity();destroyed=true;stopAuto();stopRepeatTimer();repeatQueue.length=0;stop('destroyed',true);ambientTextFlow.destroy();cleanups.splice(0).forEach(fn=>fn());canvas.remove();ambientCanvas.remove();}
listen(window,'pagehide',e=>{stopAuto();saveContinuity();suspended=true;stopRepeatTimer();if(e.persisted)availability();else destroyClickEffects();});
// A normal load already consumes its snapshot below. BFCache needs one fresh
// restore after clearing its retained in-memory queue, never a second replay.
listen(window,'pageshow',e=>{suspended=false;if(e.persisted){stopRepeatTimer();repeatQueue.length=0;repeatsPaused=false;stop('idle',true);availability();restoreContinuity();}});
availability();
restoreContinuity();
