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
// One material contains exactly three travelling bands, with no center flash,
// cloud sprites or extra shell. Distances are in CSS pixels before touch scaling.
const RIPPLE_SIZE=256,RIPPLE_DELAY=.14,RIPPLE_DURATION=1.04;
const RIPPLE_WIDTHS=[4.8,1.8,.9],RIPPLE_LIFE=(RIPPLE_DURATION+RIPPLE_DELAY*2)*1000;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function rippleState(elapsed,index){
 const age=(elapsed-index*RIPPLE_DELAY)/RIPPLE_DURATION;
 if(age<=0||age>=1)return null;
 return {age,radius:8+102*(1-(1-age)**1.35),width:RIPPLE_WIDTHS[index],
  opacity:smooth(0,.06,age)*(1-age)**.62*[.94,.66,.49][index]};
}
const RIPPLE_FRAGMENT=`precision mediump float;
varying vec2 vUv;uniform vec2 uSize;uniform float uCount,uScale,uPixel;
uniform vec4 uPulse[3];uniform float uSeed[3];
void main(){
 vec2 point=vec2(vUv.x,1.-vUv.y)*uSize;
 float field=10000.,width=1.,fade=0.,contact=0.,rays=0.;vec3 color=vec3(0.);
 for(int pulse=0;pulse<3;pulse++){
  if(float(pulse)>=uCount)continue;
  vec2 p=(point-uPulse[pulse].xy)/uScale;
  float r=length(p),angle=atan(p.y,p.x),elapsed=uPulse[pulse].z,seed=uSeed[pulse];
  float localField=10000.,localWidth=1.,localFade=0.;vec3 localColor=vec3(0.);
  for(int i=0;i<3;i++){
   float index=float(i),age=(elapsed-index*${RIPPLE_DELAY})/${RIPPLE_DURATION};
   if(age<=0.||age>=1.)continue;
   float radius=8.+102.*(1.-pow(1.-age,1.35));
   float bandWidth=i==0?4.8:i==1?1.8:.9;
   float strength=i==0?.94:i==1?.66:.49,phase=elapsed+index*.31;
   float slow=sin(angle*3.-phase*4.3+seed),fast=sin(angle*7.+phase*6.3-seed*.6);
   float warp=(slow*1.35+fast*.55)*(i==0?1.:.55);
   float distance=r-radius-warp,thickness=bandWidth*(1.+slow*.18+fast*.08),profile=distance/thickness;
   float streamA=.5+.5*sin(angle*5.-phase*8.2+sin(angle*3.+phase*2.7)*.65+profile*2.3+seed);
   float streamB=.5+.5*sin(angle*11.+phase*5.5+sin(angle*7.-phase*3.1)*.8-profile*3.2);
   float flow=pow(streamA,.65)*.62+streamB*.38,d=(abs(distance)-thickness*.5)*uScale;
   if(i==0){
    float outside=distance-thickness*.5;
    float beam=smoothstep(.76,.99,streamA)*smoothstep(.25,.9,streamB);
    rays+=beam*smoothstep(.3,1.6,outside)*(1.-smoothstep(7.,14.,outside))*exp(-max(outside,0.)/6.)
      *smoothstep(0.,.06,age)*pow(1.-age,.62)*.13;
   }
   // A pulse keeps its three separate circles: no soft union between these.
   if(d<localField){
    localField=d;localWidth=thickness*uScale;
    localFade=smoothstep(0.,.06,age)*pow(1.-age,.62)*strength*(.76+flow*.24);
    localColor=mix(vec3(.26,.59,1.),vec3(.94,.985,1.),.12+flow*.83);
    float pink=smoothstep(.87,.995,streamB)*smoothstep(.25,.8,abs(profile))*.18;
    localColor=mix(localColor,vec3(1.,.69,.85),pink);
   }
  }
  if(localField>999.)continue;
  if(field>999.){field=localField;width=localWidth;fade=localFade;color=localColor;}
  else{
   // Polynomial smooth-min joins DIFFERENT click fields. Highlight only the
   // nearby contact surfaces, never the whole tile or a pulse's central hole.
   float k=7.5*uScale,h=clamp(.5+.5*(localField-field)/k,0.,1.);
   float joint=4.*h*(1.-h)*(1.-smoothstep(1.,8.*uScale,max(abs(field),abs(localField))));
   joint*=min(1.,min(fade,localFade)/.35);
   contact=max(contact,joint);
   field=mix(localField,field,h)-k*h*(1.-h);
   width=mix(localWidth,width,h);fade=mix(localFade,fade,h);color=mix(localColor,color,h);
  }
 }
 float core=1.-smoothstep(-.6*uPixel,.85*uPixel,field);
 float halo=exp(-pow(max(field,0.)/(width*.8+1.4+contact),2.))*.105;
 float alpha=min(.97,(core+halo)*fade+core*contact*.16);
 color=mix(color,vec3(.985,.995,1.),contact*.85);
 float rayAlpha=min(.075,rays)*(1.-alpha);
 gl_FragColor=vec4((color*alpha+vec3(.52,.78,1.)*rayAlpha)/max(.0001,alpha+rayAlpha),alpha+rayAlpha);
}`;
// CPU fallback samples the same signed bands and smooth union at a bounded
// resolution. Angular lookups avoid evaluating many sine fields per pixel.
function bandTable(elapsed,index,seed){
 const ring=rippleState(elapsed,index);if(!ring)return null;
 const values=[],phase=elapsed+index*.31;
 for(let n=0;n<=256;n++){
  const angle=n/256*Math.PI*2,slow=Math.sin(angle*3-phase*4.3+seed),fast=Math.sin(angle*7+phase*6.3-seed*.6);
  const radius=ring.radius+(slow*1.35+fast*.55)*(index===0?1:.55),width=ring.width*(1+slow*.18+fast*.08);
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
  uniforms=Object.fromEntries(['Size','Count','Scale','Pixel','Pulse[0]','Seed[0]'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);return true;
 }
 initialize();
 if(gl){listen(surface,'webglcontextlost',e=>{e.preventDefault();lost=true;});listen(surface,'webglcontextrestored',()=>{lost=!initialize();});}
 function fallback(group,w,h,scale,now){
  const step=Math.floor((now-group[0].born)/50),key=group.map(b=>b.id).join(',')+':'+step;
  if(cached.has(key))return cached.get(key);
  const sprite=document.createElement('canvas'),ratio=Math.min(.7,Math.sqrt(12000/(w*h)));
  sprite.width=Math.max(1,Math.floor(w*ratio));sprite.height=Math.max(1,Math.floor(h*ratio));
  const paint=sprite.getContext('2d');if(!paint)return null;
  const data=paint.createImageData(sprite.width,sprite.height),pixel=Math.max(w/sprite.width,h/sprite.height),k=7.5*scale;
  const sampleTime=group[0].born+(step+.5)*50;
  const tables=group.map(b=>({x:b.localX,y:b.localY,bands:[0,1,2].map(i=>bandTable((sampleTime-b.born)/1000,i,b.seed))}));
  for(let y=0;y<sprite.height;y++)for(let x=0;x<sprite.width;x++){
   const px=(x+.5)/sprite.width*w,py=(y+.5)/sprite.height*h;
   let field=10000,bandWidth=1,fade=0,contact=0,red=0,green=0,blue=0,rays=0;
   for(const pulse of tables){
    const dx=(px-pulse.x)/scale,dy=(py-pulse.y)/scale,r=Math.hypot(dx,dy),angle=(Math.atan2(dy,dx)/Math.PI/2+1)%1*256;
    const at=Math.floor(angle),fraction=angle-at;
    let localField=10000,localWidth=1,localFade=0,lr=0,lg=0,lb=0;
    for(const band of pulse.bands){
     if(!band)continue;const a=band.values[at],b=band.values[at+1],mix=(key)=>a[key]+(b[key]-a[key])*fraction;
     const width=mix('width'),distance=r-mix('radius'),d=(Math.abs(distance)-width*.5)*scale;if(d>=localField)continue;
     const profile=distance/width,streamA=.5+.5*Math.sin(mix('a')+profile*2.3),streamB=.5+.5*Math.sin(mix('b')-profile*3.2);
     const flow=streamA**.65*.62+streamB*.38,white=.12+flow*.83,pink=smooth(.87,.995,streamB)*smooth(.25,.8,Math.abs(profile))*.18;
     if(band.index===0){const outside=distance-width*.5;rays+=smooth(.76,.99,streamA)*smooth(.25,.9,streamB)*smooth(.3,1.6,outside)*(1-smooth(7,14,outside))*Math.exp(-Math.max(outside,0)/6)*band.opacity/.94*.13;}
     localField=d;localWidth=width*scale;localFade=band.opacity*(.76+flow*.24);
     lr=(.26+.68*white)*(1-pink)+pink;lg=(.59+.395*white)*(1-pink)+.69*pink;lb=1-.15*pink;
    }
    if(localField>999)continue;
    if(field>999){field=localField;bandWidth=localWidth;fade=localFade;red=lr;green=lg;blue=lb;}
    else{
     const blend=Math.max(0,Math.min(1,.5+.5*(localField-field)/k));
     const joint=4*blend*(1-blend)*(1-smooth(1,8*scale,Math.max(Math.abs(field),Math.abs(localField))))*Math.min(1,Math.min(fade,localFade)/.35);
     contact=Math.max(contact,joint);field=localField*(1-blend)+field*blend-k*blend*(1-blend);
     bandWidth=localWidth*(1-blend)+bandWidth*blend;fade=localFade*(1-blend)+fade*blend;
     red=lr*(1-blend)+red*blend;green=lg*(1-blend)+green*blend;blue=lb*(1-blend)+blue*blend;
    }
   }
   const core=1-smooth(-.6*pixel,.85*pixel,field),halo=Math.exp(-((Math.max(field,0)/(bandWidth*.8+1.4+contact))**2))*.105;
   const alpha=Math.min(.97,(core+halo)*fade+core*contact*.16),i=(y*sprite.width+x)*4,white=contact*.85;
   const rayAlpha=Math.min(.075,rays)*(1-alpha),total=alpha+rayAlpha,denominator=Math.max(.0001,total);
   data.data[i]=((red*(1-white)+.985*white)*alpha+.52*rayAlpha)/denominator*255;data.data[i+1]=((green*(1-white)+.995*white)*alpha+.78*rayAlpha)/denominator*255;data.data[i+2]=((blue*(1-white)+white)*alpha+rayAlpha)/denominator*255;data.data[i+3]=total*255;
  }
  paint.putImageData(data,0,0);if(cached.size>=32)cached.delete(cached.keys().next().value);cached.set(key,sprite);return sprite;
 }
 return {get mode(){return gl&&program&&!lost&&!gl.isContextLost()?'webgl':'cached';},get cacheSize(){return cached.size;},draw(group,w,h,scale,now){
  if(this.mode==='cached')return fallback(group,w,h,scale,now);
  const ratio=Math.min(1,Math.sqrt(140000/(w*h))),pw=Math.max(1,Math.floor(w*ratio)),ph=Math.max(1,Math.floor(h*ratio));
  if(surface.width!==pw)surface.width=pw;if(surface.height!==ph)surface.height=ph;
  const pulses=new Float32Array(12),seeds=new Float32Array(3);
  group.forEach((b,i)=>{pulses.set([b.localX,b.localY,(now-b.born)/1000,0],i*4);seeds[i]=b.seed;});
  gl.viewport(0,0,pw,ph);gl.useProgram(program);gl.uniform2f(uniforms.Size,w,h);gl.uniform1f(uniforms.Count,group.length);gl.uniform1f(uniforms.Scale,scale);gl.uniform1f(uniforms.Pixel,Math.max(w/pw,h/ph));
  gl.uniform4fv(uniforms['Pulse[0]'],pulses);gl.uniform1fv(uniforms['Seed[0]'],seeds);gl.drawArrays(gl.TRIANGLES,0,6);
  canvas.dataset.maxTilePixels=String(Math.max(Number(canvas.dataset.maxTilePixels)||0,pw*ph));return surface;
 },destroy(){cached.clear();if(gl){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}program=null;}};
}
const ripples=createRippleRenderer();let nextBurstId=0;
canvas.dataset.renderer=ripples.mode;canvas.dataset.material='three-flowing-ripples';canvas.dataset.rippleCount='3';
canvas.dataset.rippleDelays='0,140,280';canvas.dataset.rippleWidths=RIPPLE_WIDTHS.join(',');canvas.dataset.composition='cross-click-smooth-union';canvas.dataset.anchor='document';
function drawBursts(now){
 const groups=[];
 for(const burst of bursts){
  const group=[burst],pad=RIPPLE_SIZE*(burst.touch?.68:1);
  for(let i=groups.length-1;i>=0;i--)if(groups[i].some(a=>group.some(b=>Math.abs(a.pageX-b.pageX)<pad&&Math.abs(a.pageY-b.pageY)<pad))){group.push(...groups.splice(i,1)[0]);}
  groups.push(group);
 }
 let visibleGroups=0;
 for(const group of groups){
  const scale=group[0].touch?.68:1,pad=RIPPLE_SIZE*scale*.5;
  const left=Math.min(...group.map(b=>b.pageX))-pad,top=Math.min(...group.map(b=>b.pageY))-pad;
  const w=Math.max(...group.map(b=>b.pageX))+pad-left,h=Math.max(...group.map(b=>b.pageY))+pad-top;
  const rect=canvas.getBoundingClientRect(),x=left-scrollX-rect.left,y=top-scrollY-rect.top;
  if(x+w<0||y+h<0||x>width||y>height)continue;
  group.forEach(b=>{b.localX=b.pageX-left;b.localY=b.pageY-top;});
  const material=ripples.draw(group,w,h,scale,now);if(!material)continue;
  ctx.save();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=group[0].touch?.82:1;ctx.drawImage(material,x,y,w,h);ctx.restore();visibleGroups++;
 }
 canvas.dataset.renderer=ripples.mode;canvas.dataset.groups=String(visibleGroups);
}
function tick(now){
 frame=0;if(destroyed||suspended||document.hidden||reduced.matches){stop(reduced.matches?'disabled-motion':'suspended',true);return;}
 if(now-lastDraw>=1000/30){
  lastDraw=now;ctx.clearRect(0,0,width,height);
  for(let i=bursts.length-1;i>=0;i--)if(now-bursts[i].born>=bursts[i].life)bursts.splice(i,1);
  drawBursts(now);
 }
 if(bursts.length){frame=requestAnimationFrame(tick);state('active');}else stop();
}
function emit(x,y,keyboard,touch){
 if(!ctx||destroyed||suspended||document.hidden||reduced.matches)return;
 const rect=canvas.getBoundingClientRect();if(Math.abs(rect.width-width)>.01||Math.abs(rect.height-height)>.01)resize();
 while(bursts.length>=(touch?1:MAX_BURSTS))bursts.shift();
 const born=performance.now();
 const variant=Math.floor(Math.random()*4);
 bursts.push({id:++nextBurstId,pageX:x+scrollX,pageY:y+scrollY,born,life:RIPPLE_LIFE,touch,seed:variant*1.37,variant});
 canvas.dataset.lastX=String(x);canvas.dataset.lastY=String(y);canvas.dataset.mode='three-flowing-ripples';canvas.dataset.source=keyboard?'keyboard':touch?'touch':'mouse';canvas.dataset.maxBursts=String(touch?1:MAX_BURSTS);
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
 const pageX=x+scrollX,pageY=y+scrollY;
 const touch=!keyboard&&(gesture?.touch||coarse.matches);
 // Spawn the ripples on the next frame, after the control's activation handlers,
 // without delaying native clicks or navigation.
 const id=requestAnimationFrame(()=>{pending.delete(id);emit(pageX-scrollX,pageY-scrollY,keyboard,touch);});pending.add(id);gesture=null;
},true);
listen(window,'resize',()=>{stop('idle',true);resize();},{passive:true});
listen(window,'blur',()=>stop('suspended',true));
listen(document,'pointerout',e=>{if(e.pointerType==='mouse'&&!e.relatedTarget)stop('idle',true);});
listen(document,'visibilitychange',availability);listen(reduced,'change',availability);
export function destroyClickEffects(){if(destroyed)return;destroyed=true;stop('destroyed',true);ripples.destroy();cleanups.splice(0).forEach(fn=>fn());canvas.remove();}
listen(window,'pagehide',e=>{suspended=true;if(e.persisted)availability();else destroyClickEffects();});
listen(window,'pageshow',()=>{suspended=false;availability();});
availability();
