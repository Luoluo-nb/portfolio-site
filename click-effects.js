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
function draw(b,now){
 const age=Math.max(0,Math.min(1,(now-b.born)/b.life));
 const fade=(1-age)**1.65,spread=1-(1-age)**2,attack=Math.min(1,age/.045);
 const size=b.touch?.62:1,count=b.touch?3:5;
 ctx.save();ctx.globalCompositeOperation='screen';
 for(let i=0;i<count;i++){
  const sprite=clouds[(i+b.variant)%clouds.length];if(!sprite)continue;
  const turn=(i%2?-.66:.85)*age,angle=b.seed+i*2.399+turn;
  const distance=spread*(9+i*4.1)*size;
  const diameter=(25+spread*58)*(.78+i*.085)*size;
  ctx.save();ctx.translate(b.x+Math.cos(angle)*distance,b.y+Math.sin(angle)*distance*.82);
  ctx.rotate(b.seed+i*.71+turn);ctx.scale(1,.78+(i%3)*.11);
  ctx.globalAlpha=fade*attack*(b.touch?.44:.72);
  ctx.drawImage(sprite,-diameter/2,-diameter/2,diameter,diameter);ctx.restore();
 }
 if(flashContext){const diameter=(17+spread*15)*size;ctx.globalAlpha=Math.exp(-age*13)*(b.touch?.38:.65);ctx.drawImage(flash,b.x-diameter/2,b.y-diameter/2,diameter,diameter);}
 // A few round specks drift with the cloud; no star arms or circular outline.
 ctx.fillStyle='#c9edff';
 for(let i=0;i<(b.touch?2:6);i++){
  const angle=b.seed+i*2.399+age*(i%2?-.5:.65),radius=(5+spread*(23+i*4))*size;
  ctx.globalAlpha=fade*attack*(b.touch?.3:.52);
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
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode='nebula-burst';canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(touch?1:MAX_BURSTS);
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
export function destroyClickEffects(){if(destroyed)return;destroyed=true;stop('destroyed',true);cleanups.splice(0).forEach(fn=>fn());canvas.remove();}
listen(window,'pagehide',e=>{suspended=true;if(e.persisted)availability();else destroyClickEffects();});
listen(window,'pageshow',()=>{suspended=false;availability();});
availability();
