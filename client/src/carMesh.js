import { createDetailedVehicle } from './vehicleAssets.js';
// Builds a low-poly car out of primitives (chassis, cabin, glass, 4 wheels, head/tail
// lights) instead of a single placeholder box. Shared by the player car and the ghost car
// so both look the same, just tinted/translucent differently.
//
// Forward is +Z (matches the yaw convention used in carController.js:
// rotationY = atan2(direction.x, direction.z)), so headlights sit at +Z, taillights at -Z.

import { MeshBuilder, StandardMaterial, Color3, TransformNode, Mesh, VertexData } from '@babylonjs/core';

const WHEEL_POSITIONS = [
  { x: -0.9, z: 1.25 }, // front-left
  { x: 0.9, z: 1.25 }, // front-right
  { x: -0.9, z: -1.25 }, // rear-left
  { x: 0.9, z: -1.25 }, // rear-right
];

export function createCarMesh(scene, { name = 'car', bodyColor = new Color3(0.9, 0.15, 0.15), alpha = 1 } = {}) {
  if (!name.startsWith('police') && !name.startsWith('ambulance')) {
    const detailed = createDetailedVehicle(scene, { name, bodyColor, alpha });
    if (detailed) return detailed;
  }
  const root = new TransformNode(name, scene);

  const bodyMaterial = new StandardMaterial(`${name}_bodyMat`, scene);
  bodyMaterial.diffuseColor = bodyColor;
  bodyMaterial.alpha = alpha;

  const chassis = MeshBuilder.CreateBox(`${name}_chassis`, { width: 1.9, height: 0.55, depth: 4.0 }, scene);
  chassis.position.y = 0.5;
  chassis.material = bodyMaterial;
  chassis.parent = root;

  const cabin = taperedCabin(`${name}_cabin`, 1.65, .6, 2.2, scene);
  cabin.position.set(0, 0.95, -0.2); // set back from center, leaving a "hood" up front
  cabin.material = bodyMaterial;
  cabin.parent = root;

  const glassMaterial = new StandardMaterial(`${name}_glassMat`, scene);
  glassMaterial.diffuseColor = new Color3(0.15, 0.2, 0.28);
  glassMaterial.alpha = Math.min(alpha, 0.85);

  const glass = taperedCabin(`${name}_glass`, 1.66, .40, 2.19, scene);
  glass.position.set(0, 1.0, -0.2);
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

  const trim = new StandardMaterial(`${name}_trim`, scene);
  trim.diffuseColor = new Color3(.07,.09,.1); trim.alpha=alpha;
  for(const z of [-2.02,2.02]) {
    const bumper=MeshBuilder.CreateBox(`${name}_bumper`,{width:1.85,height:.16,depth:.15},scene);
    bumper.position.set(0,.31,z);bumper.material=trim;bumper.parent=root;
  }
  const spoiler=MeshBuilder.CreateBox(`${name}_spoiler`,{width:1.7,height:.09,depth:.36},scene);
  spoiler.position.set(0,.95,-1.65);spoiler.material=trim;spoiler.parent=root;
  const roof=MeshBuilder.CreateBox(`${name}_roof`,{width:1.21,height:.06,depth:1.34},scene);
  roof.position.set(0,1.26,-.35);roof.material=bodyMaterial;roof.parent=root;
  const rimMat = new StandardMaterial(`${name}_rims`,scene);
  rimMat.diffuseColor = new Color3(.64,.68,.7);rimMat.alpha=alpha;
  WHEEL_POSITIONS.forEach((p,i)=>{
    const rim=MeshBuilder.CreateCylinder(`${name}_rim${i}`,{diameter:.42,height:.37,tessellation:8},scene);
    rim.rotation.z=Math.PI/2;rim.position.set(p.x,.35,p.z);rim.material=rimMat;rim.parent=root;
  });
  return root;
}

function taperedCabin(name,width,height,depth,scene) {
 const w=width/2,h=height/2,d=depth/2;
 const points=[[-w,-h,-d],[w,-h,-d],[w,-h,d],[-w,-h,d],[-w*.74,h,-d*.8],[w*.74,h,-d*.8],[w*.74,h,d*.46],[-w*.74,h,d*.46]];
 const faces=[[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7],[3,2,1,0]];
 const positions=[],indices=[];
 for(const face of faces){const o=positions.length/3;for(const i of face)positions.push(...points[i]);indices.push(o,o+1,o+2,o,o+2,o+3)}
 const normals=[];VertexData.ComputeNormals(positions,indices,normals);const data=new VertexData();
 data.positions=positions;data.indices=indices;data.normals=normals;const mesh=new Mesh(name,scene);data.applyToMesh(mesh);return mesh;
}
