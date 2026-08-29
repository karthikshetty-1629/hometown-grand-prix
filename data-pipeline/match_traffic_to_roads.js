// Takes raw traffic/incident records and matches each to real road segments in the game's
// own road network, producing the file the game actually reads
// (server/storage-data/live/traffic.json). Exports matchIncidentsToRoads() as a reusable,
// pure function — server/liveTraffic.js calls it directly for the automatic race-start
// refresh; this file's own main() is a thin CLI wrapper for manual/offline runs.
//
// Matching prefers the real OSM street name (03_build_road_graph.py now extracts it — a
// genuine osm2pgsql column, not a hstore tag) over raw lat/lon: scraped sources report a
// street name ("Market St"), not coordinates, and matching on the actual street name is
// exact where a distance radius is just a guess at how close is "close enough". Three tiers,
// tried in order:
//   1. street_name + lat/lon given: every segment of that named street within
//      NAME_MATCH_RADIUS_M of the point (a real block can be several short OSM way-segments).
//   2. street_name given, no lat/lon (the fully-automated Scraper Studio path has no
//      coordinates at all): every segment of that named street, anywhere on the map. Coarser
//      — flags the whole street, not just the affected block — but still exactly the real
//      street, not a guess, and needs no manual geocoding step to stay fully automatic.
//   3. no usable street_name match: nearest single segment within COORD_MATCH_RADIUS_M of
//      the given point (only possible if lat/lon was given).
//
// Usage: node match_traffic_to_roads.js <raw-incidents.json> [apiBaseUrl]
// raw-incidents.json shape:
//   [{ lat?, lon?, street_name?, description, severity: "low"|"medium"|"high" }]

const fs = require('fs');
const path = require('path');

const COORD_MATCH_RADIUS_M = 400;
const NAME_MATCH_RADIUS_M = 300;
const SEVERITY_LEVEL = { low: 0.35, medium: 0.65, high: 1.0 };

function matchIncidentsToRoads(incidents, roadSegments) {
  const segmentsByNormalizedName = new Map();
  for (const segment of roadSegments) {
    const normalized = normalizeStreetName(segment.name);
    if (!normalized) continue;
    if (!segmentsByNormalizedName.has(normalized)) segmentsByNormalizedName.set(normalized, []);
    segmentsByNormalizedName.get(normalized).push(segment);
  }

  const bestLevelBySegmentId = new Map();
  let matchedIncidents = 0;
  let matchedByName = 0;
  let matchedByNameWholeStreet = 0;

  for (const incident of incidents) {
    const level = SEVERITY_LEVEL[incident.severity] ?? 0.5;
    const normalizedName = normalizeStreetName(incident.street_name);
    const namedCandidates = normalizedName ? segmentsByNormalizedName.get(normalizedName) : null;
    const hasCoords = typeof incident.lat === 'number' && typeof incident.lon === 'number';

    let matchedAny = false;

    if (namedCandidates && namedCandidates.length > 0) {
      if (hasCoords) {
        for (const segment of namedCandidates) {
          const distance = haversineMeters(incident.lat, incident.lon, segment.mid_lat, segment.mid_lon);
          if (distance > NAME_MATCH_RADIUS_M) continue;
          matchedAny = true;
          applyLevel(bestLevelBySegmentId, segment.id, level);
        }
        if (matchedAny) matchedByName += 1;
      }

      if (!matchedAny) {
        // No coordinates to narrow it down (the automated path) — flag the whole named
        // street rather than skip the incident entirely.
        for (const segment of namedCandidates) {
          applyLevel(bestLevelBySegmentId, segment.id, level);
        }
        matchedAny = true;
        matchedByNameWholeStreet += 1;
      }
    }

    if (!matchedAny && hasCoords) {
      let best = null;
      for (const segment of roadSegments) {
        const distance = haversineMeters(incident.lat, incident.lon, segment.mid_lat, segment.mid_lon);
        if (distance <= COORD_MATCH_RADIUS_M && (!best || distance < best.distance)) {
          best = { segment, distance };
        }
      }
      if (best) {
        matchedAny = true;
        applyLevel(bestLevelBySegmentId, best.segment.id, level);
      }
    }

    if (matchedAny) matchedIncidents += 1;
  }

  return {
    fetched_at: new Date().toISOString(),
    source: 'bright_data',
    name_match_radius_m: NAME_MATCH_RADIUS_M,
    coord_match_radius_m: COORD_MATCH_RADIUS_M,
    raw_incident_count: incidents.length,
    matched_incident_count: matchedIncidents,
    matched_by_street_name: matchedByName,
    matched_by_street_name_whole_street: matchedByNameWholeStreet,
    matched_segment_count: bestLevelBySegmentId.size,
    segments: Array.from(bestLevelBySegmentId, ([id, level]) => ({ id, level })),
  };
}

function applyLevel(map, segmentId, level) {
  const existing = map.get(segmentId);
  if (existing === undefined || level > existing) map.set(segmentId, level);
}

// Normalizes away direction prefixes and street-type suffixes so "Market Street", "Market
// St", "N Market St", and "North Market Street" all compare equal. "St." is ambiguous in US
// street names — trailing it means "Street" (a suffix to strip), but mid-name it means
// "Saint" (part of the name itself, e.g. "St. James Street") — handled by expanding any
// non-trailing "st"/"st." to "saint" before stripping the trailing suffix.
function normalizeStreetName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  n = n.replace(/\bst\.?\s+/g, 'saint ');
  n = n.replace(/^(north|south|east|west|n|s|e|w)\.?\s+/, '');
  n = n.replace(
    /\s+(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|way|lane|ln|parkway|pkwy|court|ct|place|pl)\.?$/,
    ''
  );
  return n.trim();
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function main() {
  const incidentsPath = process.argv[2];
  const apiBaseUrl = process.argv[3] || 'http://localhost:3001';
  if (!incidentsPath) {
    console.error('Usage: node match_traffic_to_roads.js <raw-incidents.json> [apiBaseUrl]');
    process.exit(1);
  }

  const incidents = JSON.parse(fs.readFileSync(incidentsPath, 'utf8'));

  const worldResponse = await fetch(`${apiBaseUrl}/api/world/full`);
  if (!worldResponse.ok) {
    console.error(`Could not reach ${apiBaseUrl}/api/world/full — is the server running?`);
    process.exit(1);
  }
  const { road_segments: roadSegments } = await worldResponse.json();

  const output = matchIncidentsToRoads(incidents, roadSegments);

  const outPath = path.join(__dirname, '..', 'server', 'storage-data', 'live', 'traffic.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(
    `Matched ${output.matched_incident_count}/${incidents.length} incidents ` +
      `(${output.matched_by_street_name} by name+radius, ${output.matched_by_street_name_whole_street} by name only) ` +
      `to ${output.matched_segment_count} real road segments.`
  );
  console.log(`Wrote ${outPath}`);
}

module.exports = { matchIncidentsToRoads, normalizeStreetName };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
