import {MeshBuilder,StandardMaterial,DynamicTexture,Color3,TransformNode} from '@babylonjs/core';
import {placeCurbFeature} from './streetGeometry.js';
// The snapshot determines which junctions are controlled. Pole offsets and phase timing
// remain a simulation; OSM control nodes are not surveyed hardware positions.
export function buildIntersectionProps(scene,features,space){
 const poles=[],signals=[],placed=[];
 const metal=new StandardMaterial('signal-metal',scene);metal.diffuseColor=Color3.FromHexString('#697375');metal.specularColor=Color3.FromHexString('#33383b');
 const black=new StandardMaterial('signal-housing',scene);black.diffuseColor=Color3.FromHexString('#242929');
 for(const f of features){if(!['traffic_signals','stop'].includes(f.kind))continue;
  const p=placeCurbFeature(f,space);if(!p||placed.some(v=>Math.hypot(v.x-p.x,v.z-p.z)<9))continue;placed.push(p);
  const root=new TransformNode('mapped-'+f.kind+'-'+f.id,scene);root.position.set(p.x,0,p.z);root.rotation.y=Math.atan2(-p.dirX,-p.dirZ);
  const pole=MeshBuilder.CreateCylinder('curb-pole',{diameter:.13,height:f.kind==='stop'?2.6:4.8,tessellation:8},scene);pole.position.y=f.kind==='stop'?1.3:2.4;pole.material=metal;pole.parent=root;
  if(f.kind==='stop'){
   const face=MeshBuilder.CreateDisc('mapped-stop-sign',{radius:.36,tessellation:8,sideOrientation:2},scene);face.parent=root;face.position.set(0,2.35,.08);
   const texture=new DynamicTexture('stop-label',{width:128,height:128},scene,false);const c=texture.getContext();c.fillStyle='#b13228';c.fillRect(0,0,128,128);c.strokeStyle='white';c.lineWidth=8;c.strokeRect(5,5,118,118);c.fillStyle='white';c.font='bold 35px sans-serif';c.textAlign='center';c.fillText('STOP',64,78);texture.update();const m=new StandardMaterial('stop-face',scene);m.diffuseTexture=texture;m.backFaceCulling=false;face.material=m;
  }else{
   const box=MeshBuilder.CreateBox('signal-head',{width:.48,height:1.25,depth:.3},scene);box.position.set(0,4.5,.08);box.material=black;box.parent=root;
   const lamps=['red','yellow','green'].map((color,i)=>{const mesh=MeshBuilder.CreateSphere('lamp-'+color,{diameter:.24,segments:8},scene);mesh.scaling.z=.25;mesh.position.set(0,4.88-i*.38,.25);mesh.parent=root;const m=new StandardMaterial('lamp-'+f.id+color,scene);mesh.material=m;return{m,color}});
   const item={...p,id:f.id,phase:'red',offset:Math.abs(f.id%4)*3,lamps};signals.push(item);
  }
  poles.push(root);
 }
 let lastUpdate=0;scene.onBeforeRenderObservable.add(()=>{const seconds=performance.now()/1000;if(seconds-lastUpdate<.2)return;lastUpdate=seconds;for(const p of poles)p.setEnabled(Math.hypot(p.position.x-scene.activeCamera.position.x,p.position.z-scene.activeCamera.position.z)<650);for(const s of signals){const phase=(seconds+s.offset)%24;s.phase=phase<11?'green':phase<14?'yellow':'red';for(const lamp of s.lamps){const on=lamp.color===s.phase;const colors={red:'#ee3c32',yellow:'#ffbd47',green:'#42cd8c'};lamp.m.diffuseColor=Color3.FromHexString(colors[lamp.color]).scale(on?1:.12);lamp.m.emissiveColor=Color3.FromHexString(colors[lamp.color]).scale(on?.85:0)}}});
 return{poles,signals,placements:placed};
}
