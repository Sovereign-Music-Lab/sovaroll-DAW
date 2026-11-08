import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {compileMidiReset} from '../macos/reset-policy.mjs';
import {openCoreMidi} from '../macos/client.mjs';
const options=(reason='manual',resetOnStop=true,neverResetChasedControllers=false,destinations=[42])=>({reason,destinations,preferences:{resetOnStop,neverResetChasedControllers}});
const word=b=>(0x20000000|(b[0]<<16)|((b[1]??0)<<8)|(b[2]??0))>>>0;
const expectedChannel=(channel,controllers)=>[...Array.from({length:128},(_,pitch)=>[0x80|channel,pitch,0]),[0xb0|channel,123,0],[0xb0|channel,120,0],...(controllers?[[0xb0|channel,121,0]]:[])];

test('Reset policy: manual Reset covers every pitch on all16 channels independently of automatic preferences',()=>{
 for(const on of [false,true])for(const never of [false,true]){const p=compileMidiReset(options('manual',on,never));assert.equal(p.requested,true);assert.equal(p.resetControllers,true);assert.equal(p.messageCount,2096);assert.equal(p.batches.length,16);for(let c=0;c<16;c++)assert.deepEqual(p.batches[c],{destinationId:42,channel:c,messages:expectedChannel(c,true)});}
});
test('Reset policy: disabled ResetOnStop emits no automatic reset but still requires owned-note cleanup',()=>{
 for(const never of [false,true]){const p=compileMidiReset(options('stop',false,never));assert.equal(p.requested,false);assert.equal(p.resetControllers,false);assert.equal(p.messageCount,0);assert.deepEqual(p.batches,[]);assert.equal(p.cleanupRequired,true);}
});
test('Reset policy: NeverReset suppresses CC121 on automatic Stop while note termination remains complete',()=>{
 const p=compileMidiReset(options('stop',true,true));assert.equal(p.resetControllers,false);assert.equal(p.messageCount,2080);for(let c=0;c<16;c++)assert.deepEqual(p.batches[c].messages,expectedChannel(c,false));assert.ok(p.batches.flatMap(b=>b.messages).every(m=>m[0]>>4===8||[120,123].includes(m[1])));
});
test('Reset policy: normal automatic Stop includes controller reset after offs on every channel',()=>{
 const p=compileMidiReset(options('stop',true,false));assert.equal(p.resetControllers,true);for(const b of p.batches){assert.equal(b.messages.at(-1)[1],121);assert.ok(b.messages.slice(0,128).every(m=>m[0]>>4===8));}
});
test('Reset policy: Locate follows NeverReset independently from ResetOnStop',()=>{
 for(const on of [false,true])for(const never of [false,true]){const p=compileMidiReset(options('locate',on,never));assert.equal(p.requested,true);assert.equal(p.resetControllers,!never);assert.deepEqual(p.batches[7].messages,expectedChannel(7,!never));}
});
test('Reset policy: shutdown and failure never escalate owned cleanup into all-channel controller Reset',()=>{
 for(const reason of ['shutdown','failure']){const p=compileMidiReset(options(reason,true,false,[]));assert.equal(p.requested,false);assert.equal(p.cleanupRequired,true);assert.deepEqual(p.batches,[]);}
});
test('Reset policy: unknown fields malformed destinations incomplete preferences and unsupported record end reject',()=>{
 for(const patch of [{reason:'record-end'},{reason:'panic',extra:true},{destinations:['42']},{destinations:Array(1)},{destinations:[undefined]},{destinations:[NaN]},{destinations:[42,42]},{destinations:[true]},{destinations:[2147483648]},{destinations:Array.from({length:65},(_,i)=>i)},{preferences:{resetOnStop:true}},{preferences:{resetOnStop:true,neverResetChasedControllers:0}},{preferences:{resetOnStop:true,neverResetChasedControllers:false,controllers:true}}])assert.throws(()=>compileMidiReset({...options(),...patch}));assert.throws(()=>compileMidiReset(options('manual',true,false,[])),{code:'MIDI_RESET_DESTINATIONS'});assert.equal(compileMidiReset(options('stop',false,false,[])).requested,false);
});
test('Reset policy: outputs detach inputs preserve destination order and never synthesize patch volume pan or system reset',()=>{
 const input=options('manual',true,false,[-2147483648,2147483647]),before=structuredClone(input),p=compileMidiReset(input);assert.deepEqual(input,before);assert.deepEqual(p.destinations,input.destinations);p.preferences.resetOnStop=false;p.destinations[0]=0;p.batches[0].messages[0][1]=127;assert.deepEqual(input,before);const messages=compileMidiReset(input).batches.flatMap(b=>b.messages);assert.ok(messages.every(m=>m[0]>>4===8||m[0]>>4===11&&[120,121,123].includes(m[1])));assert.equal(compileMidiReset(input).batches[0].messages[0][1],0);
});
async function setup(t){
 const receiver=await openCoreMidi({testReceiver:true}),sender=await openCoreMidi(),name='newdaw-reset-'+randomUUID(),endpoint=await receiver.request('test.createReceiver',{name}),sent=[],received=[];
 sender.events.on('transmitted',e=>sent.push(e));receiver.events.on('received',e=>received.push(e));t.after(async()=>{await sender.close();await receiver.close();});
 const words=()=>{const stamps=new Set(sent.map(e=>e.hostTime));return received.filter(e=>e.receiver===name).flatMap(e=>e.packets.filter(p=>stamps.has(p.timestamp)).flatMap(p=>p.words));};
 const wait=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await delay(5);}assert.fail('Reset receiver timed out: '+JSON.stringify({sent:sent.length,words:words().length}));};
 // This test fixture serializes its own stopped helper. Product owner integration
 // and native atomic endpoint capture are deliberately not claimed by this loop.
 const sendPlan=async plan=>{for(const b of plan.batches)await sender.send(b.destinationId,b.messages);};
 return{receiver,sender,endpoint,name,sent,words,wait,sendPlan};
}
test('Reset wire: manual all-channel plan actually crosses CoreMIDI without truncation or reordered note-offs',async t=>{
 const x=await setup(t),p=compileMidiReset(options('manual',false,true,[x.endpoint.id]));await x.sendPlan(p);await x.wait(()=>x.words().length===2096);assert.deepEqual(x.words(),Array.from({length:16},(_,c)=>expectedChannel(c,true)).flat().map(word));assert.equal(x.sent.length,16);
});
test('Reset wire: NeverReset Stop has actual note termination with no CC121 pressure or pitch-bend reset',async t=>{
 const x=await setup(t);await x.sender.send(x.endpoint.id,[[0xb4,64,127],[0xd4,80],[0xe4,0,72],[0x94,60,90],[0x94,60,100]]);const p=compileMidiReset(options('stop',true,true,[x.endpoint.id]));await x.sendPlan(p);await x.wait(()=>x.words().length===2085);assert.deepEqual(x.words().slice(5),Array.from({length:16},(_,c)=>expectedChannel(c,false)).flat().map(word));assert.equal(x.words().slice(5).some(w=>((w>>>16)&240)===0xd0||((w>>>16)&240)===0xe0||((w>>>16)&240)===0xb0&&((w>>>8)&127)===121),false);
});
test('Reset wire: cancel native future events before manual reset and do not transmit the future note',async t=>{
 const x=await setup(t),jobId=randomUUID();await x.sender.request('transport.prepare',{jobId,durationNs:500000000,eventCount:2,destinations:[x.endpoint.id]});await x.sender.request('transport.append',{jobId,events:[{offsetNs:0,destinationId:x.endpoint.id,bytes:[144,60,90]},{offsetNs:300000000,destinationId:x.endpoint.id,bytes:[144,80,90]}]});await x.sender.start(jobId);await x.wait(()=>x.words().includes(word([144,60,90])));await assert.rejects(x.sender.send(x.endpoint.id,[[176,121,0]]),{code:'NATIVE_PLAYING'});await x.sender.stop(jobId);await x.sendPlan(compileMidiReset(options('manual',true,false,[x.endpoint.id])));await x.wait(()=>x.words().length===2099);await delay(320);assert.equal(x.words().includes(word([144,80,90])),false);assert.deepEqual(x.words().slice(0,3),[[144,60,90],[128,60,0],[176,120,0]].map(word));
});
test('Reset wire: disabled automatic Reset sends nothing while backend owned-note release remains effective',async t=>{
 const x=await setup(t);await x.sender.send(x.endpoint.id,[[147,65,90]]);await x.sendPlan(compileMidiReset(options('stop',false,false,[x.endpoint.id])));await x.sender.release(x.endpoint.id);await x.wait(()=>x.words().length===3);assert.deepEqual(x.words(),[[147,65,90],[131,65,0],[179,120,0]].map(word));
});
test('Reset wire: missing destination fails explicitly without fallback to another receiver',async t=>{
 const x=await setup(t);await x.receiver.request('test.removeReceiver',{name:x.name});await x.receiver.request('test.createReceiver',{name:x.name+'-replacement'});const p=compileMidiReset(options('manual',true,false,[x.endpoint.id]));await assert.rejects(x.sendPlan(p),{code:'COREMIDI_ERROR'});assert.deepEqual(x.sent,[]);
});
