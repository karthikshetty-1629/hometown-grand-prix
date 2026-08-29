// Turns a chunk JSON (see docs/chunk-schema.md) into Babylon.js meshes: the road surface
// (real per-segment width from OSM lane data), lane markings, categorized buildings, and
// checkpoint markers.

import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  Mesh,
} from '@babylonjs/core';
import { ROAD_WIDTH_M } from './constants.js';
import { buildCategorizedBuilding } from './buildingModels.js';
import { placeTrees } from './treeAssets.js';
import { buildIntersectionProps } from './roadProps.js';

const DASH_LENGTH_M = 2;
const DASH_GAP_M = 2.5;
const DASH_WIDTH_M = 0.15;
const FOOTPATH_WIDTH_M = 1.6;
const FOOTPATH_HEIGHT_M = 0.15; // real curb height (~6in, the US standard) — a raised slab, not a paint stripe

export async function buildScene(scene, chunk) {
  const road = buildRoadNetwork(scene, chunk.road_segments || []);
  const laneMarkings = buildLaneMarkings(scene, chunk.road_segments || []);
  const footpaths = buildFootpaths(scene, chunk.footpaths || []);

  const buildings = buildAllBuildings(scene, chunk.buildings);
  const trees = await placeTrees(scene, chunk.footpaths || []);

  const checkpoints = chunk.checkpoints.map((c) => buildCheckpointMarker(scene, c));
  const gates = buildStartFinishGates(scene, chunk.start, chunk.checkpoints[0]);
  const roadProps = buildIntersectionProps(scene, chunk.intersections || []);
  const trafficOverlay = buildTrafficOverlay(scene, chunk.road_segments || [], chunk.traffic);

  return { road, laneMarkings, footpaths, buildings, trees, checkpoints, gates, roadProps, trafficOverlay };
}

// Live traffic-congestion overlay: real incidents scraped via Bright Data, matched to real
// road segments by data-pipeline/match_traffic_to_roads.js (see server/routes/live.js) —
// rendered as a colored line down the middle of each congested segment, both its color
// (green -> yellow -> red) AND its thickness scaling with congestion level, so light traffic
// reads as a thin accent line and heavy traffic reads as a thick band. Purely visual:
// doesn't affect physics/collision, and silently renders nothing when no live data has been
// fetched yet.
const TRAFFIC_STRIP_MIN_WIDTH_M = 0.5; // thin line — light traffic
const TRAFFIC_STRIP_MAX_WIDTH_M = 2.5; // thick band — heavy traffic

function buildTrafficOverlay(scene, roadSegments, traffic) {
  if (!traffic || !traffic.segments || traffic.segments.length === 0) return null;

  const strips = [];
  for (const entry of traffic.segments) {
    const segment = roadSegments[entry.id];
    if (!segment) continue;

    const dx = segment.b.x - segment.a.x;
    const dz = segment.b.z - segment.a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;

    const level = Math.max(0, Math.min(1, entry.level));
    const rawWidth = TRAFFIC_STRIP_MIN_WIDTH_M + (TRAFFIC_STRIP_MAX_WIDTH_M - TRAFFIC_STRIP_MIN_WIDTH_M) * level;
    const stripWidth = Math.min(rawWidth, segment.width_m * 0.8); // never wider than the road itself
    const strip = MeshBuilder.CreateBox('trafficStrip', { width: stripWidth, height: 0.02, depth: length }, scene);
    strip.position.set((segment.a.x + segment.b.x) / 2, 0.03, (segment.a.z + segment.b.z) / 2);
    strip.rotation.y = Math.atan2(dx, dz);

    const color = congestionColor(entry.level);
    const mat = new StandardMaterial(`trafficMat_${entry.id}`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.4);
    mat.alpha = 0.75;
    strip.material = mat;
    strips.push(strip);
  }

  if (strips.length === 0) return null;
  return Mesh.MergeMeshes(strips, true, true, undefined, false, true);
}

function congestionColor(level) {
  const clamped = Math.max(0, Math.min(1, level));
  if (clamped < 0.5) {
    return Color3.Lerp(new Color3(0.2, 0.8, 0.2), new Color3(0.95, 0.85, 0.1), clamped / 0.5);
  }
  return Color3.Lerp(new Color3(0.95, 0.85, 0.1), new Color3(0.9, 0.15, 0.15), (clamped - 0.5) / 0.5);
}

