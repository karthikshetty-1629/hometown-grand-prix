import {SceneLoader,TransformNode,Vector3,Color3} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
let assets;
export async function loadVehicleAssets(scene){
 assets=await SceneLoader.LoadAssetContainerAsync('/models/car-concept/','CarOptimized.glb',scene);
}
export function createDetailedVehicle(scene,{name='car',bodyColor=Color3.FromHexString('#c3d9cf'),alpha=1}={}){
 if(!assets)return null;
 const root=new TransformNode(name,scene);
 const copy=assets.instantiateModelsToScene(n=>`${name}_${n}`,true,{doNotInstantiate:true});
 const pivot=new TransformNode(name+'_model',scene);pivot.parent=root;
 for(const n of copy.rootNodes)n.parent=pivot;
 for(const group of copy.animationGroups)group.stop();
 const meshes=pivot.getChildMeshes();
 for(const mesh of meshes){mesh.isPickable=false;if(mesh.material){if(/Paint 1/.test(mesh.material.name)){mesh.material.albedoColor=bodyColor;mesh.material.metallic=.55;mesh.material.roughness=.25}if(alpha<1)mesh.material.alpha=alpha}}
 // glTF has its own axis conversion. Determine orientation from the actual lamp geometry.
 const headlights=meshes.find(m=>m.name.includes('BodyHeadlights'));
 const taillights=meshes.find(m=>m.name.includes('BodyTaillights')&&!m.name.includes('Panels'));
 for(const m of meshes)m.computeWorldMatrix(true);
 if(headlights&&taillights&&headlights.getBoundingInfo().boundingBox.centerWorld.z<taillights.getBoundingInfo().boundingBox.centerWorld.z)pivot.rotation.y=Math.PI;
 for(const m of meshes)m.computeWorldMatrix(true);
 const bounds=pivot.getHierarchyBoundingVectors(true);const scale=4.55/(bounds.max.z-bounds.min.z);
 pivot.scaling.setAll(scale);pivot.position.set(-(bounds.min.x+bounds.max.x)/2*scale,-bounds.min.y*scale+.035,-(bounds.min.z+bounds.max.z)/2*scale);
 if (name.startsWith('traffic-')) {
  // Keep glTF submeshes separate: some carry different UV/tangent attributes.
  // Hide internal geometry while retaining the parent transform hierarchy.
  for (const mesh of meshes) if (/Interior|Engine|Underside|HoodInterior|BrakePad|BrakeDisc/.test(mesh.name)) mesh.isVisible=false;
 }
 root.metadata={detailedVehicle:true,meshes};return root;
}
