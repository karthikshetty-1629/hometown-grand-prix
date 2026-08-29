// Shared lat/lon <-> local-meters conversion and real-road-width/lane logic. Pulled out of
// customTrack.js so the new full-map builder (fullMapBuilder.js) can use the exact same
// rules instead of drifting from a second copy. Mirrors data-pipeline/07_export_chunk.py —
// keep all three in sync if you change the width/lane rules.

const LANE_WIDTH_M = 3.25;
const MIN_ROAD_WIDTH_M = 5.0;
const DEFAULT_LANES_BY_CLASS = {
  trunk: 4,
  trunk_link: 2,
  primary: 4,
  primary_link: 2,
  secondary: 2,
  secondary_link: 2,
  tertiary: 2,
  tertiary_link: 2,
  residential: 2,
  living_street: 2,
  unclassified: 2,
};
const NO_MARKING_CLASSES = new Set(['residential', 'living_street', 'unclassified']);

// No OSM maxspeed data is extracted by the pipeline (03_build_road_graph.py only pulls
// highway class + lanes) — this is a road-class heuristic, not a real posted limit. Real
// `maxspeed` tags are very likely already sitting in the imported PostGIS hstore column
// (osm2pgsql was run with --hstore, which captures every tag) and could replace this with a
// small pipeline change; flagged as a known gap, not fixed here.
const DEFAULT_SPEED_KMH_BY_CLASS = {
  trunk: 80,
  trunk_link: 50,
  primary: 65,
  primary_link: 40,
  secondary: 55,
  secondary_link: 35,
  tertiary: 50,
  tertiary_link: 35,
  residential: 40,
  living_street: 20,
  unclassified: 40,
};

function estimateSpeedLimitKmh(highway) {
  return DEFAULT_SPEED_KMH_BY_CLASS[highway] ?? 40;
}

function roadWidthAndLanes(highway, lanesRaw) {
  let lanes = null;
  if (lanesRaw) {
    const parsed = parseInt(lanesRaw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) lanes = parsed;
  }
  if (!lanes) lanes = DEFAULT_LANES_BY_CLASS[highway] ?? 2;

  const width = Math.max(lanes * LANE_WIDTH_M, MIN_ROAD_WIDTH_M);
  const drawMarkings = lanes >= 2 && !NO_MARKING_CLASSES.has(highway);
  return { width, lanes, drawMarkings };
}

function latlonToLocalMeters(lat, lon, originLat, originLon) {
  const R = 6371000;
  const dx = (((lon - originLon) * Math.PI) / 180) * R * Math.cos((originLat * Math.PI) / 180);
  const dz = ((lat - originLat) * Math.PI) / 180 * R;
  return [dx, dz];
}

function projectBuilding(building, origin) {
  const footprint = building.footprint.map((p) => {
    const [x, z] = latlonToLocalMeters(p.lat, p.lon, origin.lat, origin.lon);
    return { x: round2(x), z: round2(z) };
  });
  return {
    footprint,
    height_m: building.height_m,
    category: building.category || 'generic',
  };
}

function projectFootpath(footpath, origin) {
  return footpath.points.map((p) => {
    const [x, z] = latlonToLocalMeters(p.lat, p.lon, origin.lat, origin.lon);
    return { x: round2(x), z: round2(z) };
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  LANE_WIDTH_M,
  MIN_ROAD_WIDTH_M,
  roadWidthAndLanes,
  estimateSpeedLimitKmh,
  latlonToLocalMeters,
  projectBuilding,
  projectFootpath,
  round2,
};
