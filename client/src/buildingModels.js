// Turns a building + its real OSM-derived category into a distinct low-poly shape: the
// body is always the REAL footprint extruded to the REAL height (accurate, from OSM), and
// each category adds a small procedural decoration on top so shops read as shops, houses
// as houses, etc., without needing external 3D model files (see carMesh.js for why we
// build meshes in code instead of downloading assets — same reasoning applies here).
//
// Returns raw meshes (not parented, not merged) — with the whole map's worth of buildings
// (thousands) needing to render at once, sceneBuilder.js merges everything this returns into
// one mesh per material afterward. Thousands of separate mesh nodes was the actual cause of
// a real, reproduced bug: FPS fell from ~22 to ~4 within 8 seconds of driving, because the
// camera's per-frame obstruction raycast (cameraRig.js) has to walk every mesh in the scene.
// Materials are cached per category/decoration (not one `new StandardMaterial` per building)
// for the same reason — merge needs shared materials to collapse into few draw calls, and
// 4,000+ material instances was wasteful regardless.

import { MeshBuilder, StandardMaterial, Color3, Vector3, DynamicTexture, Mesh } from '@babylonjs/core';
import earcut from 'earcut';

const CATEGORY_COLORS = {
  house: new Color3(0.82, 0.68, 0.47), // warm tan
  apartments: new Color3(0.55, 0.55, 0.62), // muted slate
  garage: new Color3(0.5, 0.5, 0.5),
  church: new Color3(0.8, 0.78, 0.72), // stone
  university: new Color3(0.55, 0.25, 0.2), // brick red
  office: new Color3(0.42, 0.56, 0.68), // cool blue-gray
  commercial: new Color3(0.36, 0.46, 0.48), // teal-gray storefront
  generic: new Color3(0.6, 0.6, 0.6),
};

// Assumes one Scene per page load (true here — "play again" reloads the whole page rather
// than rebuilding the scene in place), so a stale cache never outlives the scene it was
// built for.
const materialCache = new Map();
function getSharedMaterial(scene, key, build) {
  if (materialCache.has(key)) return materialCache.get(key);
  const material = build(new StandardMaterial(key, scene));
  materialCache.set(key, material);
  return material;
}

export function buildCategorizedBuilding(scene, building, detail = false) {
  const category = CATEGORY_COLORS[building.category] ? building.category : 'generic';
  const color = CATEGORY_COLORS[category];
  const meshes = [];

  const footprint = building.footprint.map((p) => new Vector3(p.x, 0, p.z));
  const body = MeshBuilder.ExtrudePolygon(`body_${category}`, { shape: footprint, depth: building.height_m }, scene, earcut);
  // ExtrudePolygon extrudes downward from y=0 to y=-height. Shifting position.y up by
  // height puts it back on the ground (y=0 to y=height) with NO rotation needed — rotating
  // around X here would be wrong: the shape's vertices are absolute world x/z coordinates,
  // not centered on a local origin, so rotating the mesh actually rotates every vertex
  // around world (0,0), mirroring every building's Z position across the route's start
  // point instead of just flipping it upright in place.
  body.position.y = building.height_m;
  body.material = getSharedMaterial(scene, `bodyMat_${category}`, (mat) => {
    mat.diffuseColor = color;
    mat.backFaceCulling = false; // guard against winding-order flips now that we don't rotate
    return mat;
  });
  meshes.push(body);
  if (detail && building.height_m > 3) {
    const facadeMat = getSharedMaterial(scene, 'facadeWindows', mat => {
      const texture = new DynamicTexture('windowPattern', { width: 256, height: 256 }, scene, false);
      const ctx = texture.getContext();
      ctx.clearRect(0, 0, 256, 256);
      for (let y=12; y<256; y+=64) for(let x=16; x<256; x+=64) {
        ctx.fillStyle='#9caea9';ctx.fillRect(x-2,y-2,36,44);
        ctx.fillStyle='#304751';ctx.fillRect(x,y,32,40);
        ctx.fillStyle='#718d94';ctx.fillRect(x+2,y+2,13,17);
      }
      texture.hasAlpha=true;texture.update();mat.diffuseTexture=texture;
      mat.useAlphaFromDiffuseTexture=true;mat.backFaceCulling=false;
      return mat;
    });
    for(let i=0;i<footprint.length;i++) {
      const a=footprint[i],b=footprint[(i+1)%footprint.length];
      const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
      if(len<2)continue;
      const wall=MeshBuilder.CreatePlane('facade',{width:len,height:building.height_m,sideOrientation:Mesh.DOUBLESIDE},scene);
      wall.position.set((a.x+b.x)/2+dz/len*.03,building.height_m/2,(a.z+b.z)/2-dx/len*.03);
      wall.rotation.y=-Math.atan2(dz,dx);wall.material=facadeMat;meshes.push(wall);
    }
  }

  const centroid = centroidOf(building.footprint);
  const radius = footprintSizeOf(building.footprint);
  const decorate = DECORATORS[category] || DECORATORS.generic;
  // No invented columns, spires, or roof slabs: preserve the sourced footprint.

  return meshes;
}

function centroidOf(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}

// "Distance to the farthest vertex" blows up for long/irregular real footprints (a 40m x
// 6m building has a huge diagonal despite being narrow) — use sqrt(area) instead, the
// radius of a circle with the same footprint area, which tracks the building's actual
// visual size much better. Real footprints near campus/downtown are often genuinely large
// (20-30m, dense multi-unit housing, not small suburban houses) — the cap here is only a
// backstop against a corrupted/mis-merged footprint, not a routine constraint.
function footprintSizeOf(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.z - p2.x * p1.z;
  }
  area = Math.abs(area) / 2;
  const size = Math.sqrt(area) || 3;
  return Math.min(size, 30);
}

