// Loads the whole-area road graph + buildings + footpaths (published by
// data-pipeline/08_copy_world_data.py) once, and keeps them in memory. Used by both the
// /api/world (map data for the route picker) and /api/routes (route generation) endpoints.

const storage = require('../storage/localStorage');

let cache = null;

async function loadWorldData() {
  if (cache) return cache;

  const roadGraphBuffer = await storage.readFile('world', 'road_graph.json');
  const buildingsBuffer = await storage.readFile('world', 'buildings.json');
  const footpathsBuffer = await storage.readFile('world', 'footpaths.json');

  const roadGraph = JSON.parse(roadGraphBuffer.toString());
  const buildings = JSON.parse(buildingsBuffer.toString());
  const footpaths = JSON.parse(footpathsBuffer.toString());

  const nodesById = new Map(roadGraph.nodes.map((n) => [n.id, n]));
  const adjacency = new Map();

  for (const link of roadGraph.links) {
    const a = nodesById.get(link.source);
    const b = nodesById.get(link.target);
    if (!a || !b) continue;
    const distance = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    addEdge(adjacency, link.source, link.target, distance, link.highway, link.name, link.lanes);
    addEdge(adjacency, link.target, link.source, distance, link.highway, link.name, link.lanes);
  }

  cache = { nodesById, adjacency, buildings, footpaths };
  return cache;
}

function addEdge(adjacency, from, to, distance, highway, name, lanes) {
  if (!adjacency.has(from)) adjacency.set(from, []);
  adjacency.get(from).push({ to, distance, highway, name, lanes });
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

module.exports = { loadWorldData, haversineMeters };
