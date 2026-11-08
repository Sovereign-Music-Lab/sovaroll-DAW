import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openCoreMidi} from '../macos/client.mjs';
import {compileMidiReset} from '../macos/reset-policy.mjs';
const preferences=(resetOnStop=true,neverResetChasedControllers=false)=>({resetOnStop,neverResetChasedControllers});
const word=b=>(0x20000000|(b[0]<<16)|((b[1]??0)<<8)|(b[2]??0))>>>0;
const expected=(id,reason='manual',prefs=preferences())=>compileMidiReset({reason,preferences:prefs,destinations:[id]}).batches.flatMap(b=>b.messages).map(word);
async function fixture(t){
 const receiver=await openCoreMidi({testReceiver:true}),sender=await openCoreMidi(),name='newdaw-reset-transaction-'+randomUUID(),destination=await receiver.request('test.createReceiver',{name}),sent=[],received=[];
 sender.events.on('transmitted',e=>sent.push(e));receiver.events.on('received',e=>received.push(e));
 t.after(async()=>{await sender.close();await receiver.close();});
 const words=()=>{const stamps=new Set(sent.map(e=>e.hostTime));return received.filter(e=>e.receiver===name).flatMap(e=>e.packets.filter(p=>stamps.has(p.timestamp)).flatMap(p=>p.words));};
 const wait=async fn=>{for(let i=0;i<400;i++){if(await fn())return;await delay(5);}assert.fail('Reset transaction receiver timed out: '+JSON.stringify({sent,words:words().length}));};
 const prepare=async({prefs,durationNs=1000000000,events=[]}={})=>{const jobId=randomUUID();await sender.request('transport.prepare',{jobId,durationNs,eventCount:events.length,destinations:[destination.id],...(prefs?{resetPreferences:prefs}:{})});if(events.length)await sender.request('transport.append',{jobId,events:events.map(e=>({...e,destinationId:destination.id}))});return jobId;};
 const reset=async(patch={})=>{const s=await sender.transportStatus();return sender.reset({reason:'manual',preferences:preferences(),destinations:[destination.id],expectedJobId:s.transport.jobId??null,expectedPreparedJobId:s.preparedJobId,...patch});};
 return{receiver,sender,name,destination,sent,words,wait,prepare,reset};
}

