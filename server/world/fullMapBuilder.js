// Builds the ENTIRE downloaded road network as one drivable world — every real road edge,
// every building, every footpath — instead of the old ~40m corridor around one computed
// path. A player who actually knows these streets can take any real route between two
// points, not just the one the server happened to compute.
//
// Also tags every node with 3+ connecting roads as a real intersection (not a heuristic
// "detected a turn" guess), so traffic signals/stop signs land where real intersections are.
//
// Computed once and cached — converting ~2,500 edges / ~4,200 buildings / ~2,400 footpaths
// from lat/lon to local meters is real CPU work not worth repeating per request.

const { loadWorldData } = require('./worldData');
const {
  latlonToLocalMeters,
  roadWidthAndLanes,
  estimateSpeedLimitKmh,
  projectBuilding,
  projectFootpath,
  round2,
} = require('./geo');

// Real bug, found by loading the whole map instead of a ~20-building route corridor: some
// building/footpath records in the extracted data jump 100-300m between what should be
// adjacent points — the pipeline's extraction is concatenating separate, disconnected real
// features into one record (root cause is in data-pipeline/04_extract_buildings.py and
// 05_extract_footpaths.py, not fixed here). A route corridor rarely included one of these by
// chance; loading everything hits many. Filtered defensively here rather than silently
// rendering a building body or footpath ribbon that stretches across town.
const MAX_BUILDING_SPAN_M = 80;
const MAX_FOOTPATH_JUMP_M = 60;

let cachedPayload = null;

async function getFullMapPayload() {
  if (cachedPayload) return cachedPayload;

  const { nodesById, adjacency, buildings, footpaths } = await loadWorldData();
  const origin = centroidOf(nodesById);

  const roadSegments = [];
  const seen = new Set();
  for (const [fromId, neighbors] of adjacency) {
    for (const { to: toId, highway, name, lanes } of neighbors) {
      const key = fromId < toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const a = nodesById.get(fromId);
      const b = nodesById.get(toId);
      if (!a || !b) continue;

      const [ax, az] = latlonToLocalMeters(a.lat, a.lon, origin.lat, origin.lon);
      const [bx, bz] = latlonToLocalMeters(b.lat, b.lon, origin.lat, origin.lon);
      const spec = roadWidthAndLanes(highway, lanes);

      // id + real midpoint lat/lon let a separate live-data file (e.g. scraped traffic
      // congestion) reference a segment without resending its geometry, and let a
      // server-side matching step compare a real-world incident's coordinates against ours.
      roadSegments.push({
        id: roadSegments.length,
        name: name || null, // real OSM street name when tagged — lets live scraped data
        // (which names streets, not coordinates) match the exact real street directly
        a: { x: round2(ax), z: round2(az) },
        b: { x: round2(bx), z: round2(bz) },
        mid_lat: round6((a.lat + b.lat) / 2),
        mid_lon: round6((a.lon + b.lon) / 2),
        width_m: round2(spec.width),
        lanes: spec.lanes,
        draw_markings: spec.drawMarkings,
        speed_limit_kmh: estimateSpeedLimitKmh(highway),
      });
    }
  }

  const intersections = [];
  for (const [nodeId, neighbors] of adjacency) {
    if (neighbors.length < 3) continue; // 1 = dead end, 2 = just a shape point, not a junction

    const node = nodesById.get(nodeId);
    const [x, z] = latlonToLocalMeters(node.lat, node.lon, origin.lat, origin.lon);

    // Real-world convention: signal control matches the busiest connecting road, not the
    // narrowest — a residential street meeting an arterial gets a light, not a stop sign.
    let widest = null;
    for (const n of neighbors) {
      const spec = roadWidthAndLanes(n.highway, n.lanes);
      if (!widest || spec.width > widest.width) widest = spec;
    }

    // Orientation for the prop mesh (which way to face) — any connecting edge's direction
    // works for this, it's purely cosmetic (which way the sign/light faces).
    const other = nodesById.get(neighbors[0].to);
    const [ox, oz] = latlonToLocalMeters(other.lat, other.lon, origin.lat, origin.lon);
    const dirLen = Math.hypot(ox - x, oz - z) || 1;

    intersections.push({
      x: round2(x),
      z: round2(z),
      lanes: widest.lanes,
      width_m: round2(widest.width),
      dirX: (ox - x) / dirLen,
      dirZ: (oz - z) / dirLen,
    });
  }

  const projectedBuildings = buildings.map((b) => projectBuilding(b, origin)).filter((b) => footprintSpan(b.footprint) <= MAX_BUILDING_SPAN_M);
  const projectedFootpaths = footpaths
    .map((f) => projectFootpath(f, origin))
    .flatMap((points) => splitAtLargeJumps(points, MAX_FOOTPATH_JUMP_M));

  cachedPayload = {
    origin,
    road_segments: roadSegments,
    intersections,
    buildings: projectedBuildings,
    footpaths: projectedFootpaths,
  };
  return cachedPayload;
}

function footprintSpan(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return Math.max(maxX - minX, maxZ - minZ);
}

// Splits a footpath polyline into separate runs at any point-to-point jump larger than a
// real sidewalk segment should be, instead of drawing a ribbon connecting two features that
// were never actually adjacent.
function splitAtLargeJumps(points, maxJumpM) {
  const runs = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const dist = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (dist > maxJumpM) {
      if (current.length >= 2) runs.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function centroidOf(nodesById) {
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;
  for (const node of nodesById.values()) {
    sumLat += node.lat;
    sumLon += node.lon;
    count += 1;
  }
  return { lat: sumLat / count, lon: sumLon / count };
}

module.exports = { getFullMapPayload };