// With the whole map's buildings (thousands) instead of a ~20-building route corridor, each
// one staying as its own separate mesh node made the camera's per-frame obstruction raycast
// (which walks every mesh in the scene) collapse FPS from ~22 to ~4 within seconds — a real,
// reproduced bug, not a hypothetical. Collecting every building's meshes and merging them
// into one at the end (same pattern already used for roads/footpaths/lane markings) fixes it;
// collision is unaffected since it reads chunk.buildings' footprint data directly, never the
// Babylon meshes.
function buildAllBuildings(scene, buildings) {
  const allMeshes = [];
  for (const b of buildings) {
    allMeshes.push(...buildCategorizedBuilding(scene, b));
  }
  if (allMeshes.length === 0) return null;

  const merged = Mesh.MergeMeshes(allMeshes, true, true, undefined, false, true);
  if (merged) merged.metadata = { isBuilding: true }; // camera obstruction avoidance (cameraRig.js)
  return merged;
}

// The whole real road network (every OSM way-segment, not one computed path) — each edge
// drawn as its own flat box sized from its real width_m, then merged into one mesh. Segments
// are independent here (no chain to miter-join along), so a plain box per edge is simpler
// than a ribbon and looks the same; the only visible cost is a slightly squared-off seam
// where several edges meet at a real intersection, which is an acceptable trade for
// rendering the whole ~2,500-segment network as a single draw call.
function buildRoadNetwork(scene, roadSegments) {
  const material = new StandardMaterial('roadMat', scene);
  material.diffuseColor = new Color3(0.25, 0.25, 0.27);
  material.backFaceCulling = false;

  const boxes = [];
  for (const seg of roadSegments) {
    const dx = seg.b.x - seg.a.x;
    const dz = seg.b.z - seg.a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;

    const box = MeshBuilder.CreateBox('roadSeg', { width: seg.width_m, height: 0.02, depth: length }, scene);
    box.position.set((seg.a.x + seg.b.x) / 2, 0.01, (seg.a.z + seg.b.z) / 2);
    box.rotation.y = Math.atan2(dx, dz);
    boxes.push(box);
  }

  const merged = boxes.length ? Mesh.MergeMeshes(boxes, true, true, undefined, false, true) : null;
  if (merged) merged.material = material;
  return merged;
}

const MAX_MITER_SCALE = 2.2;

// Miter join with a clamped scale: the naive "average the two segment normals" approach
// used before this produced self-intersecting (bowtie) quads at sharp turns, especially
// combined with a sudden width change between points — visible as a triangular notch bitten
// out of the road right at the corner. A proper miter join (bisector of the in/out normals,
// scaled by 1/cos(half the turn angle)) fixes gentle-to-moderate turns exactly; clamping the
// scale keeps very sharp turns from spiking outward indefinitely, trading a little precision
// at hairpins for guaranteed-simple (non-self-intersecting) geometry.
function mitreNormal(prev, current, next) {
  const dirIn = current.subtract(prev);
  const dirOut = next.subtract(current);
  const dirInLen = dirIn.length();
  const dirOutLen = dirOut.length();

  const normalIn = dirInLen > 1e-6 ? perpendicular(dirIn.scale(1 / dirInLen)) : null;
  const normalOut = dirOutLen > 1e-6 ? perpendicular(dirOut.scale(1 / dirOutLen)) : null;

  if (!normalIn && !normalOut) return new Vector3(1, 0, 0);
  if (!normalIn) return normalOut;
  if (!normalOut) return normalIn;

  const sum = normalIn.add(normalOut);
  const sumLen = sum.length();
  if (sumLen < 1e-4) return normalIn; // near-180° reversal, bisector is degenerate

  const miterDir = sum.scale(1 / sumLen);
  const cosHalfAngle = Vector3.Dot(normalIn, miterDir);
  const miterScale = cosHalfAngle > 0.15 ? Math.min(1 / cosHalfAngle, MAX_MITER_SCALE) : MAX_MITER_SCALE;

  return miterDir.scale(miterScale);
}

function perpendicular(dir) {
  return new Vector3(-dir.z, 0, dir.x);
}

