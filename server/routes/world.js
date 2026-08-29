const express = require('express');
const { loadWorldData } = require('../world/worldData');
const { getFullMapPayload } = require('../world/fullMapBuilder');

const router = express.Router();

// GET /api/world/full -> the entire downloaded area as one drivable world: every real road
// segment, every real intersection (for signal/sign placement), every building, every
// footpath. Cached after the first request — see fullMapBuilder.js.
router.get('/full', async (req, res) => {
  const payload = await getFullMapPayload();
  res.json(payload);
});

// GET /api/world/roadnetwork -> the whole area's road network, for the client to draw
// as a schematic map and let the player click a start/end point on real streets.
router.get('/roadnetwork', async (req, res) => {
  const { nodesById, adjacency } = await loadWorldData();

  const nodes = Array.from(nodesById.values()).map((n) => ({ id: n.id, lat: n.lat, lon: n.lon }));

  const seen = new Set();
  const edges = [];
  for (const [from, neighbors] of adjacency) {
    for (const { to } of neighbors) {
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([from, to]);
    }
  }

  res.json({ nodes, edges });
});

module.exports = router;
