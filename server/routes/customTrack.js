// POST /api/routes — turns a player-picked start/end point into a race: validates a real
// route exists between them on the actual street graph (so "start" and "finish" are always
// reachable), then saves just the start position/heading and the finish point. The player
// drives the whole real road network (from GET /api/world/full) to get there by whatever
// street they choose — there is no server-computed corridor to follow. A straight Dijkstra
// distance is still computed, purely as a reference length for the "too close together"
// sanity check and the length shown to the player.

const express = require('express');
const storage = require('../storage/localStorage');
const { loadWorldData, haversineMeters } = require('../world/worldData');
const { getFullMapPayload } = require('../world/fullMapBuilder');
const { latlonToLocalMeters, roadWidthAndLanes, round2 } = require('../world/geo');
const { refreshLiveTrafficInBackground } = require('../liveTraffic');

const router = express.Router();

const MIN_ROUTE_LENGTH_M = 30;

router.post('/', async (req, res) => {
  const { startNodeId, endNodeId } = req.body;
  if (!startNodeId || !endNodeId) {
    return res.status(400).json({ error: 'startNodeId and endNodeId are required' });
  }
  if (startNodeId === endNodeId) {
    return res.status(400).json({ error: 'start and end must be different points' });
  }

  const { nodesById, adjacency, physicalAdjacency } = await loadWorldData();
  if (!nodesById.has(startNodeId) || !nodesById.has(endNodeId)) {
    return res.status(400).json({ error: 'unknown node id' });
  }

  const pathIds = shortestPath(adjacency, startNodeId, endNodeId);
  if (!pathIds) {
    return res.status(400).json({ error: 'no route exists on the road network between those two points' });
  }

  const lengthM = pathLengthMeters(nodesById, pathIds);
  if (lengthM < MIN_ROUTE_LENGTH_M) {
    return res.status(400).json({ error: 'that route is too short — pick points further apart' });
  }

  const { origin } = await getFullMapPayload();

  const startNode = nodesById.get(startNodeId);
  const endNode = nodesById.get(endNodeId);
  const secondNode = nodesById.get(pathIds[1]);
  const secondLastNode = nodesById.get(pathIds[pathIds.length - 2]);

  const [sx, sz] = latlonToLocalMeters(startNode.lat, startNode.lon, origin.lat, origin.lon);
  const [s2x, s2z] = latlonToLocalMeters(secondNode.lat, secondNode.lon, origin.lat, origin.lon);
  const [fx, fz] = latlonToLocalMeters(endNode.lat, endNode.lon, origin.lat, origin.lon);
  const [f2x, f2z] = latlonToLocalMeters(secondLastNode.lat, secondLastNode.lon, origin.lat, origin.lon);

  const startDir = normalize(s2x - sx, s2z - sz);
  const finishDir = normalize(fx - f2x, fz - f2z);

  const startEdge = (adjacency.get(startNodeId) || []).find((n) => n.to === pathIds[1]);
  const finishEdge = (physicalAdjacency.get(endNodeId) || []).find((n) => n.to === pathIds[pathIds.length - 2]);
  const startWidth = roadWidthAndLanes(startEdge?.highway, startEdge?.lanes).width;
  const finishWidth = roadWidthAndLanes(finishEdge?.highway, finishEdge?.lanes).width;

  const chunkId = `custom_${Date.now()}`;
  const chunk = {
    chunk_id: chunkId,
    origin,
    start: { x: round2(sx + startDir.z * Math.min(startWidth / 4, 2.3)), z: round2(sz - startDir.x * Math.min(startWidth / 4, 2.3)), dirX: startDir.x, dirZ: startDir.z, width_m: round2(startWidth) },
    checkpoints: [
      { x: round2(fx), z: round2(fz), index: 0, dirX: finishDir.x, dirZ: finishDir.z, width_m: round2(finishWidth) },
    ],
    reference_length_m: Math.round(lengthM),
    navigation_path: pathIds.map((id, i) => {
      const n = nodesById.get(id);
      const [x,z] = latlonToLocalMeters(n.lat,n.lon,origin.lat,origin.lon);
      const edge = (adjacency.get(id)||[]).find(e=>e.to===pathIds[i+1]);
      return {x:round2(x),z:round2(z),name:edge?.name||''};
    }),
  };

  await storage.saveFile('chunks', `${chunkId}.json`, JSON.stringify(chunk));

  // Fire-and-forget: a live scrape can take anywhere from a few seconds to a minute, and
  // starting a race should never stall on it. This race gets whatever traffic data is
  // already cached; the refresh kicked off here is for the drive that's about to happen and
  // the next one after it.
  refreshLiveTrafficInBackground();

  res.status(201).json({ chunk_id: chunkId, length_m: Math.round(lengthM) });
});

// Simple Dijkstra: fine for a one-off click, ~2k nodes runs well under a second without
// needing a priority-queue dependency.
function shortestPath(adjacency, startId, endId) {
  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const visited = new Set();

  for (;;) {
    let currentId = null;
    let currentDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        currentDist = d;
        currentId = id;
      }
    }
    if (currentId === null) return null; // exhausted every reachable node
    if (currentId === endId) break;
    visited.add(currentId);

    for (const { to, distance } of adjacency.get(currentId) || []) {
      if (visited.has(to)) continue;
      const newDist = currentDist + distance;
      if (newDist < (dist.get(to) ?? Infinity)) {
        dist.set(to, newDist);
        prev.set(to, currentId);
      }
    }
  }

  const path = [endId];
  let cur = endId;
  while (cur !== startId) {
    cur = prev.get(cur);
    if (cur === undefined) return null;
    path.push(cur);
  }
  return path.reverse();
}

function pathLengthMeters(nodesById, pathIds) {
  let total = 0;
  for (let i = 0; i < pathIds.length - 1; i++) {
    const a = nodesById.get(pathIds[i]);
    const b = nodesById.get(pathIds[i + 1]);
    total += haversineMeters(a.lat, a.lon, b.lat, b.lon);
  }
  return total;
}

function normalize(dx, dz) {
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

module.exports = router;
