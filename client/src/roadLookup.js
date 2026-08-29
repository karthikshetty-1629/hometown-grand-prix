// Finds the nearest real road segment to a point — used both for the speed-limit check
// (which road is the car on right now) and off-road detection (how far off any road is it).
// Brute-force over all ~2,500 segments; already proven fine at 60fps this session (building
// collision does the same over 4,000+ buildings every frame with no measurable cost).

function closestPointOnSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  let t = lenSq > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, z: az + abz * t };
}

// Returns { segment, distance } for the nearest road segment, or null if roadSegments is empty.
export function findNearestRoadSegment(roadSegments, x, z) {
  let best = null;
  for (const segment of roadSegments) {
    const { x: cx, z: cz } = closestPointOnSegment(x, z, segment.a.x, segment.a.z, segment.b.x, segment.b.z);
    const distance = Math.hypot(x - cx, z - cz);
    if (!best || distance < best.distance) best = { segment, distance };
  }
  return best;
}
