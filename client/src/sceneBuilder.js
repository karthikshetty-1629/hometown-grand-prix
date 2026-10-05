import {curbSegments} from './roadBoundary.js';
import {MeshBuilder,StandardMaterial,Color3,Mesh,Vector3,TransformNode,VertexData} from '@babylonjs/core';
import {buildCategorizedBuilding} from './buildingModels.js';
import {placeTrees} from './treeAssets.js';
import {buildIntersectionProps} from './roadProps.js';
import {StreetSpace,safeWalkways} from './streetGeometry.js';
import {driveSession} from './routePicker.js';
function material(scene,name,hex){const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor=Color3.Black();return m}
function merge(meshes,mat){
 const tiles=new Map();
 for(const m of meshes){m.computeWorldMatrix(true);const p=m.getBoundingInfo().boundingBox.centerWorld;const k=`${Math.floor(p.x/160)},${Math.floor(p.z/160)},${mat?.uniqueId ?? m.material?.uniqueId ?? 0}`;if(!tiles.has(k))tiles.set(k,[]);tiles.get(k).push(m)}
 let first=null;
 for(const group of tiles.values()){const m=Mesh.MergeMeshes(group,true,true,undefined,false,false);if(!m)continue;if(mat)m.material=mat;m.isPickable=false;m.freezeWorldMatrix();m.receiveShadows=true;first ||= m}
 return first;
}
function strip(scene,name,a,b,width,height=.02){const dx=b.x-a.x,dz=b.z-a.z;const mesh=MeshBuilder.CreateBox(name,{width,height,depth:Math.hypot(dx,dz)+.03},scene);mesh.position.set((a.x+b.x)/2,height/2,(a.z+b.z)/2);mesh.rotation.y=Math.atan2(dx,dz);return mesh}
export async function buildScene(scene,chunk,progress=async()=>{}){
 await progress(40,"Laying out your streets…");
 const space=new StreetSpace(chunk),walkways=safeWalkways(chunk,space);chunk.walkways=walkways;chunk.streetSpace=space;
 const ground=MeshBuilder.CreateGround('city-ground',{width:14000,height:14000},scene);ground.position.y=-.055;ground.material=material(scene,'ground','#a0a290');ground.receiveShadows=true;
 const roadMat=material(scene,'asphalt','#454a4b'),sideMat=material(scene,'concrete','#b9b6aa');
 const roads=[],joints=new Map();
 for(const s of chunk.road_segments){roads.push(strip(scene,'road',s.a,s.b,s.width_m));for(const p of[s.a,s.b]){const key=`${p.x},${p.z}`;if(!joints.has(key)||joints.get(key).width<s.width_m)joints.set(key,{...p,width:s.width_m})}}
 for(const p of joints.values()){const disc=MeshBuilder.CreateCylinder('road-joint',{diameter:p.width,height:.02,tessellation:12},scene);disc.position.set(p.x,.01,p.z);roads.push(disc)}
 const road=merge(roads,roadMat);road.receiveShadows=true;
 await progress(52,'Building sidewalks and protective curbs…');
 const curbTiles=new Map(),curbMat=material(scene,'curb-stone','#ded9ca');
 const boxData=VertexData.CreateBox({width:1,height:1,depth:1});
 for(const {a,b} of curbSegments(space)){
  const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<.01)continue;
  const x=(a.x+b.x)/2,z=(a.z+b.z)/2,key=`${Math.floor(x/160)},${Math.floor(z/160)}`;
  if(!curbTiles.has(key))curbTiles.set(key,{positions:[],normals:[],indices:[]});const data=curbTiles.get(key),offset=data.positions.length/3;
  for(let i=0;i<boxData.positions.length;i+=3){const px=boxData.positions[i]*.24,pz=boxData.positions[i+2]*len;data.positions.push(x+px*dz/len+pz*dx/len,.12+boxData.positions[i+1]*.24,z-px*dx/len+pz*dz/len);const nx=boxData.normals[i],nz=boxData.normals[i+2];data.normals.push(nx*dz/len+nz*dx/len,boxData.normals[i+1],-nx*dx/len+nz*dz/len)}
  for(const index of boxData.indices)data.indices.push(index+offset);
 }
 for(const data of curbTiles.values()){const mesh=new Mesh('protective-curbs',scene),vertices=new VertexData();Object.assign(vertices,data);vertices.applyToMesh(mesh);mesh.material=curbMat;mesh.freezeWorldMatrix();mesh.isPickable=false}
 const sidewalkParts=[];
 for(const points of walkways)for(let i=1;i<points.length;i++){if(Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z)<.1)continue;sidewalkParts.push(strip(scene,'safe-sidewalk',points[i-1],points[i],1.6,.13))}
 const sidewalk=merge(sidewalkParts,sideMat);if(sidewalk)sidewalk.receiveShadows=true;
 const paintWhite=material(scene,'road-paint-white','#d7d8cd'),paintYellow=material(scene,'road-paint-yellow','#d8b960');
 const white=[],yellow=[];
 // Remove markings through junctions. Shape points with degree 2 are not junctions.
 const cells=new Map();for(const j of chunk.intersections){const key=`${Math.floor(j.x/30)},${Math.floor(j.z/30)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(j)}
 const atJunction=p=>{for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)for(const j of cells.get(`${Math.floor(p.x/30)+x},${Math.floor(p.z/30)+z}`)||[])if(Math.hypot(j.x-p.x,j.z-p.z)<j.width_m/2+4)return true;return false};
 for(const s of chunk.road_segments){if(!s.draw_markings||s.lanes<2)continue;const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz);if(len<2)continue;const ux=dx/len,uz=dz/len;
  for(let k=1;k<s.lanes;k++){const offset=-s.width_m/2+k*s.width_m/s.lanes;const center=!s.oneway&&Math.abs(offset)<.2;
   for(let t=1;t<len-1;t+=center?3:6){const depth=Math.min(center?3:2.5,len-t);const p={x:s.a.x+ux*(t+depth/2)+uz*offset,z:s.a.z+uz*(t+depth/2)-ux*offset};if(atJunction(p))continue;
    for(const shift of center?[-.12,.12]:[0]){const mesh=MeshBuilder.CreateBox('lane-paint',{width:.1,height:.008,depth},scene);mesh.position.set(p.x+uz*shift,.028,p.z-ux*shift);mesh.rotation.y=Math.atan2(ux,uz);(center?yellow:white).push(mesh)}
   }
  }
 }
 const crossings=[];
 for(const f of chunk.map_features||[]){if(f.kind!=='crossing'||['no','unmarked'].includes(f.tags.crossing)||f.tags['crossing:markings']==='no')continue;
  if(Math.hypot(f.x-chunk.start.x,f.z-chunk.start.z)>900)continue;
  const hit=space.nearest(f);if(!hit||hit.distance>3||crossings.some(c=>Math.hypot(c.x-hit.x,c.z-hit.z)<5))continue;
  crossings.push(hit);const s=hit.segment,dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz)||1;
  for(let o=-s.width_m/2+.5;o<s.width_m/2-.3;o+=1.1){const stripe=MeshBuilder.CreateBox('mapped-crosswalk',{width:.5,height:.009,depth:2.4},scene);stripe.position.set(hit.x+dz/len*o,.032,hit.z-dx/len*o);stripe.rotation.y=Math.atan2(dx,dz);white.push(stripe)}
 }
 merge(white,paintWhite);merge(yellow,paintYellow);
 await progress(68,'Opening the city blocks…');
 const buildingParts=[];let buildingCount=0;for(const b of chunk.buildings){if(++buildingCount%300===0)await progress(68+Math.round(buildingCount/chunk.buildings.length*14),'Opening the city blocks…');buildingParts.push(...buildCategorizedBuilding(scene,b,Math.hypot(b.footprint[0].x-chunk.start.x,b.footprint[0].z-chunk.start.z)<800))}
 const buildings=merge(buildingParts);if(buildings){buildings.metadata={isBuilding:true};buildings.receiveShadows=true}
 await progress(85,'Setting signals and city life…');
 const props=buildIntersectionProps(scene,chunk.map_features||[],space);chunk.signals=props.signals;
 const trees=await placeTrees(scene,chunk.map_features||[],space,chunk.start);
 // A finish is game UI, not fake street furniture. Free drive has no race props.
 if(driveSession.mode==='race'){const target=chunk.checkpoints[0];const ring=MeshBuilder.CreateTorus('finish-area',{diameter:7,thickness:.12,tessellation:32},scene);ring.position.set(target.x,.06,target.z);const m=material(scene,'finish-paint','#d5fc51');m.emissiveColor=Color3.FromHexString('#5f7825');ring.material=m;}
 chunk.sceneAudit={signals:props.placements.length,trees:trees.placements.length,walkways:walkways.length,crossings:crossings.length,obstructingProps:[...props.placements,...trees.placements].filter(p=>!space.clear(p,.4)).length};
 return{road,buildings,sidewalk,props,trees};
}
