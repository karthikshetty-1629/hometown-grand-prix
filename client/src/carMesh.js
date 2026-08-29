// Builds a low-poly car out of primitives (chassis, cabin, glass, 4 wheels, head/tail
// lights) instead of a single placeholder box. Shared by the player car and the ghost car
// so both look the same, just tinted/translucent differently.
//
// Forward is +Z (matches the yaw convention used in carController.js:
// rotationY = atan2(direction.x, direction.z)), so headlights sit at +Z, taillights at -Z.

import { MeshBuilder, StandardMaterial, Color3, TransformNode } from '@babylonjs/core';

const WHEEL_POSITIONS = [
  { x: -0.9, z: 1.25 }, // front-left
  { x: 0.9, z: 1.25 }, // front-right
  { x: -0.9, z: -1.25 }, // rear-left
  { x: 0.9, z: -1.25 }, // rear-right
];

export function createCarMesh(scene, { name = 'car', bodyColor = new Color3(0.9, 0.15, 0.15), alpha = 1 } = {}) {
  const root = new TransformNode(name, scene);

  const bodyMaterial = new StandardMaterial(`${name}_bodyMat`, scene);
  bodyMaterial.diffuseColor = bodyColor;
  bodyMaterial.alpha = alpha;

  const chassis = MeshBuilder.CreateBox(`${name}_chassis`, { width: 1.9, height: 0.55, depth: 4.0 }, scene);
  chassis.position.y = 0.5;
  chassis.material = bodyMaterial;
  chassis.parent = root;

  const cabin = MeshBuilder.CreateBox(`${name}_cabin`, { width: 1.5, height: 0.5, depth: 1.9 }, scene);
  cabin.position.set(0, 0.95, -0.2); // set back from center, leaving a "hood" up front
  cabin.material = bodyMaterial;
  cabin.parent = root;

  const glassMaterial = new StandardMaterial(`${name}_glassMat`, scene);
  glassMaterial.diffuseColor = new Color3(0.15, 0.2, 0.28);
  glassMaterial.alpha = Math.min(alpha, 0.85);

  const glass = MeshBuilder.CreateBox(`${name}_glass`, { width: 1.42, height: 0.3, depth: 1.6 }, scene);
  glass.position.set(0, 1.0, -0.15);
  glass.material = glassMaterial;
  glass.parent = root;

  const wheelMaterial = new StandardMaterial(`${name}_wheelMat`, scene);
  wheelMaterial.diffuseColor = new Color3(0.05, 0.05, 0.05);
  wheelMaterial.alpha = alpha;

  WHEEL_POSITIONS.forEach((pos, i) => {
    const wheel = MeshBuilder.CreateCylinder(
      `${name}_wheel${i}`,
      { diameter: 0.7, height: 0.35, tessellation: 16 },
      scene
    );
    wheel.rotation.z = Math.PI / 2; // lay the cylinder on its side
    wheel.position.set(pos.x, 0.35, pos.z);
    wheel.material = wheelMaterial;
    wheel.parent = root;
  });

  const headlightMaterial = new StandardMaterial(`${name}_headlightMat`, scene);
  headlightMaterial.diffuseColor = new Color3(1, 1, 0.85);
  headlightMaterial.emissiveColor = new Color3(0.6, 0.6, 0.4);
  headlightMaterial.alpha = alpha;

  const taillightMaterial = new StandardMaterial(`${name}_taillightMat`, scene);
  taillightMaterial.diffuseColor = new Color3(0.7, 0.05, 0.05);
  taillightMaterial.emissiveColor = new Color3(0.3, 0.02, 0.02);
  taillightMaterial.alpha = alpha;

  for (const side of [-1, 1]) {
    const headlight = MeshBuilder.CreateBox(`${name}_headlight${side}`, { width: 0.35, height: 0.18, depth: 0.1 }, scene);
    headlight.position.set(side * 0.7, 0.55, 2.0);
    headlight.material = headlightMaterial;
    headlight.parent = root;

    const taillight = MeshBuilder.CreateBox(`${name}_taillight${side}`, { width: 0.3, height: 0.15, depth: 0.08 }, scene);
    taillight.position.set(side * 0.7, 0.55, -2.0);
    taillight.material = taillightMaterial;
    taillight.parent = root;
  }

  return root;
}
