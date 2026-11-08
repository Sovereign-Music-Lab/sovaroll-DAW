import test from 'node:test';
import assert from 'node:assert/strict';
import {planControllerTimeInsertion as plan} from '../src/media/controller-time-insertion.mjs';
const clip={id:'c',type:'midi',startTick:960,lengthTicks:960,notes:[],events:[{id:'a',kind:'channel',status:176,data:[11,60],tick:100,order:0},{id:'b',kind:'channel',status:176,data:[11,90],tick:480,order:1}]};
test('Controller time insertion retains raw identity bytes and order in detached fragments',()=>{const before=structuredClone(clip),p=plan(clip,{atTick:480,lengthTicks:120});assert.equal(p.left.lengthTicks,480);assert.equal(p.right.startTick,1560);assert.equal(p.right.events[0].tick,0);assert.equal(p.right.events[0].id,'b');assert.deepEqual(p.right.events[0].data,[11,90]);assert.equal(p.right.events[0].order,1);assert.deepEqual(clip,before);});
test('Controller time insertion chases preceding nonzero state at a gap and keeps original fragment geometry separate',()=>{const p=plan(clip,{atTick:300,lengthTicks:120});assert.equal(p.right.events.find(e=>e.tick===0).data[1],60);assert.equal(p.right.events.find(e=>e.id==='b').tick,180);assert.equal(p.requiresFragmentCommit,true);assert.throws(()=>plan(clip,{atTick:961,lengthTicks:1}));assert.equal(plan(clip,{atTick:0,lengthTicks:120}).right.startTick,1080);});

import {materializeMidiCurves} from '../src/media/midi-curves.mjs';
const state=(events,tick)=>events.filter(e=>e.tick<=tick).sort((a,b)=>a.tick-b.tick||a.order-b.order).at(-1)?.data[1];
test('Paste Time curve fragments preserve every sampled Ramp and Bezier value outside the gap',()=>{
 for(const curve of [{type:'ramp'},{type:'bezier',handles:[{x:.2,value:110},{x:.8,value:10}]}]){
  const source={...structuredClone(clip),events:[{id:'ramp',kind:'channel',status:176,data:[11,0],tick:0,order:0,curve},{id:'end',kind:'channel',status:176,data:[11,100],tick:960,order:1}]};
  const original=materializeMidiCurves(source).events;
  for(const atTick of [1,240,480,959,960]){
   const p=plan(source,{atTick,lengthTicks:120}),left=materializeMidiCurves(p.left).events,right=materializeMidiCurves({...p.right,lengthTicks:Math.max(1,p.right.lengthTicks)}).events;
   for(let t=0;t<atTick;t++)assert.equal(state(left,t),state(original,t),`left ${curve.type} split ${atTick} tick ${t}`);
   for(let t=atTick;t<=960;t++)assert.equal(state([...left,...right.map(e=>({...e,tick:e.tick+atTick+120}))],t+120),state(original,t),`right ${curve.type} split ${atTick} tick ${t}`);
  }
 }
});