// Dashed white lines between lanes, spaced from real OSM lane counts (falling back to a
// per-road-class default — see server/world/geo.js / data-pipeline/07_export_chunk.py for
// where draw_markings and lanes actually get decided). Built per road segment now that the
// whole network is edges rather than one chained path; merged into one mesh afterward so
// the ~2,500-segment network doesn't cost hundreds of separate draw calls.
function buildLaneMarkings(scene, roadSegments) {
  const material = new StandardMaterial('laneMarkingMat', scene);
  material.diffuseColor = new Color3(0.95, 0.95, 0.9);
  material.emissiveColor = new Color3(0.25, 0.25, 0.22);

  const dashes = [];

  for (const seg of roadSegments) {
    if (!seg.draw_markings || !seg.lanes || seg.lanes < 2) continue;

    const dir = new Vector3(seg.b.x - seg.a.x, 0, seg.b.z - seg.a.z);
    const segLength = dir.length();
    if (segLength < 0.01) continue;
    dir.normalize();
    const normal = new Vector3(dir.z, 0, -dir.x);
    const laneWidth = seg.width_m / seg.lanes;

    for (let laneIndex = 1; laneIndex < seg.lanes; laneIndex++) {
      const offset = -seg.width_m / 2 + laneWidth * laneIndex;
      let d = 0;
      while (d + DASH_LENGTH_M <= segLength) {
        const center = new Vector3(seg.a.x, 0.02, seg.a.z)
          .add(dir.scale(d + DASH_LENGTH_M / 2))
          .add(normal.scale(offset));
        const dash = MeshBuilder.CreateBox('laneDash', { width: DASH_WIDTH_M, height: 0.02, depth: DASH_LENGTH_M }, scene);
        dash.position = center;
        dash.rotation.y = Math.atan2(dir.x, dir.z);
        dashes.push(dash);
        d += DASH_LENGTH_M + DASH_GAP_M;
      }
    }
  }

  if (dashes.length === 0) return null;

  const merged = Mesh.MergeMeshes(dashes, true, true, undefined, false, true);
  if (merged) merged.material = material;
  return merged;
}

// Real OSM footpaths (sidewalks/pedestrian paths), rendered as thin light-colored strips.
// Mainly a visual reference: real footpaths run right alongside real roads, so buildings
// should sit just beyond them — if a building looks disconnected from its neighboring
// footpath, that's a placement bug worth checking.
// Real raised sidewalks, not flat paint stripes: a walkable top surface at curb height plus
// two vertical curb-face walls (road side and building side), so the slab reads as solid
// from any camera angle instead of a floating tilted plane. Uses the same clamped miter join
// as the road ribbon (mitreNormal/perpendicular below) since footpath polylines pulled from
// real OSM data can turn just as sharply as roads do, and a naive averaged-normal offset
// produced the same self-intersecting bowtie geometry there.
function buildFootpaths(scene, footpaths) {
  if (footpaths.length === 0) return null;

  const topMat = new StandardMaterial('footpathTopMat', scene);
  topMat.diffuseColor = new Color3(0.78, 0.74, 0.68);
  topMat.backFaceCulling = false;

  const sideMat = new StandardMaterial('footpathSideMat', scene);
  sideMat.diffuseColor = new Color3(0.5, 0.48, 0.44);
  sideMat.backFaceCulling = false;

  const topStrips = [];
  const sideStrips = [];

  for (const points of footpaths) {
    if (points.length < 2) continue;
    const centerPoints = points.map((p) => new Vector3(p.x, 0, p.z));

    const outerBottom = [];
    const outerTop = [];
    const innerBottom = [];
    const innerTop = [];

    for (let i = 0; i < centerPoints.length; i++) {
      const prev = centerPoints[Math.max(i - 1, 0)];
      const next = centerPoints[Math.min(i + 1, centerPoints.length - 1)];
      const normal = mitreNormal(prev, centerPoints[i], next);
      const halfWidth = FOOTPATH_WIDTH_M / 2;

      const outer = centerPoints[i].add(normal.scale(halfWidth));
      const inner = centerPoints[i].add(normal.scale(-halfWidth));

      outerBottom.push(new Vector3(outer.x, 0.01, outer.z));
      outerTop.push(new Vector3(outer.x, FOOTPATH_HEIGHT_M, outer.z));
      innerBottom.push(new Vector3(inner.x, 0.01, inner.z));
      innerTop.push(new Vector3(inner.x, FOOTPATH_HEIGHT_M, inner.z));
    }

    topStrips.push(
      MeshBuilder.CreateRibbon('footpathTop', { pathArray: [innerTop, outerTop], closeArray: false }, scene)
    );
    sideStrips.push(
      MeshBuilder.CreateRibbon('footpathWallOuter', { pathArray: [outerBottom, outerTop], closeArray: false }, scene),
      MeshBuilder.CreateRibbon('footpathWallInner', { pathArray: [innerBottom, innerTop], closeArray: false }, scene)
    );
  }

  const top = topStrips.length ? Mesh.MergeMeshes(topStrips, true, true, undefined, false, true) : null;
  if (top) top.material = topMat;

  const walls = sideStrips.length ? Mesh.MergeMeshes(sideStrips, true, true, undefined, false, true) : null;
  if (walls) walls.material = sideMat;

  return { top, walls };
}

