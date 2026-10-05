import test from 'node:test';
import assert from 'node:assert/strict';
import {StreetSpace} from '../src/streetGeometry.js';
import {fitsRoad,constrainToRoad,curbSegments} from '../src/roadBoundary.js';
import {routeInstruction} from '../src/routeGuidance.js';
const street=(a,b)=>({a,b,width_m:8});
const space=new StreetSpace({road_segments:[street({x:0,z:-100},{x:0,z:100}),street({x:-100,z:0},{x:100,z:0})],buildings:[]});
test('curbs stop high-speed movement without tunneling',()=>{const p=constrainToRoad(space,{x:0,z:30},{x:20,z:30});assert.ok(p.hit);assert.ok(p.x<3);assert.ok(fitsRoad(space,p))});
test('intersections remain open across the union of roads',()=>{const p=constrainToRoad(space,{x:0,z:0},{x:15,z:0});assert.equal(p.hit,false);assert.ok(Math.abs(p.x-15)<1e-8)});
test('car slides forward along a curb',()=>{const p=constrainToRoad(space,{x:2.8,z:20},{x:5,z:25});assert.ok(p.hit);assert.ok(p.z>24);assert.ok(p.x<3)});
test('curb geometry leaves crossing roads unobstructed',()=>{const curbs=curbSegments(space);assert.ok(curbs.length>0);assert.ok(curbs.every(({a,b})=>!space.onRoad({x:(a.x+b.x)/2,z:(a.z+b.z)/2},-.25)))});
test('route instructions distinguish right, left, wrong way and arrival',()=>{
 const path=[{x:0,z:0},{x:0,z:100,name:'Campus Road'},{x:100,z:100}];
 assert.match(routeInstruction(path,{x:0,z:20},0).title,/Right in 80/);
 assert.match(routeInstruction([path[0],path[1],{x:-100,z:100}],{x:0,z:20}).title,/Left/);
 assert.match(routeInstruction(path,{x:0,z:20},Math.PI).title,/Turn around/);
 assert.match(routeInstruction(path,{x:100,z:100},Math.PI/2).title,/arrived/);
 assert.equal(routeInstruction(path,{x:60,z:20}).offRoute,true);
});
