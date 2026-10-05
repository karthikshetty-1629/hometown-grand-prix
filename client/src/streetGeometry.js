// One clearance model for roads, sidewalks, poles, trees, and pedestrians.
export function closestPoint(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;const t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l2)):0;return{x:a.x+dx*t,z:a.z+dz*t,t,distance:Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t)}}
export function insidePolygon(p,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside}return inside}
export class StreetSpace {
 constructor(chunk){this.roads=chunk.road_segments;this.buildings=chunk.buildings;this.cells=new Map();this.buildingCells=new Map();this.size=25;
  const add=(map,item,minX,maxX,minZ,maxZ)=>{for(let x=Math.floor(minX/this.size);x<=Math.floor(maxX/this.size);x++)for(let z=Math.floor(minZ/this.size);z<=Math.floor(maxZ/this.size);z++){const k=`${x},${z}`;if(!map.has(k))map.set(k,[]);map.get(k).push(item)}};
  for(const s of this.roads){const m=s.width_m/2+8;add(this.cells,s,Math.min(s.a.x,s.b.x)-m,Math.max(s.a.x,s.b.x)+m,Math.min(s.a.z,s.b.z)-m,Math.max(s.a.z,s.b.z)+m)}
  for(const b of this.buildings){const xs=b.footprint.map(p=>p.x),zs=b.footprint.map(p=>p.z);add(this.buildingCells,b,Math.min(...xs)-3,Math.max(...xs)+3,Math.min(...zs)-3,Math.max(...zs)+3)}
 }
 nearby(p,map=this.cells){return map.get(`${Math.floor(p.x/this.size)},${Math.floor(p.z/this.size)}`)||[]}
 onRoad(p,radius=0){return this.nearby(p).some(s=>closestPoint(p,s.a,s.b).distance<s.width_m/2+radius)}
 inBuilding(p,radius=0){return this.nearby(p,this.buildingCells).some(b=>insidePolygon(p,b.footprint)||radius>0&&b.footprint.some((a,i)=>closestPoint(p,a,b.footprint[(i+1)%b.footprint.length]).distance<radius))}
 clear(p,radius=.4){return !this.onRoad(p,radius)&&!this.inBuilding(p,radius)}
 nearest(p){let best;for(const s of this.nearby(p)){const hit=closestPoint(p,s.a,s.b);if(!best||hit.distance<best.distance)best={...hit,segment:s}}return best}
}
export function safeWalkways(chunk,space){const runs=[];for(const points of chunk.footpaths){let run=[];const flush=()=>{if(run.reduce((sum,p,i)=>sum+(i?Math.hypot(p.x-run[i-1].x,p.z-run[i-1].z):0),0)>=8)runs.push(run.filter((p,i)=>{if(i===0||i===run.length-1)return true;const a=run[i-1],b=run[i+1];return Math.abs((p.x-a.x)*(b.z-p.z)-(p.z-a.z)*(b.x-p.x))>.001}));run=[]};for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],len=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(len/1.5));for(let j=0;j<=n;j++){const p={x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n};if(space.clear(p,.9))run.push(p);else flush()}}flush()}return runs}
export function placeCurbFeature(feature,space){const near=space.nearest(feature);if(!near||near.distance>18)return null;const s=near.segment,dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz);if(len<.1)return null;const dir={x:dx/len,z:dz/len};
 for(const along of [0,-3,3,-6,6,-10,10])for(const side of [1,-1]){const p={x:near.x+dir.x*along+dir.z*side*(s.width_m/2+1.2),z:near.z+dir.z*along-dir.x*side*(s.width_m/2+1.2)};if(space.clear(p,.6))return{...p,dirX:dir.x*side,dirZ:dir.z*side,road:s,control:{x:near.x,z:near.z}}}return null}

export function directedLanes(segments){const edges=[];for(const s of segments){const directions=s.oneway?[s.travel||1]:[1,-1];for(const sign of directions){const a=sign===1?s.a:s.b,b=sign===1?s.b:s.a,len=Math.hypot(b.x-a.x,b.z-a.z);if(len<.2)continue;const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len,offset=s.oneway?Math.max(0,s.width_m/2-1.65):Math.min(s.width_m/4,2.3);edges.push({key:`${s.id}:${sign}`,from:sign===1?s.from:s.to,to:sign===1?s.to:s.from,a:{x:a.x+dz*offset,z:a.z-dx*offset},b:{x:b.x+dz*offset,z:b.z-dx*offset},dx,dz,len,segment:s})}}return edges}
