// 2D (x,z) collision for the car against building footprints — the whole real road network
// is drivable now, so buildings are what box the car into the street grid, not a fixed-width
// corridor around one computed path. Resolved as a position correction — find how far the
// car has crossed a boundary and push it back out along the correct direction — which is
// what gives the "slide along the wall" feel rather than a hard stop.


export function buildBuildingColliders(buildings) {
  return buildings.map((b) => ({ points: b.footprint, centroid: centroidOf(b.footprint), minX: Math.min(...b.footprint.map(p => p.x)), maxX: Math.max(...b.footprint.map(p => p.x)), minZ: Math.min(...b.footprint.map(p => p.z)), maxZ: Math.max(...b.footprint.map(p => p.z)) }));
}

// Returns { x, z, hit }. `radius` is the car's own collision radius, so its body stops at
// the wall instead of visually clipping into it.
export function resolveBuildingCollisions(x, z, radius, colliders) {
  let cx = x;
  let cz = z;
  let hit = false;

  for (const collider of colliders) {
    if (cx < collider.minX - radius || cx > collider.maxX + radius || cz < collider.minZ - radius || cz > collider.maxZ + radius) continue;

    const { dist, bx, bz } = nearestOnPolygonBoundary(cx, cz, collider.points);
    const inside = pointInPolygon(cx, cz, collider.points);

    if (inside) {
      let dx = bx - cx;
      let dz = bz - cz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      cx = bx + dx * radius;
      cz = bz + dz * radius;
      hit = true;
    } else if (dist < radius) {
      const dx = (cx - bx) / (dist || 1);
      const dz = (cz - bz) / (dist || 1);
      cx = bx + dx * radius;
      cz = bz + dz * radius;
      hit = true;
    }
  }

  return { x: cx, z: cz, hit };
}

function closestPointOnSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  let t = lenSq > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { cx: ax + abx * t, cz: az + abz * t };
}

function nearestOnPolygonBoundary(px, pz, points) {
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const { cx, cz } = closestPointOnSegment(px, pz, a.x, a.z, b.x, b.z);
    const dist = Math.hypot(px - cx, pz - cz);
    if (!best || dist < best.dist) best = { dist, bx: cx, bz: cz };
  }
  return best;
}

function pointInPolygon(px, pz, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const zi = points[i].z;
    const xj = points[j].x;
    const zj = points[j].z;
    const intersect = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroidOf(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}
