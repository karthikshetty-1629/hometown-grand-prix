import {MeshBuilder,StandardMaterial,Color3,TransformNode,Vector3} from '@babylonjs/core';
import {closestPoint, directedLanes} from './streetGeometry.js';
import {createCarMesh} from './carMesh.js';
function length(a,b){return Math.hypot(b.x-a.x,b.z-a.z)}
export class CityLife {
 constructor(scene,chunk){this.chunk=chunk;this.edges=directedLanes(chunk.road_segments);this.outgoing=new Map();for(const e of this.edges){if(!this.outgoing.has(e.from))this.outgoing.set(e.from,[]);this.outgoing.get(e.from).push(e)}this.cars=[];this.people=[];this.clock=0;this.sequence=0;
  const nearby=this.edges.filter(e=>length(e.a,chunk.start)<300&&e.len>12).sort((a,b)=>length(a.a,chunk.start)-length(b.a,chunk.start));
  const colors=['#657c89','#d5d2c6','#903f38','#344851','#b4b6b0','#c7ad7d'];
  for(let i=0;i<Math.min(10,nearby.length);i++){const edge=nearby[(i*7+3)%nearby.length],root=createCarMesh(scene,{name:'traffic-'+i,bodyColor:Color3.FromHexString(colors[i%colors.length])});const t=.25+(i%3)*.22;root.position.set(edge.a.x+(edge.b.x-edge.a.x)*t,0,edge.a.z+(edge.b.z-edge.a.z)*t);root.rotation.y=Math.atan2(edge.dx,edge.dz);this.cars.push({root,edge,speed:0,cruise:6+i%4,wait:0})}
  const paths=chunk.walkways.filter(p=>p.length>=2&&length(p[0],chunk.start)<450).sort((a,b)=>length(a[0],chunk.start)-length(b[0],chunk.start));
  for(let i=0;i<Math.min(28,paths.length);i++){const path=paths[(i*3)%Math.min(paths.length,100)];const person=this.createPerson(scene,i);person.path=path;person.index=Math.min(path.length-1,1+i%5);person.dir=1;person.root.position.set(path[person.index].x,.13,path[person.index].z);person.speed=.8+(i%4)*.15;this.people.push(person)}
 }
 createPerson(scene,i){const root=new TransformNode('walker-'+i,scene);const mat=(name,color)=>{const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(color);return m};const shirt=mat('shirt-'+i,['#e0b678','#446878','#98574a','#d8d5c5','#5a6851'][i%5]),skin=mat('skin-'+i,['#b47d58','#ddb393','#80583f'][i%3]),pants=mat('pants-'+i,'#343c43');
  const part=(name,w,h,d,x,y,z,m,parent=root)=>{const p=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);p.parent=parent;p.position.set(x,y,z);p.material=m;return p};
  const torso=part('torso',.42,.57,.24,0,1.08,0,shirt);const head=MeshBuilder.CreateSphere('head',{diameter:.26,segments:8},scene);head.parent=root;head.position.set(0,1.55,0);head.material=skin;
  const limbs=[];for(const side of [-1,1]){const leg=new TransformNode('leg',scene);leg.parent=root;leg.position.set(side*.12,.82,0);part('trouser',.16,.68,.18,0,-.34,0,pants,leg);part('shoe',.18,.1,.3,0,-.72,.05,pants,leg);const arm=new TransformNode('arm',scene);arm.parent=root;arm.position.set(side*.28,1.31,0);part('sleeve',.13,.35,.16,0,-.17,0,shirt,arm);part('forearm',.11,.29,.12,0,-.45,0,skin,arm);limbs.push({leg,arm,side})}
  return{root,limbs,phase:i,hit:false};
 }
 nextEdge(car){const options=(this.outgoing.get(car.edge.to)||[]).filter(e=>e.to!==car.edge.from);if(!options.length)return null;options.sort((a,b)=>(b.dx*car.edge.dx+b.dz*car.edge.dz)-(a.dx*car.edge.dx+a.dz*car.edge.dz));return options[(this.sequence++%7===0&&options.length>1)?1:0]}
 respawn(car,player){const options=this.edges.filter(e=>length(e.a,player)>90&&length(e.a,player)<220&&e.len>15);if(!options.length){car.root.setEnabled(false);return}car.edge=options[this.sequence++%options.length];car.root.position.set(car.edge.a.x,0,car.edge.a.z);car.root.rotation.y=Math.atan2(car.edge.dx,car.edge.dz);car.root.setEnabled(true)}
 placeResponder(responder,target,behind=45){
  const choices=this.edges.filter(e=>length(e.a,target)>behind&&length(e.a,target)<behind+70);
  const edge=choices.sort((a,b)=>length(a.a,target)-length(b.a,target))[0]||this.edges[0];
  responder.edge=edge;responder.root.position.set(edge.a.x,0,edge.a.z);responder.root.rotation.y=Math.atan2(edge.dx,edge.dz);
 }
 moveResponder(responder,target,dt,speed){
  if(!responder.edge)this.placeResponder(responder,target);
  if(length(responder.root.position,target)<7)return;
  if(length(responder.root.position,responder.edge.b)<2){
   const targetEdge=this.edges.reduce((best,e)=>closestPoint(target,e.a,e.b).distance<closestPoint(target,best.a,best.b).distance?e:best);
   const queue=[responder.edge.to],previous=new Map([[responder.edge.to,null]]);let found=false;
   for(let i=0;i<queue.length&&i<5000;i++){const id=queue[i];if(id===targetEdge.from){found=true;break}for(const edge of this.outgoing.get(id)||[])if(!previous.has(edge.to)){previous.set(edge.to,{from:id,edge});queue.push(edge.to)}}
   let next;
   if(found){let id=targetEdge.from;while(previous.get(id)){const item=previous.get(id);next=item.edge;id=item.from}}
   next=next||this.outgoing.get(responder.edge.to)?.find(e=>e.to!==responder.edge.from);
   if(!next)return;responder.edge=next;
  }
  const destination=responder.edge.b,dist=length(responder.root.position,destination);const step=Math.min(dist,speed*dt);
  const dx=(destination.x-responder.root.position.x)/(dist||1),dz=(destination.z-responder.root.position.z)/(dist||1);
  responder.root.position.x+=dx*step;responder.root.position.z+=dz*step;responder.root.rotation.y=Math.atan2(dx,dz);
 }
 update(dt,player,onIncident){this.clock+=dt;let stopped=0;
  for(const car of this.cars){if(length(car.root.position,player)>380){this.respawn(car,player);continue}let target=car.edge.b,dist=length(car.root.position,target);if(dist<2){const next=this.nextEdge(car);if(!next){this.respawn(car,player);continue}car.edge=next;target=next.b;dist=length(car.root.position,target)}
   const dx=(target.x-car.root.position.x)/(dist||1),dz=(target.z-car.root.position.z)/(dist||1);
   const obstructed=[...this.cars.filter(c=>c!==car).map(c=>c.root.position),player].some(p=>{const x=p.x-car.root.position.x,z=p.z-car.root.position.z;const ahead=x*dx+z*dz;return ahead>0&&ahead<9&&Math.abs(x*dz-z*dx)<2.1});
   const red=(this.chunk.signals||[]).some(s=>{const x=s.control.x-car.root.position.x,z=s.control.z-car.root.position.z;return s.phase!=='green'&&x*dx+z*dz>3&&x*dx+z*dz<16&&Math.abs(x*dz-z*dx)<car.edge.segment.width_m/2+2});
   const max=Math.min(car.cruise,car.edge.segment.speed_limit_kmh/3.6*.8),desired=obstructed||red?0:max;car.speed+=Math.max(-12*dt,Math.min(2.8*dt,desired-car.speed));if(desired===0)stopped++;
   const step=Math.min(dist,Math.max(0,car.speed)*dt);const nx=car.root.position.x+dx*step,nz=car.root.position.z+dz*step;
   if(this.chunk.streetSpace.inBuilding({x:nx,z:nz},1)){this.respawn(car,player);continue}
   car.root.position.x=nx;car.root.position.z=nz;if(step>.001)car.root.rotation.y=Math.atan2(dx,dz);
   if(length(car.root.position,player)<2.2&&player.speedMps>1.5)onIncident('traffic');
  }
  for(const p of this.people){if(p.hit)continue;const target=p.path[p.index],dist=length(p.root.position,target);if(dist<.25){p.index+=p.dir;if(p.index>=p.path.length||p.index<0){p.dir*=-1;p.index=Math.max(0,Math.min(p.path.length-1,p.index))}continue}const step=Math.min(dist,p.speed*dt),dx=(target.x-p.root.position.x)/dist,dz=(target.z-p.root.position.z)/dist;p.root.position.x+=dx*step;p.root.position.z+=dz*step;p.root.rotation.y=Math.atan2(dx,dz);for(const l of p.limbs){l.leg.rotation.x=Math.sin(this.clock*6+p.phase)*.4*l.side;l.arm.rotation.x=-l.leg.rotation.x*.7}
   if(length(p.root.position,player)<1.15&&player.speedMps>1){if(onIncident('pedestrian')){p.hit=true;p.root.setEnabled(false)}}
  }
  return{traffic:this.cars.length,pedestrians:this.people.filter(p=>!p.hit).length,stopped};
 }
}