// A thin glowing post + an overhead ring spanning the road, like a race-gate — reads as
// "drive under this" rather than a solid obstacle sitting in the driving line. Not part of
// collision at all; the car passes straight through it, only the checkpoint-radius check
// in main.js cares about it. Also paints a real-looking crosswalk (parallel white stripes,
// like a zebra crossing) under the gate.
function buildCheckpointMarker(scene, checkpoint) {
  const root = new TransformNode(`checkpoint_${checkpoint.index}`, scene);
  root.position = new Vector3(checkpoint.x, 0, checkpoint.z);

  const width = checkpoint.width_m ?? ROAD_WIDTH_M;
  const dirX = checkpoint.dirX ?? 0;
  const dirZ = checkpoint.dirZ ?? 1;

  const material = new StandardMaterial(`checkpointMat_${checkpoint.index}`, scene);
  material.diffuseColor = new Color3(1, 0.8, 0);
  material.emissiveColor = new Color3(0.6, 0.45, 0);
  material.alpha = 0.55;

  const post = MeshBuilder.CreateCylinder('post', { diameter: 0.12, height: 5 }, scene);
  post.position.y = 2.5;
  post.material = material;
  post.parent = root;

  const ring = MeshBuilder.CreateTorus('ring', { diameter: width - 1, thickness: 0.15, tessellation: 24 }, scene);
  ring.position.y = 4.8;
  ring.rotation.x = Math.PI / 2;
  ring.material = material;
  ring.parent = root;

  const crosswalk = buildCrosswalk(scene, checkpoint.index, width, dirX, dirZ);
  crosswalk.parent = root;

  // A ~5m-wide, 4.8m-high ring looks fine from a normal approach distance, but the chase
  // camera necessarily gets very close to (and briefly passes through) it as the car crosses
  // the gate — a torus viewed edge-on from a couple of meters away warps into a huge, curved
  // smear purely from perspective, not any actual sizing bug. Fading it out as the camera
  // nears it avoids that close-up distortion while keeping the gate visible from afar.
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    const distance = Vector3.Distance(cam.position, root.position);
    const t = Math.max(0, Math.min(1, (distance - RING_FADE_END_M) / (RING_FADE_START_M - RING_FADE_END_M)));
    material.alpha = RING_MIN_ALPHA + (RING_BASE_ALPHA - RING_MIN_ALPHA) * t;
  });

  return root;
}

const RING_FADE_START_M = 14; // full opacity beyond this distance
const RING_FADE_END_M = 3; // fully faded within this distance
const RING_BASE_ALPHA = 0.55;
const RING_MIN_ALPHA = 0.03;

const CROSSWALK_STRIPE_WIDTH_M = 0.6;
const CROSSWALK_STRIPE_GAP_M = 0.5;
const CROSSWALK_STRIPE_LENGTH_M = 3;

// Real zebra-crossing look: white stripes running along the direction of travel (so a car
// crosses each stripe in turn), repeated across the road's width.
function buildCrosswalk(scene, index, roadWidth, dirX, dirZ) {
  const mat = new StandardMaterial(`crosswalkMat_${index}`, scene);
  mat.diffuseColor = new Color3(0.9, 0.9, 0.88);

  const period = CROSSWALK_STRIPE_WIDTH_M + CROSSWALK_STRIPE_GAP_M;
  const count = Math.max(3, Math.floor(roadWidth / period));
  const spanStart = -((count - 1) * period) / 2;
  const normalX = dirZ;
  const normalZ = -dirX;

  const stripes = [];
  for (let i = 0; i < count; i++) {
    const offset = spanStart + i * period;
    const stripe = MeshBuilder.CreateBox('crosswalkStripe', {
      width: CROSSWALK_STRIPE_WIDTH_M,
      height: 0.02,
      depth: CROSSWALK_STRIPE_LENGTH_M,
    }, scene);
    stripe.position.set(normalX * offset, 0.018, normalZ * offset);
    stripe.rotation.y = Math.atan2(dirX, dirZ);
    stripe.material = mat;
    stripes.push(stripe);
  }

  const merged = Mesh.MergeMeshes(stripes, true, true, undefined, false, true);
  merged.material = mat;
  return merged;
}

