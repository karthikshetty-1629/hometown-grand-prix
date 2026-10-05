import test from 'node:test';
import assert from 'node:assert/strict';
import { TrafficRules } from '../src/trafficRules.js';
test('sustained speeding starts a pursuit; pulling over adds one citation',()=>{const r=new TrafficRules();for(let i=0;i<31;i++)r.update(.1,{speed:20,limit:30});assert.equal(r.wanted,true);for(let i=0;i<31;i++)r.update(.1,{speed:0,limit:30});assert.equal(r.wanted,false);assert.equal(r.penalty,10);for(let i=0;i<50;i++)r.update(.1,{speed:0,limit:30});assert.equal(r.penalty,10)});
test('escaping requires clean driving and separation',()=>{const r=new TrafficRules();r.incident('building');for(let i=0;i<110;i++)r.update(.1,{speed:5,limit:30,policeDistance:50});assert.equal(r.wanted,false);assert.equal(r.penalty,5)});
test('collision cooldown avoids per-frame penalties',()=>{const r=new TrafficRules();r.incident('pedestrian');r.incident('pedestrian');assert.equal(r.penalty,20);assert.equal(r.incidents,1);r.update(4,{speed:2,limit:30});r.incident('building');assert.equal(r.penalty,25)});
test('brief speeding does not trigger pursuit',()=>{const r=new TrafficRules();r.update(2,{speed:20,limit:30});r.update(1,{speed:2,limit:30});assert.equal(r.wanted,false);assert.equal(r.speeding,0)});
