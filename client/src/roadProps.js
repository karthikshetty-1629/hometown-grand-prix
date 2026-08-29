// Traffic signals and stop signs at real intersections — nodes in the actual OSM road graph
// where 3+ roads meet (see server/world/fullMapBuilder.js), not a heuristic guess. Which prop
// goes where is decided from real OSM lane/width data: the widest connecting road at that
// intersection gets a signal if it's multi-lane/wide enough, otherwise a stop sign — mirroring
// how these are actually assigned on real American street grids (busier road gets the light).

import { MeshBuilder, StandardMaterial, DynamicTexture, Color3, Vector3, TransformNode } from '@babylonjs/core';
import { ROAD_WIDTH_M } from './constants.js';

const SIGNAL_LANES_THRESHOLD = 3;
const SIGNAL_WIDTH_THRESHOLD_M = 9;

const SIGNAL_CYCLE_S = 15; // green 7s / yellow 2s / red 6s
const SIGNAL_GREEN_S = 7;
const SIGNAL_YELLOW_S = 2;
const SIGNAL_STAGGER_S = 4.5; // offsets each signal's cycle so they don't all switch in sync

export function buildIntersectionProps(scene, intersections) {
  const trafficSignals = [];
  const stopSigns = [];

  intersections.forEach((intersection, i) => {
    const isMajorRoad =
      (intersection.lanes ?? 0) >= SIGNAL_LANES_THRESHOLD || (intersection.width_m ?? 0) >= SIGNAL_WIDTH_THRESHOLD_M;
    if (isMajorRoad) {
      trafficSignals.push(buildTrafficSignal(scene, intersection, i, trafficSignals.length));
    } else {
      stopSigns.push(buildStopSign(scene, intersection, i));
    }
  });

  return { trafficSignals, stopSigns };
}

function perpendicular(dirX, dirZ) {
  return { x: -dirZ, z: dirX };
}

// Offsets the prop to one side of the road (the curb, not the middle of the intersection)
// and yaws it to face oncoming traffic along that road's direction.
function cornerTransform(scene, name, intersection) {
  const root = new TransformNode(name, scene);
  const dirX = intersection.dirX ?? 0;
  const dirZ = intersection.dirZ ?? 1;
  const normal = perpendicular(dirX, dirZ);
  const halfWidth = (intersection.width_m ?? ROAD_WIDTH_M) / 2;
  const offset = halfWidth + 1.4;
  root.position = new Vector3(intersection.x + normal.x * offset, 0, intersection.z + normal.z * offset);
  root.rotation.y = Math.atan2(-dirX, -dirZ);
  return root;
}

function buildStopSign(scene, intersection, index) {
  const root = cornerTransform(scene, `stopSign_${index}`, intersection);

  const poleMat = new StandardMaterial(`stopPoleMat_${index}`, scene);
  poleMat.diffuseColor = new Color3(0.55, 0.55, 0.58);
  const pole = MeshBuilder.CreateCylinder('stopPole', { diameter: 0.08, height: 2.4 }, scene);
  pole.position.y = 1.2;
  pole.material = poleMat;
  pole.parent = root;

  const texture = new DynamicTexture(`stopSignTex_${index}`, { width: 256, height: 256 }, scene, false);
  const ctx = texture.getContext();
  ctx.fillStyle = '#c0201f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 70px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STOP', 128, 132);
  texture.update();

  const faceMat = new StandardMaterial(`stopFaceMat_${index}`, scene);
  faceMat.diffuseTexture = texture;
  faceMat.emissiveColor = new Color3(0.3, 0.05, 0.05);
  faceMat.backFaceCulling = false;

  const face = MeshBuilder.CreateCylinder('stopFace', { diameter: 0.7, height: 0.04, tessellation: 8 }, scene);
  face.rotation.x = Math.PI / 2;
  face.position.y = 2.3;
  face.material = faceMat;
  face.parent = root;

  return root;
}

const LAMP_OFF = { red: new Color3(0.12, 0.02, 0.02), yellow: new Color3(0.12, 0.1, 0.02), green: new Color3(0.02, 0.1, 0.03) };
const LAMP_ON = { red: new Color3(1, 0.05, 0.05), yellow: new Color3(1, 0.75, 0.05), green: new Color3(0.05, 0.95, 0.15) };

function buildTrafficSignal(scene, intersection, index, signalIndex) {
  const root = cornerTransform(scene, `trafficSignal_${index}`, intersection);

  const poleMat = new StandardMaterial(`signalPoleMat_${index}`, scene);
  poleMat.diffuseColor = new Color3(0.15, 0.15, 0.17);
  const pole = MeshBuilder.CreateCylinder('signalPole', { diameter: 0.15, height: 4.6 }, scene);
  pole.position.y = 2.3;
  pole.material = poleMat;
  pole.parent = root;

  const housing = MeshBuilder.CreateBox('signalHousing', { width: 0.5, height: 1.35, depth: 0.35 }, scene);
  housing.position.y = 4.5;
  housing.material = poleMat;
  housing.parent = root;

  const lamps = {};
  const lampNames = ['red', 'yellow', 'green'];
  lampNames.forEach((color, i) => {
    const mat = new StandardMaterial(`lampMat_${index}_${color}`, scene);
    mat.diffuseColor = LAMP_OFF[color];
    mat.emissiveColor = LAMP_OFF[color];
    const lamp = MeshBuilder.CreateCylinder(`lamp_${color}`, { diameter: 0.32, height: 0.06, tessellation: 16 }, scene);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 4.9 - i * 0.4, 0.18);
    lamp.material = mat;
    lamp.parent = root;
    lamps[color] = mat;
  });

  let elapsed = signalIndex * SIGNAL_STAGGER_S;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    elapsed = (elapsed + dt) % SIGNAL_CYCLE_S;

    let active;
    if (elapsed < SIGNAL_GREEN_S) active = 'green';
    else if (elapsed < SIGNAL_GREEN_S + SIGNAL_YELLOW_S) active = 'yellow';
    else active = 'red';

    for (const color of lampNames) {
      const on = color === active;
      lamps[color].emissiveColor = on ? LAMP_ON[color] : LAMP_OFF[color];
      lamps[color].diffuseColor = on ? LAMP_ON[color] : LAMP_OFF[color];
    }
  });

  root.metadata = { signalObserver: observer };
  return root;
}
