import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openCoreMidi} from '../macos/client.mjs';
import {compileMidiStreams} from '../../src/media/midi-stream.mjs';
import {adjustMidiStreamLengths} from '../../src/media/midi-length-adjustment.mjs';
import {chaseMidiStreams} from '../../src/media/midi-chase.mjs';
import {compileTempoMap} from '../../src/media/time.mjs';
const word=b=>(0x20000000|(b[0]<<16)|((b[1]??0)<<8)|(b[2]??0))>>>0;
async function fixture(t){const receiver=await openCoreMidi({testReceiver:true}),sender=await openCoreMidi(),name='newdaw-length-'+randomUUID(),endpoint=await receiver.request('test.createReceiver',{name}),sent=[],received=[];sender.events.on('transmitted',e=>sent.push(e));receiver.events.on('received',e=>received.push(e));t.after(async()=>{await sender.close();await receiver.close();});return{sender,endpoint,sent,words(){const own=new Set(sent.map(e=>e.hostTime));return received.filter(e=>e.receiver===name).flatMap(e=>e.packets.filter(p=>own.has(p.timestamp)).flatMap(p=>p.words));}};}
async function wait(fn){for(let i=0;i<300;i++){if(await fn())return;await delay(5);}assert.fail('Length wire timeout');}
function data(){const p={ppq:960,tempoMap:[{tick:0,bpm:120}],tracks:[{id:'t',type:'midi'}],clips:[{id:'c',trackId:'t',type:'midi',startTick:0,lengthTicks:400,notes:[{id:'a',startTick:0,durationTicks:200,pitch:60,channel:2,velocity:90,releaseVelocity:30},{id:'b',startTick:200,durationTicks:100,pitch:60,channel:2,velocity:80,releaseVelocity:40}]}]};return{p,stream:adjustMidiStreamLengths(compileMidiStreams(p),{projectPpq:960,displayPpq:480,lengthAdjustmentTicks:20})};}
async function schedule(x,p,events,startTick=0){const timeline=compileTempoMap(p.tempoMap,p.ppq),jobId=randomUUID(),origin=timeline.tickToSeconds(startTick),plan=events.map(e=>({offsetNs:Math.round((timeline.tickToSeconds(e.tick)-origin)*1e9),destinationId:x.endpoint.id,bytes:[e.status,...e.data]}));await x.sender.request('transport.prepare',{jobId,durationNs:Math.round((timeline.tickToSeconds(400)-origin)*1e9),eventCount:plan.length,destinations:[x.endpoint.id]});await x.sender.request('transport.append',{jobId,events:plan});await x.sender.start(jobId);await wait(async()=>(await x.sender.transportStatus()).transport.status==='completed');return plan;}
test('Length wire: adjusted endpoints reach actual CoreMIDI before retrigger with preserved release velocities',async t=>{
 const x=await fixture(t),{p,stream}=data(),before=structuredClone(p);const plan=await schedule(x,p,stream.tracks[0].events);await wait(()=>x.words().length===5);assert.deepEqual(x.words(),[[146,60,90],[130,60,30],[146,60,80],[130,60,40],[178,120,0]].map(word));assert.equal(plan[1].offsetNs,Math.round(160/1920*1e9));assert.equal(plan[2].offsetNs,Math.round(200/1920*1e9));assert.ok(plan[1].offsetNs<plan[2].offsetNs);assert.deepEqual(p,before);
});
test('Length wire: Chase in the adjusted gap does not send the expired held note or its obsolete paired off',async t=>{
 const x=await fixture(t),{p,stream}=data(),prefix=chaseMidiStreams(stream,p,{tick:180}).tracks[0].events;assert.deepEqual(prefix,[]);const future=stream.tracks[0].events.filter(e=>e.tick>=180);await schedule(x,p,[...prefix,...future],180);await wait(()=>x.words().length===3);assert.deepEqual(x.words(),[[146,60,80],[130,60,40],[178,120,0]].map(word));
});
