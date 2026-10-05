import {MeshBuilder,StandardMaterial,Color3,Mesh} from '@babylonjs/core';
// Only render mapped tree nodes, and never place a trunk/canopy in a road or building.
export async function placeTrees(scene,features,space,start){
 const wood=new StandardMaterial('mapped-tree-wood',scene);wood.diffuseColor=Color3.FromHexString('#76614c');
 const leaf=new StandardMaterial('mapped-tree-leaf',scene);leaf.diffuseColor=Color3.FromHexString('#526d46');leaf.specularColor=Color3.Black();wood.specularColor=Color3.Black();
 const parts=[],placements=[];
 for(const f of features.filter(f=>f.kind==='tree').sort((a,b)=>Math.hypot(a.x-start.x,a.z-start.z)-Math.hypot(b.x-start.x,b.z-start.z))){
  if(placements.length>=100||!space.clear(f,2)||placements.some(p=>Math.hypot(p.x-f.x,p.z-f.z)<4))continue;
  const height=4.5+(f.id%4)*.3;const trunk=MeshBuilder.CreateCylinder('mapped-trunk',{height:height*.6,diameter:.25,tessellation:7},scene);trunk.position.set(f.x,height*.3,f.z);trunk.material=wood;
  const canopy=MeshBuilder.CreateSphere('mapped-canopy',{diameter:3,segments:8},scene);canopy.scaling.y=1.3;canopy.position.set(f.x,height-.8,f.z);canopy.material=leaf;parts.push(trunk,canopy);placements.push(f);
 }
 const meshes=[wood,leaf].map(mat=>{const group=parts.filter(p=>p.material===mat);return group.length?Mesh.MergeMeshes(group,true,true,undefined,false,false):null});const mesh=meshes[0];
 return{mesh,placements};
}