const DECORATORS = {
  // Peaked roof: a 4-sided pyramid sitting on top, like a classic house silhouette. Roof
  // *span* follows the footprint (a small overhang), but roof *height* is capped relative
  // to the building's own height — otherwise a wide-but-short building grows a peak taller
  // than its own walls, which reads as broken, not house-like.
  house(scene, meshes, { centroid, radius, height }) {
    const roofSpan = radius * 1.15;
    const roofHeight = Math.min(roofSpan * 0.4, height * 0.6);
    // No extra rotation here: CreateCylinder's `diameter` for a 4-sided (square) cross
    // section is the square's side length, and rotating 45° turns that into a diamond
    // whose corner-to-corner span is side*sqrt(2) — silently ~41% wider than intended.
    const roof = MeshBuilder.CreateCylinder('roof', {
      diameterTop: 0,
      diameterBottom: roofSpan,
      height: roofHeight,
      tessellation: 4,
    }, scene);
    roof.position.set(centroid.x, height + roofHeight / 2, centroid.z);
    roof.material = getSharedMaterial(scene, 'roofMat', (mat) => {
      mat.diffuseColor = new Color3(0.5, 0.22, 0.18);
      return mat;
    });
    meshes.push(roof);
  },

  // Flat roof with a small rooftop utility box, like a water tank / HVAC unit.
  apartments(scene, meshes, { centroid, radius, height }) {
    const box = MeshBuilder.CreateBox('utility', { width: radius * 0.45, height: 1.1, depth: radius * 0.45 }, scene);
    box.position.set(centroid.x, height + 0.55, centroid.z);
    box.material = getSharedMaterial(scene, 'utilityMat', (mat) => {
      mat.diffuseColor = new Color3(0.35, 0.35, 0.4);
      return mat;
    });
    meshes.push(box);
  },

  // Deliberately plain — garages stay a flat box, no decoration.
  garage() {},

  // A spire on top, like a small chapel. Spires are meant to rise above the roofline, but
  // still capped relative to building height so a large-footprint church doesn't grow an
  // absurdly tall spire.
  church(scene, meshes, { centroid, radius, height }) {
    const spireHeight = Math.min(Math.max(radius * 1.2, 4), height * 1.4);
    const spire = MeshBuilder.CreateCylinder('spire', {
      diameterTop: 0,
      diameterBottom: radius * 0.45,
      height: spireHeight,
      tessellation: 4,
    }, scene);
    spire.position.set(centroid.x, height + spireHeight / 2, centroid.z);
    spire.material = getSharedMaterial(scene, 'spireMat', (mat) => {
      mat.diffuseColor = new Color3(0.35, 0.3, 0.28);
      return mat;
    });
    meshes.push(spire);
  },

  // A row of columns along one edge — reads as an institutional/campus building.
  university(scene, meshes, { centroid, radius, height }) {
    const columnCount = 4;
    const spread = radius * 1.3;
    const mat = getSharedMaterial(scene, 'columnMat', (m) => {
      m.diffuseColor = new Color3(0.85, 0.83, 0.78);
      return m;
    });
    for (let i = 0; i < columnCount; i++) {
      const t = i / (columnCount - 1) - 0.5;
      const column = MeshBuilder.CreateCylinder(`column${i}`, { diameter: 0.55, height, tessellation: 8 }, scene);
      column.position.set(centroid.x + t * spread, height / 2, centroid.z + radius * 0.95);
      column.material = mat;
      meshes.push(column);
    }
  },

  // A translucent glassy cap band near the roofline. Capped at an absolute size (not just
  // scaled from radius) — a real roofline detail doesn't keep growing forever on a genuinely
  // large building; a mall-sized building found once the whole map loaded (not just a
  // ~20-building route corridor) turned this into a huge floating glass slab before the cap
  // was added, same issue as the commercial awning below.
  office(scene, meshes, { centroid, radius, height }) {
    const span = Math.min(radius * 1.5, 18);
    const band = MeshBuilder.CreateBox('capBand', { width: span, height: 0.55, depth: span }, scene);
    band.position.set(centroid.x, height - 0.3, centroid.z);
    band.material = getSharedMaterial(scene, 'capBandMat', (mat) => {
      mat.diffuseColor = new Color3(0.72, 0.87, 0.96);
      mat.alpha = 0.65;
      return mat;
    });
    meshes.push(band);
  },

  // A bright storefront awning band near ground level. Capped at an absolute size for the
  // same reason as the office cap band above — reproduced as a real bug: a genuinely wide
  // (34.8m), real, well-formed commercial building (not corrupted data) produced an awning
  // scaled to ~36m wide, wrongly filling the screen with a solid orange plane. A real awning
  // covers a storefront, not an entire big-box building's frontage.
  commercial(scene, meshes, { centroid, radius, height }) {
    const awningHeight = Math.min(2.2, height * 0.3);
    const span = Math.min(radius * 1.6, 14);
    const awning = MeshBuilder.CreateBox('awning', { width: span, height: 0.3, depth: span }, scene);
    awning.position.set(centroid.x, awningHeight, centroid.z);
    awning.material = getSharedMaterial(scene, 'awningMat', (mat) => {
      mat.diffuseColor = new Color3(0.85, 0.35, 0.25);
      return mat;
    });
    meshes.push(awning);
  },

  // Plain extruded block — the original MVP look, used for anything unclassified.
  generic() {},
};
