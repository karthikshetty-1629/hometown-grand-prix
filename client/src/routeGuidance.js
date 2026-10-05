import {closestPoint} from './streetGeometry.js';
export function routeInstruction(path,p,heading=0){
 if(!path?.length)return{title:'Explore San Jose',detail:'Choose a destination to get turn-by-turn directions.'};
 let best={distance:Infinity};
 for(let i=0;i<path.length-1;i++){const hit=closestPoint(p,path[i],path[i+1]);if(hit.distance<best.distance)best={...hit,i}}
 if(best.i===undefined)return{title:'⚑ Destination',detail:'You have arrived.'};
 if(best.distance>25)return{title:'↩ Return to the highlighted route',detail:`Route is ${Math.round(best.distance)} m away`,offRoute:true};
 let distance=Math.hypot(path[best.i+1].x-best.x,path[best.i+1].z-best.z);
 const a=path[best.i],b=path[best.i+1],bearing=Math.atan2(b.x-a.x,b.z-a.z);
 if(Math.cos(bearing-heading)<-.4)return{title:'↩ Turn around when safe',detail:'Follow the highlighted route toward your destination.'};
 for(let i=best.i+1;i<path.length-1;i++){
  const prev=path[i-1],at=path[i],next=path[i+1];
  const before=Math.atan2(at.x-prev.x,at.z-prev.z),after=Math.atan2(next.x-at.x,next.z-at.z);
  const angle=Math.atan2(Math.sin(after-before),Math.cos(after-before));
  if(Math.abs(angle)>.5)return{title:`${angle>0?'↱ Right':'↰ Left'} in ${Math.round(distance)} m`,detail:`Onto ${at.name||'the next street'}`,turn:at};
  distance+=Math.hypot(next.x-at.x,next.z-at.z);
 }
 return{title:distance<10?'⚑ You have arrived':`↑ Continue ${Math.round(distance)} m`,detail:distance<10?'Destination reached.': 'Destination ahead',turn:path.at(-1)};
}
