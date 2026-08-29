// Places real (CC0, Kenney suburban pack) trees along footpaths as a sidewalk-side detail.
// Same loading pattern as buildingAssets.js (fresh import + forceCompilationAsync per
// placement) — see that file's comment for why: it's the one pattern proven to actually
// render these imported PBR meshes reliably.

import { SceneLoader, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const MODELS_BASE_URL = '/models/suburban-pack/';
const TREE_FILES = ['tree-small.glb', 'tree-large.glb'];
const SPACING_M = 22; // distance along a footpath between trees
const SIDEWAYS_OFFSET_M = 1.1; // nudge off the footpath centerline, away from the road
const MAX_TREES = 60; // cap so a very long route doesn't import hundreds of trees

export async function placeTrees(scene, footpaths) {
  const plans = [];
  for (const points of footpaths) {
    if (points.length < 2) continue;
    let accumulated = SPACING_M / 2; // offset the first tree so rows from different
    // footpaths don't all start exactly at their shared intersection
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const segLength = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLength < 0.01) continue;

      while (accumulated < segLength) {
        const t = accumulated / segLength;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const dirX = (b.x - a.x) / segLength;
        const dirZ = (b.z - a.z) / segLength;
        // perpendicular, pushed to one consistent side of the path
        plans.push({ x: x + dirZ * SIDEWAYS_OFFSET_M, z: z - dirX * SIDEWAYS_OFFSET_M });
        accumulated += SPACING_M;
      }
      accumulated -= segLength;
    }
  }

  if (plans.length === 0) return [];
  const chosen = plans.length > MAX_TREES ? sample(plans, MAX_TREES) : plans;

  const results = await Promise.all(chosen.map((p, i) => placeOneTree(scene, p, i)));
  return results.filter(Boolean);
}

async function placeOneTree(scene, point, index) {
  const filename = TREE_FILES[index % TREE_FILES.length];
  let result;
  try {
    result = await SceneLoader.ImportMeshAsync(null, MODELS_BASE_URL, filename, scene);
  } catch {
    return null;
  }

  const root = result.meshes[0];
  await Promise.all(
    result.meshes.filter((m) => m.material).map((m) => m.material.forceCompilationAsync(m).catch(() => {}))
  );

  root.name = 'tree_instance';
  root.position = new Vector3(point.x, 0, point.z);
  const scale = 0.8 + Math.random() * 0.6; // a little size variety so a row doesn't look copy-pasted
  root.scaling.set(scale, scale, scale);
  root.rotation.y = Math.random() * Math.PI * 2;

  return root;
}

// Evenly-spaced sample rather than random pick, so trees stay spread across the whole
// route instead of clumping wherever the random draws happened to land.
function sample(items, count) {
  const step = items.length / count;
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(items[Math.floor(i * step)]);
  return picked;
}
