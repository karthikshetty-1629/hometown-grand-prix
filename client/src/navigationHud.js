// Live "billboard" HUD: which real street the car is on right now, and what's coming up at
// the next real intersection ahead — which street crosses there, and whether it's roughly a
// left, right, or straight-through continuation relative to the car's current heading. Pure
// client-side, built entirely from data we already have (real OSM street names on
// road_segments, real intersection points) — no new server or Bright Data dependency.

// Real intersections in this dataset are genuinely sparse (245 across the whole map, many
// residential blocks run 300-500m+ between real junctions) — verified directly against the
// actual data, not a guess. 90m looked like a bug (nothing ever showed) until checking real
// distances; matches how far ahead a real GPS nav app starts showing the next turn.
const LOOKAHEAD_M = 300;
const INTERSECTION_TOUCH_RADIUS_M = 4; // how close a segment endpoint must be to "belong" to an intersection
const STRAIGHT_ANGLE_DEG = 25; // within this many degrees of straight-ahead counts as "straight"

// Rebuilding the intersection -> touching-segments lookup every frame would mean scanning
// ~2,500 segments per frame; it only needs rebuilding once per chunk load; then finding the
// nearest ahead is a cheap ~245-item scan.
export function buildNavigationIndex(chunk) {
  const segmentsByIntersection = new Map(); // intersection index -> [{ segment, dirX, dirZ }]

  (chunk.intersections || []).forEach((intersection, index) => {
    const touching = [];
    for (const segment of chunk.road_segments || []) {
      const distA = Math.hypot(segment.a.x - intersection.x, segment.a.z - intersection.z);
      const distB = Math.hypot(segment.b.x - intersection.x, segment.b.z - intersection.z);
      if (distA <= INTERSECTION_TOUCH_RADIUS_M) {
        touching.push(outwardDirection(segment, segment.b, intersection));
      } else if (distB <= INTERSECTION_TOUCH_RADIUS_M) {
        touching.push(outwardDirection(segment, segment.a, intersection));
      }
    }
    segmentsByIntersection.set(index, touching);
  });

  return { intersections: chunk.intersections || [], segmentsByIntersection };
}

function outwardDirection(segment, farPoint, intersection) {
  const dx = farPoint.x - intersection.x;
  const dz = farPoint.z - intersection.z;
  const len = Math.hypot(dx, dz) || 1;
  return { name: segment.name, dirX: dx / len, dirZ: dz / len };
}

// Returns { currentStreet, ahead: [{ name, turn }] | null }
export function findNavigationInfo(navIndex, carX, carZ, heading) {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);

  let nearestAhead = null;
  navIndex.intersections.forEach((intersection, index) => {
    const dx = intersection.x - carX;
    const dz = intersection.z - carZ;
    const distance = Math.hypot(dx, dz);
    if (distance > LOOKAHEAD_M || distance < 1) return;

    const dot = (dx / distance) * forwardX + (dz / distance) * forwardZ;
    if (dot < 0.5) return; // behind or too far off to the side — not "ahead"

    if (!nearestAhead || distance < nearestAhead.distance) {
      nearestAhead = { index, distance, intersection };
    }
  });

  if (!nearestAhead) return { ahead: null };

  const touching = navIndex.segmentsByIntersection.get(nearestAhead.index) || [];
  const options = [];
  const seenNames = new Set();

  for (const { name, dirX, dirZ } of touching) {
    if (!name) continue;
    // The direction back toward the car (roughly opposite of travel) is "where we came
    // from" — not a real turn option.
    const backDot = dirX * forwardX + dirZ * forwardZ;
    if (backDot < -0.7) continue;

    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const angleDeg = (Math.acos(clamp(backDot, -1, 1)) * 180) / Math.PI;
    const cross = forwardX * dirZ - forwardZ * dirX;
    let turn;
    if (angleDeg <= STRAIGHT_ANGLE_DEG) turn = 'straight';
    else turn = cross > 0 ? 'left' : 'right';

    options.push({ name, turn });
  }

  return { ahead: options.length > 0 ? { distance: Math.round(nearestAhead.distance), options } : null };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
