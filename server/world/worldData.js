// Cached OSM snapshot is downloaded by data-pipeline/fetch_city_details.py.
// Never query a public Overpass server on every game frame or launch.
const storage = require('../storage/localStorage');
const fs = require('node:fs/promises');
const path = require('node:path');
let cache;
const CAR_CLASSES = new Set(['trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','living_street','unclassified']);
async function loadWorldData() {
  if (cache) return cache;
  const [roadBytes, buildingBytes, pathBytes] = await Promise.all([
    storage.readFile('world','road_graph.json'), storage.readFile('world','buildings.json'), storage.readFile('world','footpaths.json'),
  ]);
  let snapshot;
  try { snapshot = JSON.parse(await fs.readFile(path.join(__dirname,'../../data-pipeline/map-cache/san-jose-details.json'),'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const nodesById = new Map(), adjacency = new Map(), physicalAdjacency = new Map();
  const add = (map, from, to, meta) => {
    const a=nodesById.get(from), b=nodesById.get(to);
    if (!map.has(from)) map.set(from,[]);
    if (!map.get(from).some(e=>e.to===to)) map.get(from).push({to,distance:haversineMeters(a.lat,a.lon,b.lat,b.lon),...meta});
  };
  const addLink = (from,to,meta,oneway=0) => {
    add(physicalAdjacency,from,to,{...meta,travel:oneway===-1?-1:1,oneway:oneway!==0});
    add(physicalAdjacency,to,from,{...meta,travel:oneway===-1?1:-1,oneway:oneway!==0});
    if(oneway!==-1)add(adjacency,from,to,meta);
    if(oneway!==1)add(adjacency,to,from,meta);
  };
  let footpaths=JSON.parse(pathBytes),features=[];
  if(snapshot){
    const inside=p=>p.lat>=37.3275&&p.lat<=37.357&&p.lon>=-121.897&&p.lon<=-121.8605;
    footpaths=[];
    for(const el of snapshot.elements){
      const t=el.tags||{};
      if(el.type==='node'){features.push(el);continue;}
      if(!el.geometry)continue;
      if(!CAR_CLASSES.has(t.highway)){
        if(t.footway!=='crossing'&&!t.crossing&&el.geometry.every(inside))footpaths.push({points:el.geometry});
        continue;
      }
      if(t.access==='private'||t.motor_vehicle==='no'||t.motorcar==='no'||t.area==='yes'||t.tunnel==='yes'||Number(t.layer)<0)continue;
      const oneway=t.oneway==='-1'?-1:['yes','1','true'].includes(t.oneway)||t.junction==='roundabout'?1:0;
      for(let i=0;i<el.nodes.length-1;i++){
        const a=el.geometry[i],b=el.geometry[i+1];if(!inside(a)||!inside(b))continue;
        const from=String(el.nodes[i]),to=String(el.nodes[i+1]);
        nodesById.set(from,{id:from,...a});nodesById.set(to,{id:to,...b});
        addLink(from,to,{osm_id:el.id,highway:t.highway,name:t.name,lanes:t.lanes,width:t.width,maxspeed:t.maxspeed,tags:t},oneway);
      }
    }
  }else{
    const graph=JSON.parse(roadBytes);
    for(const n of graph.nodes)nodesById.set(n.id,n);
    for(const link of graph.links)addLink(link.source,link.target,link);
  }
  cache={nodesById,adjacency,physicalAdjacency,buildings:JSON.parse(buildingBytes),footpaths,features,
    provenance:{source:snapshot?.source||'Local OSM extract',downloaded_at:snapshot?.downloaded_at||null,details_available:!!snapshot}};
  return cache;
}
function haversineMeters(lat1,lon1,lat2,lon2){const r=Math.PI/180;const a=Math.sin((lat2-lat1)*r/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lon2-lon1)*r/2)**2;return 6371000*2*Math.asin(Math.sqrt(a));}
module.exports={loadWorldData,haversineMeters};
