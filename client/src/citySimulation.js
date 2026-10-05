import { CityLife } from './cityLife.js';
import { MeshBuilder, StandardMaterial, Color3, TransformNode } from '@babylonjs/core';
import { createCarMesh } from './carMesh.js';
import { TrafficRules } from './trafficRules.js';
import { driveSession } from './routePicker.js';
import { resolveBuildingCollisions } from './collision.js';
export class CitySimulation {
 constructor(scene,chunk,car,recorder){
  this.chunk=chunk;this.car=car;this.recorder=recorder;this.rules=new TrafficRules();this.ambulanceTime=0;this.responders=[];
  const mat=(name,color)=>{const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(color);return m};
  for(const kind of ['police','ambulance']){const root=createCarMesh(scene,{name:kind,bodyColor:Color3.FromHexString(kind==='police'?'#172530':'#edf2e7')});if(kind==='ambulance'){const box=MeshBuilder.CreateBox('ambulanceBox',{width:1.9,height:1.3,depth:2.7},scene);box.parent=root;box.position.set(0,1.2,-.4);box.material=mat('medical-white','#edf2e7');const stripe=MeshBuilder.CreateBox('medical-stripe',{width:1.96,height:.23,depth:2.75},scene);stripe.parent=root;stripe.position.set(0,1.3,-.4);stripe.material=mat('medical-red','#ed634e')}
   const lamps=[];for(const side of [-1,1]){const lamp=MeshBuilder.CreateBox(kind+'-beacon',{width:.45,height:.17,depth:.35},scene);lamp.parent=root;lamp.position.set(side*.35,kind==='police'?1.32:1.94,0);lamp.material=mat(kind+side,side<0?'#ff3d4e':'#4d8cff');lamps.push(lamp)}root.setEnabled(false);this.responders.push({kind,root,lamps});
  }
  this.life = new CityLife(scene, chunk);
  this.panel=document.createElement('div');this.panel.className='enforcement';this.panel.innerHTML='<strong>◈ READY TO DRIVE</strong><p>Waiting at the starting line.</p>';document.body.append(this.panel);
  this.mini=document.createElement('canvas');this.mini.className='mini-map';this.mini.width=this.mini.height=220;document.body.append(this.mini);this.miniTick=0;
  const tools=document.createElement('div');tools.className='game-tools';tools.innerHTML='<button id="return-city">← Leave drive</button><button id="recover-car">Reset car +5s</button>';document.body.append(tools);tools.querySelector('#return-city').onclick=()=>location.reload();tools.querySelector('#recover-car').onclick=()=>{car.position.set(chunk.start.x,0,chunk.start.z);car.heading=Math.atan2(chunk.start.dirX,chunk.start.dirZ);car.speed=0;this.rules.penalty+=5;this.recorder.addPenalty(5);this.rules.message='Returned to start · +5s'};
 }
 update(dt,state,road){const rules=this.rules,police=this.responders[0];const wasWanted=rules.wanted;const oldPenalty=rules.penalty;const oldIncidents=rules.incidents;rules.update(dt,{speed:state.speedMps,limit:road?.segment.speed_limit_kmh,collided:state.collided,policeDistance:Math.hypot(police.root.position.x-state.x,police.root.position.z-state.z)});
  if(state.collided && state.speedMps>10 && rules.incidents>oldIncidents){this.ambulanceTime=18;this.incident={x:state.x,z:state.z};rules.message='Major collision · emergency response dispatched · +5s'}
  const activity = this.life.update(dt,state,kind=>{
    const accepted=rules.incident(kind);
    if(accepted){this.car.speed*=.2;if(kind==='pedestrian'){this.ambulanceTime=18;this.incident={x:state.x,z:state.z}}}
    return accepted;
  });
  if(rules.wanted&&!wasWanted){this.life.placeResponder(police,state);police.root.setEnabled(true)}
  if(rules.penalty!==oldPenalty)this.recorder.addPenalty(rules.penalty-oldPenalty);
  this.ambulanceTime=Math.max(0,this.ambulanceTime-dt);
  for(const r of this.responders){const active=r.kind==='police'?rules.wanted:this.ambulanceTime>0;if(active&&!r.root.isEnabled())this.life.placeResponder(r,state,65);r.root.setEnabled(active);if(!active)continue;const target=r.kind==='police'?state:this.incident;this.life.moveResponder(r,target,dt,r.kind==='police'?13:10);for(let i=0;i<r.lamps.length;i++)r.lamps[i].material.emissiveColor=r.lamps[i].material.diffuseColor.scale(Math.floor(rules.time*7+i)%2?1:.12)}
  this.panelTick=(this.panelTick||0)+dt;
  if(this.panelTick>.2){this.panelTick=0;this.panel.classList.toggle('hot',rules.wanted);this.panel.innerHTML=`<strong>${rules.wanted?'◈ PURSUIT ACTIVE':'◈ CLEAR TO DRIVE'}</strong><p>${rules.message}</p><p class="city-activity">${activity.traffic} moving cars · ${activity.pedestrians} pedestrians<br>${activity.stopped ? activity.stopped+' vehicles yielding / at signals' : 'Traffic flowing'} · simulated</p><p>Penalties <b>+${rules.penalty}s</b> &nbsp; · &nbsp; Incidents ${rules.incidents}</p>${rules.wanted?`<p>Stop to pull over: ${Math.min(3,rules.stopped).toFixed(1)} / 3s<br>Escape: ${Math.min(10,rules.clean).toFixed(1)} / 10s clean</p>`:''}${this.ambulanceTime?'<p>✚ Emergency unit responding</p>':''}`;
  }
  this.miniTick+=dt;if(this.miniTick>.12){this.miniTick=0;this.drawMini(state)}
 }
 drawMini(state){const c=this.mini.getContext('2d');c.clearRect(0,0,220,220);c.fillStyle='#15201bee';c.fillRect(0,0,220,220);const project=p=>[110+(p.x-state.x)*.6,110-(p.z-state.z)*.6];c.strokeStyle='#647558';c.lineWidth=2;c.beginPath();for(const s of this.chunk.road_segments){if(Math.hypot(s.a.x-state.x,s.a.z-state.z)>300)continue;c.moveTo(...project(s.a));c.lineTo(...project(s.b))}c.stroke();
 if(this.chunk.navigation_path?.length){c.strokeStyle='#cffa53';c.lineWidth=4;c.lineJoin='round';c.beginPath();this.chunk.navigation_path.forEach((p,i)=>{const xy=project(p);if(i)c.lineTo(...xy);else c.moveTo(...xy)});c.stroke();
 c.strokeStyle='#243c28';c.lineWidth=2;
 for(let i=1;i<this.chunk.navigation_path.length;i++){const a=this.chunk.navigation_path[i-1],b=this.chunk.navigation_path[i],len=Math.hypot(b.x-a.x,b.z-a.z);if(len<18)continue;const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len;
 for(let t=15;t<len;t+=40){const [x,y]=project({x:a.x+dx*t,z:a.z+dz*t});if(x<0||x>220||y<0||y>220)continue;c.beginPath();c.moveTo(x-dx*5-dz*3,y+dz*5-dx*3);c.lineTo(x,y);c.lineTo(x-dx*5+dz*3,y+dz*5+dx*3);c.stroke()}}
 if(this.nextTurn){c.fillStyle='#fff';c.beginPath();c.arc(...project(this.nextTurn),6,0,Math.PI*2);c.fill()}}
 if(driveSession.mode==='race'){const p=project(this.chunk.checkpoints[0]);c.fillStyle='#fff';c.fillRect(Math.max(5,Math.min(205,p[0]))-4,Math.max(5,Math.min(205,p[1]))-4,8,8)}for(const r of this.responders)if(r.root.isEnabled()){c.fillStyle=r.kind==='police'?'#ff7463':'#fff';c.beginPath();c.arc(...project(r.root.position),4,0,Math.PI*2);c.fill()}c.save();c.translate(110,110);c.rotate(this.car.heading);c.fillStyle='#d5fc51';c.beginPath();c.moveTo(0,-8);c.lineTo(-5,6);c.lineTo(5,6);c.closePath();c.fill();c.restore();c.fillStyle='#d5fc51';c.font='11px sans-serif';c.fillText('N ↑',10,18)}
}
