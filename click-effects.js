/* Short, independent activation feedback. Never adds to the cursor trail. */
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const canvas = document.createElement('canvas');
canvas.id = 'click-effects-canvas'; canvas.setAttribute('aria-hidden','true'); canvas.dataset.noTranslate = '';
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;user-select:none;z-index:90;contain:strict;';
document.body.append(canvas);
const ctx = canvas.getContext('2d', {alpha:true});
const bursts = [], cleanups = [], pending = new Set();
const MAX_BURSTS = 3, modeNames = ['ring','nebula','flow'];
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
function star(x,y,r,alpha){
 ctx.globalAlpha=alpha;ctx.beginPath();
 ctx.moveTo(x-r,y);ctx.lineTo(x-3,y);ctx.moveTo(x+3,y);ctx.lineTo(x+r,y);
 ctx.moveTo(x,y-r);ctx.lineTo(x,y-3);ctx.moveTo(x,y+3);ctx.lineTo(x,y+r);ctx.stroke();
}
function draw(b,now){
 const age=(now-b.born)/b.life,fade=(1-age)**1.6,spread=(1-(1-age)**2),radius=(b.touch?8:11)+spread*(b.touch?16:31);
 const alpha=fade*(b.touch?.27:.43);
 ctx.strokeStyle='#b4e7ff';ctx.fillStyle='#daf5ff';ctx.lineWidth=.85;ctx.lineCap='round';
 if(b.mode===0){
  ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(b.x,b.y,radius,.25+age*.5,Math.PI*1.12+age*.5);ctx.stroke();
  ctx.globalAlpha=alpha*.65;ctx.beginPath();ctx.arc(b.x,b.y,radius*.77,Math.PI*1.28-age*.4,Math.PI*1.91-age*.4);ctx.stroke();
 }else if(b.mode===1){
  for(let arm=0;arm<2;arm++){
   ctx.globalAlpha=alpha*.8;ctx.beginPath();
   for(let step=0;step<=17;step++){
    const t=step/17,a=arm*Math.PI+t*1.8+age*1.2,r=7+t*radius*.7;
    const x=b.x+Math.cos(a)*r,y=b.y+Math.sin(a)*r;
    if(step===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
   }ctx.stroke();
  }
 }else{
  for(let i=0;i<4;i++){
   const a=Math.PI*.25+i*Math.PI*.5,r0=7+spread*7,r1=radius;
   ctx.globalAlpha=alpha;ctx.beginPath();ctx.moveTo(b.x+Math.cos(a)*r0,b.y+Math.sin(a)*r0);ctx.lineTo(b.x+Math.cos(a)*r1,b.y+Math.sin(a)*r1);ctx.stroke();
  }
  if(!b.touch)star(b.x+radius*.8,b.y-radius*.45,4+fade*2,alpha*.65);
 }
 const count=b.touch?1:3;
 for(let i=0;i<count;i++){
  const a=b.seed+i*2.399+age*.24,r=radius*(.82+i*.13);
  ctx.globalAlpha=alpha*.72;ctx.beginPath();ctx.arc(b.x+Math.cos(a)*r,b.y+Math.sin(a)*r,.75,0,Math.PI*2);ctx.fill();
 }
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
 const mode=Math.max(0,modeNames.indexOf(document.documentElement.dataset.interactionMode));
 while(bursts.length>=(touch?1:MAX_BURSTS))bursts.shift();
 bursts.push({x:x-rect.left,y:y-rect.top,born:performance.now(),life:touch?600:900,mode,touch,seed:Math.random()*Math.PI*2});
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode=modeNames[mode];canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(MAX_BURSTS);
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
 // The control's activation handler chooses its mode during this same click.
 // A microtask may run between native event listeners. The next frame reads
 // the final mode after capture/bubble, without delaying native navigation.
 const id=requestAnimationFrame(()=>{pending.delete(id);emit(x,y,keyboard,touch);});pending.add(id);gesture=null;
},true);
listen(window,'resize',()=>{stop('idle',true);resize();},{passive:true});
listen(window,'blur',()=>stop('suspended',true));
listen(document,'visibilitychange',availability);listen(reduced,'change',availability);
export function destroyClickEffects(){if(destroyed)return;destroyed=true;stop('destroyed',true);cleanups.splice(0).forEach(fn=>fn());canvas.remove();}
listen(window,'pagehide',e=>{suspended=true;if(e.persisted)availability();else destroyClickEffects();});
listen(window,'pageshow',()=>{suspended=false;availability();});
availability();
