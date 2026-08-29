// Loads real, free (CC0) low-poly building models — from Kenney's City Kit Commercial,
// Suburban, and Industrial packs (see client/public/models/) — and places them at each
// real OSM building's location, scaled to roughly match its real footprint size and
// height. Categories without a matching real model (church, generic) fall back to the
// procedural shapes in buildingModels.js.
//
// Source: https://kenney.nl (CC0 — public domain, free for any use). Downloaded once and
// vendored locally; nothing is fetched from the internet at runtime.
//
// Each building gets its own freshly-imported mesh rather than a shared clone/GPU instance
// of one cached template. That's the less efficient option, but it's the one that actually
// renders reliably: both TransformNode.clone() and instantiateHierarchy() produced meshes
// that were geometrically correct in every way we checked (position, scale, material,
// isEnabled, isVisible, pick-testing all passed) yet never drew a single pixel, for reasons
// that didn't surface in any Babylon API we inspected. A fresh SceneLoader import per
// building is proven to render correctly, and local files make repeated imports cheap.

import { SceneLoader } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const MODELS_BASE_URL = '/models/';

// Paths are relative to MODELS_BASE_URL. Grouped by source pack folder (each pack ships
// its own Textures/colormap.png, referenced by relative path inside the .glb — mixing
// files from different packs into one folder would make them silently point at the wrong
// texture) rather than by our game category, since several categories reuse one pack.
const MODEL_MANIFEST = {
  commercial: [
    'commercial-pack/building-a.glb',
    'commercial-pack/building-b.glb',
    'commercial-pack/building-c.glb',
    'commercial-pack/building-d.glb',
    'commercial-pack/building-e.glb',
    'commercial-pack/building-f.glb',
    'commercial-pack/building-g.glb',
  ],
  office: [
    'commercial-pack/building-skyscraper-a.glb',
    'commercial-pack/building-skyscraper-b.glb',
    'commercial-pack/building-skyscraper-c.glb',
    'commercial-pack/building-skyscraper-d.glb',
    'commercial-pack/building-skyscraper-e.glb',
  ],
  apartments: ['commercial-pack/building-h.glb', 'commercial-pack/building-i.glb', 'commercial-pack/building-j.glb'],
  university: ['commercial-pack/building-m.glb', 'commercial-pack/building-n.glb'],
  house: [
    'suburban-pack/building-type-a.glb',
    'suburban-pack/building-type-b.glb',
    'suburban-pack/building-type-c.glb',
    'suburban-pack/building-type-d.glb',
    'suburban-pack/building-type-e.glb',
    'suburban-pack/building-type-f.glb',
    'suburban-pack/building-type-g.glb',
    'suburban-pack/building-type-h.glb',
    'suburban-pack/building-type-i.glb',
    'suburban-pack/building-type-j.glb',
  ],
  garage: [
    'industrial-pack/building-a.glb',
    'industrial-pack/building-b.glb',
    'industrial-pack/building-c.glb',
    'industrial-pack/building-d.glb',
    'industrial-pack/building-e.glb',
    'industrial-pack/building-f.glb',
  ],
  // No church/generic entries on purpose -- those stay procedural (see buildingModels.js).
};

export function hasRealModelsFor(category) {
  return Boolean(MODEL_MANIFEST[category]);
}

// No-op kept so callers that still `await preloadBuildingAssets(scene)` don't need changing.
export async function preloadBuildingAssets() {}

// Imports a fresh copy of the appropriate model for this building's category, scales it to
// match the real footprint's bounding box and real height, and positions it at the
// footprint's centroid. Returns null if no real model is available for this category
// (caller should fall back to the procedural builder) or if the import fails.
export async function placeBuildingModel(scene, building, index) {
  const files = MODEL_MANIFEST[building.category];
  if (!files) return null;

  const filename = files[index % files.length];
  const lastSlash = filename.lastIndexOf('/');
  const rootUrl = MODELS_BASE_URL + filename.slice(0, lastSlash + 1);
  const bareFilename = filename.slice(lastSlash + 1);

  let result;
  try {
    result = await SceneLoader.ImportMeshAsync(null, rootUrl, bareFilename, scene);
  } catch {
    return null;
  }

  const root = result.meshes[0];

  // Babylon never automatically triggered shader compilation for these imported PBR
  // materials (confirmed: material.isReady() stayed false indefinitely — even minutes of
  // normal rendering, even with a real GPU — and mesh.material.getEffect() was null,
  // meaning compilation was simply never kicked off). forceCompilationAsync fixes it
  // completely; without this the mesh is geometrically present, correctly positioned, and
  // even pickable, but never actually draws a pixel.
  await Promise.all(
    result.meshes
      .filter((m) => m.material)
      .map((m) => m.material.forceCompilationAsync(m).catch(() => {}))
  );
  const { min, max } = root.getHierarchyBoundingVectors(true);
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;

  const centroid = centroidOf(building.footprint);
  const footprintXs = building.footprint.map((p) => p.x);
  const footprintZs = building.footprint.map((p) => p.z);
  const footprintWidth = Math.max(...footprintXs) - Math.min(...footprintXs);
  const footprintDepth = Math.max(...footprintZs) - Math.min(...footprintZs);

  // Bounding-box fit (independent X/Z), not a single uniform scale: real footprints near
  // campus/downtown are often large multi-unit buildings (20-30m) while these Kenney models
  // are built at a small native "kit tile" size — fitting each axis to the real footprint
  // means the model actually covers its real lot, at the cost of some shape stretch for
  // oddly-proportioned buildings.
  const scaleX = clamp(footprintWidth / size.x, 0.3, 20);
  const scaleZ = clamp(footprintDepth / size.z, 0.3, 20);
  const scaleY = clamp(building.height_m / size.y, 0.3, 20);

  root.name = `${building.category}_instance`;
  root.metadata = { isBuilding: true }; // lets the camera raycast avoid clipping through buildings
  root.scaling.set(scaleX, scaleY, scaleZ);
  root.position.set(centroid.x, -min.y * scaleY, centroid.z);

  return root;
}

function centroidOf(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
