import test from 'node:test';
import assert from 'node:assert/strict';
import {StreetSpace,placeCurbFeature,safeWalkways,directedLanes} from '../src/streetGeometry.js';
const road=(id,a,b)=>({id,from:id+'a',to:id+'b',a,b,width_m:10,lanes:2});
const roads=[road(1,{x:-50,z:0},{x:50,z:0}),road(2,{x:0,z:-50},{x:0,z:50})];
test('a junction signal is offset outside both roads',()=>{const space=new StreetSpace({road_segments:roads,buildings:[]});const pole=placeCurbFeature({x:0,z:0},space);assert.ok(pole);assert.ok(space.clear(pole,.6));assert.ok(Math.abs(pole.x)>5&&Math.abs(pole.z)>5)});
test('sidewalk segments crossing a road are clipped',()=>{const chunk={road_segments:roads,buildings:[],footpaths:[[{x:-30,z:8},{x:30,z:8}]]};const space=new StreetSpace(chunk);const paths=safeWalkways(chunk,space);assert.equal(paths.length,2);assert.ok(paths.flat().every(p=>!space.onRoad(p,.9)))});
test('building clearance prevents street furniture in a footprint',()=>{const space=new StreetSpace({road_segments:[],buildings:[{footprint:[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}]}]});assert.equal(space.clear({x:5,z:5}),false);assert.equal(space.clear({x:10.2,z:5},.5),false)});
test('traffic uses right lanes and honors one-way orientation',()=>{const s=road(1,{x:0,z:0},{x:0,z:100});let lanes=directedLanes([s]);assert.equal(lanes.length,2);assert.ok(lanes[0].a.x>0);assert.ok(lanes[1].a.x<0);lanes=directedLanes([{...s,oneway:true,travel:-1}]);assert.equal(lanes.length,1);assert.equal(lanes[0].from,s.to);assert.equal(lanes[0].dz,-1)});

test('large buildings collide even far from their centroid',async()=>{const {buildBuildingColliders,resolveBuildingCollisions}=await import('../src/collision.js');const colliders=buildBuildingColliders([{footprint:[{x:0,z:0},{x:90,z:0},{x:90,z:30},{x:0,z:30}]}]);const result=resolveBuildingCollisions(.5,15,1,colliders);assert.equal(result.hit,true);assert.ok(result.x<=-1)});
