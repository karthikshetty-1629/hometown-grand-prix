// The drivable surface is the union of all road capsules, including junctions.
export function fitsRoad(space,p,radius=1.05){
 if(!space.onRoad(p))return false;
 for(let i=0;i<16;i++){const a=i*Math.PI/8;if(!space.onRoad({x:p.x+Math.cos(a)*radius,z:p.z+Math.sin(a)*radius}))return false}
 return true;
}
export function constrainToRoad(space,start,end,radius=1.05,heading=null){
 const fits=p=>fitsRoad(space,p,radius)&&(heading===null||[-1.15,1.15].every(d=>fitsRoad(space,{x:p.x+Math.sin(heading)*d,z:p.z+Math.cos(heading)*d},radius)));
 let p={x:start.x,z:start.z},hit=false;
 const dx=end.x-start.x,dz=end.z-start.z,n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.3));
 for(let i=0;i<n;i++){
  const next={x:p.x+dx/n,z:p.z+dz/n};
  if(fits(next)){p=next;continue}
  hit=true;
  // Project remaining movement along the nearest curb, preserving a smooth scrape.
  const road=space.nearest(p)?.segment;if(!road)break;
  const len=Math.hypot(road.b.x-road.a.x,road.b.z-road.a.z),ux=(road.b.x-road.a.x)/len,uz=(road.b.z-road.a.z)/len;
  const along=(dx*ux+dz*uz)/n,slide={x:p.x+ux*along,z:p.z+uz*along};
  if(fits(slide))p=slide;
 }
 return{...p,hit};
}
// Short exposed boundary pieces, with junction mouths cut out by the same union test.
export function curbSegments(space){
 const result=[];
 for(const s of space.roads){
  const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz);if(len<.1)continue;
  const ux=dx/len,uz=dz/len,n=Math.ceil(len/1.5);
  for(const side of [-1,1])for(let i=0;i<n;i++){
   const point=t=>({x:s.a.x+ux*t+uz*side*s.width_m/2,z:s.a.z+uz*t-ux*side*s.width_m/2});
   const a=point(len*i/n),b=point(len*(i+1)/n),m=point(len*(i+.5)/n);
   if(!space.onRoad({x:m.x+uz*side*.16,z:m.z-ux*side*.16}))result.push({a,b});
  }
  for(const center of [s.a,s.b])for(let i=0;i<24;i++){
   const angle=(i+.5)*Math.PI/12,r=s.width_m/2;
   if(space.onRoad({x:center.x+Math.cos(angle)*(r+.16),z:center.z+Math.sin(angle)*(r+.16)}))continue;
   const p=t=>({x:center.x+Math.cos(t)*r,z:center.z+Math.sin(t)*r});
   result.push({a:p(i*Math.PI/12),b:p((i+1)*Math.PI/12)});
  }
 }
 return result;
}