const GATE_PILLAR_HEIGHT_M = 6;
const CHECKER_SQUARE_M = 1;

// A start gate (green) at the player's chosen start point, and a finish gate (checkered) at
// their chosen destination — both now carry their own real width/direction from the server
// (the edge of the road network they sit on), since there's no single computed path to read
// the first/last point from anymore.
function buildStartFinishGates(scene, start, finish) {
  if (!start || !finish) return null;

  const startDir = new Vector3(start.dirX ?? 0, 0, start.dirZ ?? 1);
  const startGate = buildGate(scene, 'start', start, startDir, start.width_m ?? ROAD_WIDTH_M, {
    pillarColor: new Color3(0.15, 0.75, 0.35),
    checkered: false,
  });

  const finishDir = new Vector3(finish.dirX ?? 0, 0, finish.dirZ ?? 1);
  const finishGate = buildGate(scene, 'finish', finish, finishDir, finish.width_m ?? ROAD_WIDTH_M, {
    pillarColor: new Color3(0.1, 0.1, 0.12),
    checkered: true,
  });

  return { start: startGate, finish: finishGate };
}

function buildGate(scene, name, point, dir, roadWidth, { pillarColor, checkered }) {
  const root = new TransformNode(`gate_${name}`, scene);
  root.position = new Vector3(point.x, 0, point.z);

  const normal = new Vector3(-dir.z, 0, dir.x);
  const halfSpan = roadWidth / 2 + 0.6;
  const beamYaw = Math.atan2(normal.x, normal.z);

  const pillarMat = new StandardMaterial(`gatePillarMat_${name}`, scene);
  pillarMat.diffuseColor = pillarColor;
  pillarMat.emissiveColor = pillarColor.scale(0.35);

  for (const side of [-1, 1]) {
    const pillar = MeshBuilder.CreateCylinder(`gatePillar_${name}`, { diameter: 0.4, height: GATE_PILLAR_HEIGHT_M }, scene);
    pillar.position.set(normal.x * halfSpan * side, GATE_PILLAR_HEIGHT_M / 2, normal.z * halfSpan * side);
    pillar.material = pillarMat;
    pillar.parent = root;
  }

  const beam = MeshBuilder.CreateBox(`gateBeam_${name}`, { width: 0.4, height: 0.4, depth: halfSpan * 2 }, scene);
  beam.position.y = GATE_PILLAR_HEIGHT_M;
  beam.rotation.y = beamYaw;
  beam.material = pillarMat;
  beam.parent = root;

  const stripe = checkered
    ? buildCheckeredStripe(scene, name, roadWidth, normal, beamYaw)
    : buildSolidStripe(scene, name, roadWidth, beamYaw, pillarColor);
  stripe.parent = root;

  return root;
}

function buildSolidStripe(scene, name, roadWidth, beamYaw, color) {
  const stripe = MeshBuilder.CreateBox(`gateStripe_${name}`, { width: 1.5, height: 0.02, depth: roadWidth }, scene);
  stripe.position.y = 0.02;
  stripe.rotation.y = beamYaw;
  const mat = new StandardMaterial(`gateStripeMat_${name}`, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.25);
  stripe.material = mat;
  return stripe;
}

function buildCheckeredStripe(scene, name, roadWidth, normal, beamYaw) {
  const blackMat = new StandardMaterial(`gateCheckerBlack_${name}`, scene);
  blackMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
  const whiteMat = new StandardMaterial(`gateCheckerWhite_${name}`, scene);
  whiteMat.diffuseColor = new Color3(0.92, 0.92, 0.92);

  const squares = [];
  const count = Math.max(4, Math.round(roadWidth / CHECKER_SQUARE_M));
  const start = -roadWidth / 2;
  for (let i = 0; i < count; i++) {
    const offset = start + (i + 0.5) * (roadWidth / count);
    const square = MeshBuilder.CreateBox(`checkerSquare`, { width: roadWidth / count, height: 0.02, depth: 1.5 }, scene);
    square.position.set(normal.x * offset, 0.02, normal.z * offset);
    square.rotation.y = beamYaw;
    square.material = i % 2 === 0 ? blackMat : whiteMat;
    squares.push(square);
  }
  const merged = Mesh.MergeMeshes(squares, true, true, undefined, false, true);
  return merged || new TransformNode(`gateStripe_${name}`, scene);
}
