// Refraction is applied to trail geometry only. Stable facet intersections split
// the chain into small vectors, avoiding a full-frame raster/compositing pass.
const SAFE_RADIUS=50,FADE_RADIUS=96;
const LAYOUT=[[.17,.23,.145,.185,-.22],[.34,.32,.16,.155,.48],[.62,.21,.14,.18,-.6],[.78,.40,.16,.19,.16],[.25,.64,.18,.19,.62],[.48,.58,.16,.23,-.38],[.68,.75,.195,.18,.35],[.12,.84,.105,.12,-.72]];
const cross=(x,y,u,v)=>x*v-y*u;
function randomSequence(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function inside(x,y,points){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
export function createCursorPrism(canvas,context){
  let width=1,height=1,dprX=1,dprY=1,regions=Object.freeze([]),destroyed=false,active=false,lastRenderTime=0,segmentCount=0,fragmentCount=0,gapCount=0;
  const used=new Set();
  function clear(){active=false;used.clear();segmentCount=fragmentCount=gapCount=0;}
  function resize(w,h){
    if(destroyed)return;width=Math.max(1,w||1);height=Math.max(1,h||1);dprX=canvas.width/width;dprY=canvas.height/height;
    const random=randomSequence(0x31a8f4c2),smallSide=Math.min(width,height);
    regions=Object.freeze(LAYOUT.map(([x,y,rx,ry,rotation],index)=>{
      const center=Object.freeze({x:x*width,y:y*height}),radiusX=Math.min(rx*width,smallSide*.35),radiusY=Math.min(ry*height,smallSide*.34),count=5+index%3;
      const points=Object.freeze(Array.from({length:count},(_,vertex)=>{const a=rotation+(vertex+(random()-.5)*.28)*Math.PI*2/count,r=.82+random()*.3;return Object.freeze({x:center.x+Math.cos(a)*radiusX*r,y:center.y+Math.sin(a)*radiusY*r});}));
      const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))*dprX)/dprX),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))*dprY)/dprY),right=Math.min(width,Math.ceil(Math.max(...points.map(p=>p.x))*dprX)/dprX),bottom=Math.min(height,Math.ceil(Math.max(...points.map(p=>p.y))*dprY)/dprY);
      const direction=random()*Math.PI*2,distance=4.5+random()*4;
      return Object.freeze({id:index,center,points,bounds:Object.freeze({left,top,right,bottom,width:right-left,height:bottom-top}),gapWidth:3.4+index%3*1.4,offset:Object.freeze({x:Math.cos(direction)*distance,y:Math.sin(direction)*distance}),shear:Object.freeze({x:(random()-.5)*.024,y:(random()-.5)*.018})});
    }));clear();
  }
  function weight(x,y,mouse,padding=0){if(!mouse)return 0;const t=Math.max(0,Math.min(1,(Math.hypot(x-mouse.x,y-mouse.y)-SAFE_RADIUS-padding)/(FADE_RADIUS-SAFE_RADIUS)));return t*t*(3-2*t);}
  function owner(x,y){for(let i=regions.length-1;i>=0;i--){const r=regions[i],b=r.bounds;if(x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom&&inside(x,y,r.points))return r;}return null;}
  function displaced(x,y,r,mouse,padding=0){const mix=r?weight(x,y,mouse,padding):0;if(!r||mix===0)return{x,y,weight:0,region:null};return{x:x+(r.offset.x+r.shear.x*(y-r.center.y))*mix,y:y+(r.offset.y+r.shear.y*(x-r.center.x))*mix,weight:mix,region:r.id};}
  function point(x,y,mouse,padding=0){if(destroyed)return{x,y,weight:0,region:null};const r=owner(x,y),p=displaced(x,y,r,mouse,padding);if(p.weight>0)used.add(r.id);return p;}
  function beginFrame(now){clear();lastRenderTime=Number(now)||0;}
  function segment(a,b,mouse){
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)return[];
    segmentCount++;
    // A link touching the protected head retains its original sampling, too.
    // This keeps its full glow footprint exact, rather than introducing a
    // subtly different texture sample where a line crosses the safety circle.
    if(mouse){const t=Math.max(0,Math.min(1,((mouse.x-a.x)*dx+(mouse.y-a.y)*dy)/(length*length)));
      if(Math.hypot(a.x+dx*t-mouse.x,a.y+dy*t-mouse.y)<SAFE_RADIUS+9){fragmentCount++;return[{from:{x:a.x,y:a.y},to:{x:b.x,y:b.y},t0:0,t1:1,region:null,dispersion:0}];}}
    const cuts=[0,1];
    for(const region of regions){
      const box=region.bounds;if(Math.max(a.x,b.x)<box.left||Math.min(a.x,b.x)>box.right||Math.max(a.y,b.y)<box.top||Math.min(a.y,b.y)>box.bottom)continue;
      for(let i=0;i<region.points.length;i++){const p=region.points[i],q=region.points[(i+1)%region.points.length],ex=q.x-p.x,ey=q.y-p.y,den=cross(dx,dy,ex,ey);if(Math.abs(den)<1e-8)continue;const t=cross(p.x-a.x,p.y-a.y,ex,ey)/den,u=cross(p.x-a.x,p.y-a.y,dx,dy)/den;if(t>1e-6&&t<1-1e-6&&u>=0&&u<=1)cuts.push(t);}
    }
    // Sampling the 50–96px transition adds gentle bends without disturbing the
    // exact head. Circle intersections never introduce an artificial gap.
    if(mouse){const ox=a.x-mouse.x,oy=a.y-mouse.y,A=length*length,B=2*(ox*dx+oy*dy);for(const radius of[SAFE_RADIUS,(SAFE_RADIUS+FADE_RADIUS)/2,FADE_RADIUS]){const C=ox*ox+oy*oy-radius*radius,D=B*B-4*A*C;if(D>0){const s=Math.sqrt(D);for(const t of[(-B-s)/(2*A),(-B+s)/(2*A)])if(t>1e-6&&t<1-1e-6)cuts.push(t);}}}
    cuts.sort((x,y)=>x-y);const unique=cuts.filter((t,i)=>!i||t-cuts[i-1]>1e-5);
    const spans=[];
    for(let i=1;i<unique.length;i++){
      const start=unique[i-1],end=unique[i],mid=(start+end)/2,region=owner(a.x+dx*mid,a.y+dy*mid),last=spans.at(-1);
      // Unrefracted portions need no extra joints at the protection circles.
      if(last&&!region&&!last.region)last.end=end;else spans.push({start,end,region});
    }
    const fragments=[];
    for(let i=0;i<spans.length;i++){
      const s=spans[i];let t0=s.start,t1=s.end;
      for(const [edge,neighbor,sign]of[[t0,spans[i-1],1],[t1,spans[i+1],-1]]){
        if(!neighbor||neighbor.region===s.region)continue;
        const r=(s.region?.id??-1)>(neighbor.region?.id??-1)?s.region:neighbor.region;
        const gap=(r?.gapWidth||0)*weight(a.x+dx*edge,a.y+dy*edge,mouse)/(2*length);
        if(sign===1)t0+=gap;else t1-=gap;
        if(gap>0)gapCount++;
      }
      if(t1<=t0)continue;
      const from=displaced(a.x+dx*t0,a.y+dy*t0,s.region,mouse),to=displaced(a.x+dx*t1,a.y+dy*t1,s.region,mouse);
      if(s.region&&(from.weight>0||to.weight>0))used.add(s.region.id);
      fragments.push({from,to,t0,t1,region:s.region?.id??null,dispersion:Math.max(from.weight,to.weight)*.025});
    }
    fragmentCount+=fragments.length;return fragments;
  }
  function render(now){lastRenderTime=Number(now)||lastRenderTime;active=used.size>0;}
  function getMetadata(){return Object.freeze({supported:Boolean(context),active,destroyed,width,height,dprX,dprY,safeRadius:SAFE_RADIUS,fadeRadius:FADE_RADIUS,dispersionAlpha:.025,energyBudget:1,boundaryTreatment:'transparent-cut',gapMin:3.4,gapMax:6.2,overlapPolicy:'highest-index-wins',renderPath:'vector-fragments',frameCopies:0,totalFrameCopies:0,renderedRegions:used.size,lastRenderTime,segmentCount,fragmentCount,gapCount,regions,buffers:Object.freeze({fullFrame:0,local:0})});}
  function destroy(){clear();destroyed=true;regions=Object.freeze([]);}
  return Object.freeze({beginFrame,segment,point,render,resize,clear,destroy,getMetadata,get metadata(){return getMetadata();}});
}