test('Reset transaction: one native request delivers all16 channels exactly and clears owned-note state',async t=>{
 const x=await fixture(t);await x.sender.send(x.destination.id,[[145,63,90]]);const r=await x.reset({preferences:preferences(false,true)});assert.equal(r.status,'reset');assert.equal(r.results[0].messages,2096);await x.wait(()=>x.words().length===2097);assert.deepEqual(x.words().slice(1),expected(x.destination.id));assert.equal(x.sent.length,2);await x.sender.release(x.destination.id);assert.equal(x.sent.length,2);assert.equal(r.cleanupErrors.length,0);
});
test('Reset transaction: active future queue is canceled before Reset and prepared successor is discarded',async t=>{
 const x=await fixture(t),id=await x.prepare({events:[{offsetNs:0,bytes:[144,60,90]},{offsetNs:300000000,bytes:[144,81,90]}]});await x.sender.start(id);await x.wait(()=>x.words().length===1);const draft=await x.prepare();const r=await x.reset();assert.equal(r.transport.status,'stopped');assert.equal(r.discardedJobId,draft);assert.equal((await x.sender.transportStatus()).preparedJobId,null);await assert.rejects(x.sender.start(draft),{code:'NATIVE_JOB_CONFLICT'});await x.wait(()=>x.words().length===2099);await delay(350);assert.deepEqual(x.words().slice(0,3),[[144,60,90],[128,60,0],[176,120,0]].map(word));assert.deepEqual(x.words().slice(3),expected(x.destination.id));assert.equal(x.words().includes(word([144,81,90])),false);
});
test('Reset transaction: stale active and prepared guards preserve playback and pending draft without output',async t=>{
 const x=await fixture(t),id=await x.prepare();await x.sender.start(id);const draft=await x.prepare();for(const patch of [{expectedJobId:'old'},{expectedPreparedJobId:null}])await assert.rejects(x.reset(patch),{code:'NATIVE_JOB_CONFLICT'});const s=await x.sender.transportStatus();assert.equal(s.transport.status,'playing');assert.equal(s.transport.jobId,id);assert.equal(s.preparedJobId,draft);assert.deepEqual(x.sent,[]);await x.sender.stop(id);await x.sender.request('transport.discard',{jobId:draft});
});
test('Reset transaction: invalid second destination preflights before any cancellation or first-port Reset',async t=>{
 const x=await fixture(t),other=await x.receiver.request('test.createReceiver',{name:x.name+'-removed'});await x.receiver.request('test.removeReceiver',{name:x.name+'-removed'});const id=await x.prepare();await x.sender.start(id);await assert.rejects(x.reset({destinations:[x.destination.id,other.id]}),{code:'COREMIDI_ERROR'});assert.equal((await x.sender.transportStatus()).transport.status,'playing');assert.deepEqual(x.sent,[]);await x.sender.stop(id);
});
test('Reset transaction: malformed policies guards reasons and destinations reject without modifying a prepared job',async t=>{
 const x=await fixture(t),draft=await x.prepare();
 for(const patch of [{preferences:null},{preferences:{resetOnStop:1,neverResetChasedControllers:false}},{preferences:{resetOnStop:true}},{preferences:{...preferences(),unknown:true}},{reason:'record-end'},{reason:'shutdown'},{expectedJobId:12},{expectedPreparedJobId:''},{destinations:[]},{destinations:[x.destination.id,x.destination.id]},{destinations:[true]},{destinations:[2147483648]},{unexpected:true}])await assert.rejects(x.reset(patch));
 assert.equal((await x.sender.transportStatus()).preparedJobId,draft);assert.deepEqual(x.sent,[]);await x.sender.request('transport.discard',{jobId:draft});
});
test('Reset transaction: queued successor cannot start between future cancellation and Reset completion',async t=>{
 const x=await fixture(t),draft=await x.prepare({events:[{offsetNs:0,bytes:[144,82,90]}]}),s=await x.sender.transportStatus();
 const results=await Promise.allSettled([x.sender.reset({reason:'manual',preferences:preferences(),destinations:[x.destination.id],expectedJobId:null,expectedPreparedJobId:s.preparedJobId}),x.sender.start(draft),x.sender.send(x.destination.id,[[192,7]])]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason.code,'NATIVE_JOB_CONFLICT');assert.equal(results[2].status,'fulfilled');await x.wait(()=>x.words().length===2097);assert.deepEqual(x.words(),[...expected(x.destination.id),word([192,7])]);
});
test('Reset transaction: Stop uses frozen explicit policy and repeated Stop cannot emit a second Reset',async t=>{
 const x=await fixture(t),id=await x.prepare({prefs:preferences(),events:[{offsetNs:0,bytes:[146,64,90]}]});await x.sender.start(id);await x.wait(()=>x.words().length===1);const stopped=await x.sender.stop(id);assert.equal(stopped.reset.reason,'stop');assert.equal(stopped.reset.resetControllers,true);await x.wait(()=>x.words().length===2099);assert.deepEqual(x.words().slice(3),expected(x.destination.id,'stop'));assert.deepEqual(await x.sender.stop(id),stopped);assert.equal(x.sent.length,3);
});
test('Reset transaction: Stop can use newly enabled NeverReset preference instead of stale play-time preference',async t=>{
 const x=await fixture(t),id=await x.prepare({prefs:preferences()});await x.sender.start(id);const r=await x.sender.stop(id,{resetPreferences:preferences(true,true)});assert.equal(r.reset.resetControllers,false);await x.wait(()=>x.words().length===2080);assert.deepEqual(x.words(),expected(x.destination.id,'stop',preferences(true,true)));
});
test('Reset transaction: disabled automatic Stop keeps owned release and transmits no controller Reset',async t=>{
 const x=await fixture(t),id=await x.prepare({prefs:preferences(false,false),events:[{offsetNs:0,bytes:[147,65,90]}]});await x.sender.start(id);await x.wait(()=>x.words().length===1);const r=await x.sender.stop(id);assert.equal(r.reset.requested,false);await x.wait(()=>x.words().length===3);assert.deepEqual(x.words(),[[147,65,90],[131,65,0],[179,120,0]].map(word));
});
test('Reset transaction: natural end applies ResetOnStop once after owned-note cleanup',async t=>{
 const x=await fixture(t),id=await x.prepare({prefs:preferences(),durationNs:80000000,events:[{offsetNs:0,bytes:[144,66,90]}]});await x.sender.start(id);await x.wait(async()=>(await x.sender.transportStatus()).transport.status==='completed');await x.wait(()=>x.words().length===2099);const r=(await x.sender.transportStatus()).transport;assert.equal(r.reset.reason,'stop');assert.deepEqual(x.words().slice(3),expected(x.destination.id,'stop'));await x.sender.stop(id);assert.equal(x.sent.length,3);
});
test('Reset transaction: Locate follows NeverReset even when ResetOnStop is disabled',async t=>{
 const x=await fixture(t);for(const never of [true,false]){const before=x.words().length,id=await x.prepare({prefs:preferences(false,never)});await x.sender.start(id);const r=await x.sender.stop(id,{reason:'locate'});assert.equal(r.reset.resetControllers,!never);const desired=expected(x.destination.id,'locate',preferences(false,never));await x.wait(()=>x.words().length===before+desired.length);assert.deepEqual(x.words().slice(before),desired);}
});
test('Reset transaction: shutdown and failure Stop preserve controller state despite automatic policy',async t=>{
 const x=await fixture(t);for(const reason of ['shutdown','failure']){const before=x.words().length,id=await x.prepare({prefs:preferences(),events:[{offsetNs:0,bytes:[144,67,90]}]});await x.sender.start(id);await x.wait(()=>x.words().length===before+1);const r=await x.sender.stop(id,{reason});assert.equal(r.reset.requested,false);await x.wait(()=>x.words().length===before+3);assert.deepEqual(x.words().slice(before),[[144,67,90],[128,67,0],[176,120,0]].map(word));}
});
test('Reset transaction: invalid Stop override does not stop current playback or change its frozen policy',async t=>{
 const x=await fixture(t),id=await x.prepare({prefs:preferences()});await x.sender.start(id);for(const patch of [{reason:'record-end'},{reason:false},{resetPreferences:{resetOnStop:true}}])await assert.rejects(x.sender.stop(id,patch));assert.equal((await x.sender.transportStatus()).transport.status,'playing');assert.deepEqual(x.sent,[]);assert.equal((await x.sender.stop(id)).reset.resetControllers,true);await x.wait(()=>x.words().length===2096);
});
test('Reset transaction: stale failed transport diagnostics do not contaminate a later idle Reset',async t=>{
 const x=await fixture(t),name=x.name+'-lost',lost=await x.receiver.request('test.createReceiver',{name}),id=randomUUID();await x.sender.request('transport.prepare',{jobId:id,durationNs:1000000000,eventCount:1,destinations:[lost.id],resetPreferences:preferences()});await x.sender.request('transport.append',{jobId:id,events:[{offsetNs:0,destinationId:lost.id,bytes:[144,60,90]}]});await x.sender.start(id);await x.wait(()=>x.sent.length===1);await x.receiver.request('test.removeReceiver',{name});await x.wait(async()=>(await x.sender.transportStatus()).transport.status==='failed');const prior=(await x.sender.transportStatus()).transport;assert.ok(prior.cleanupErrors.length);const r=await x.reset();assert.equal(r.status,'reset');assert.deepEqual(r.cleanupErrors,[]);await x.wait(()=>x.words().length===2096);
});
