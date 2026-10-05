const {loadWorldData}=require('./worldData');
const {latlonToLocalMeters,roadWidthAndLanes,estimateSpeedLimitKmh,projectBuilding,projectFootpath,round2}=require('./geo');
let cachedPayload;
function speedValue(value){const n=parseFloat(value);if(!Number.isFinite(n)||n<=0)return null;return Math.round(n*(String(value).includes('mph')?1.609344:1));}
async function getFullMapPayload(){
 if(cachedPayload)return cachedPayload;
 const data=await loadWorldData();const {nodesById,physicalAdjacency:adjacency,buildings,footpaths}=data;
 const nodes=[...nodesById.values()];const origin={lat:nodes.reduce((s,n)=>s+n.lat,0)/nodes.length,lon:nodes.reduce((s,n)=>s+n.lon,0)/nodes.length};
 const project=p=>{const[x,z]=latlonToLocalMeters(p.lat,p.lon,origin.lat,origin.lon);return{x:round2(x),z:round2(z)}};
 const roadSegments=[],seen=new Set();
 for(const[from,edges]of adjacency)for(const e of edges){const key=[from,e.to].sort().join('|');if(seen.has(key))continue;seen.add(key);
  const a=nodesById.get(from),b=nodesById.get(e.to),spec=roadWidthAndLanes(e.highway,e.lanes);
  const explicitWidth=parseFloat(e.width);const width=Number.isFinite(explicitWidth)&&explicitWidth>=3&&explicitWidth<=35?explicitWidth:spec.width;
  const speed=speedValue(e.maxspeed);
  roadSegments.push({id:roadSegments.length,osm_id:e.osm_id,from,to:e.to,a:project(a),b:project(b),name:e.name||null,highway:e.highway,width_m:width,lanes:spec.lanes,draw_markings:spec.drawMarkings,
    oneway:e.oneway,travel:e.travel,speed_limit_kmh:speed||estimateSpeedLimitKmh(e.highway),speed_source:speed?'osm':'estimated',width_source:Number.isFinite(explicitWidth)?'osm':'estimated',mid_lat:(a.lat+b.lat)/2,mid_lon:(a.lon+b.lon)/2});
 }
 const intersections=[];
 for(const[id,edges]of adjacency){if(edges.length<3)continue;const node=nodesById.get(id);const widest=edges.reduce((w,e)=>Math.max(w,roadWidthAndLanes(e.highway,e.lanes).width),0);intersections.push({...project(node),id,width_m:widest});}
 const features=data.features.map(f=>({id:f.id,...project(f),kind:f.tags.highway||f.tags.natural,tags:f.tags}));
 // Preserve the real footprint, but reject disconnected rings from the older building extract.
 const projectedBuildings=buildings.map(b=>({...projectBuilding(b,origin),osm_id:b.osm_id})).filter(b=>{
   const xs=b.footprint.map(p=>p.x),zs=b.footprint.map(p=>p.z);return Math.max(...xs)-Math.min(...xs)<100&&Math.max(...zs)-Math.min(...zs)<100;
 });
 const projectedPaths=footpaths.map(f=>projectFootpath(f,origin)).filter(p=>p.length>1&&p.every((n,i)=>!i||Math.hypot(n.x-p[i-1].x,n.z-p[i-1].z)<70));
 cachedPayload={origin,road_segments:roadSegments,intersections,buildings:projectedBuildings,footpaths:projectedPaths,map_features:features,provenance:data.provenance};
 return cachedPayload;
}
module.exports={getFullMapPayload};
