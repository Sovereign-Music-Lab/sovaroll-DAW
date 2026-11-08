import test from 'node:test';
import assert from 'node:assert/strict';
import {buildControllerReadoutIndex,queryControllerReadout,formatPitchBendValue,createControllerReadoutCache} from '../src/media/controller-readout.mjs';
import {splitMidiCurves,materializeMidiCurves} from '../src/media/midi-curves.mjs';
const pb=(id,tick,value,{channel=0,order=tick,curve}={})=>({id,kind:'channel',status:0xe0|channel,data:[value&127,value>>7],tick,order,...(curve?{curve}:{})});
const cc=(id,tick,value,{channel=0,order=tick,controller=11,curve}={})=>({id,kind:'channel',status:0xb0|channel,data:[controller,value],tick,order,...(curve?{curve}:{})});
const clip=(events,{startTick=1000,lengthTicks=100,id='clip'}={})=>({id,type:'midi',trackId:'track',startTick,lengthTicks,notes:[],events});
const bend={kind:'pitchBend',channel:0};
const query=(index,projectTick,lane=bend)=>queryControllerReadout(index,{projectTick,lane});

test('pitchbend raw display is signed at both 14-bit endpoints and center',()=>{
 assert.deepEqual([0,8191,8192,8193,16383].map(v=>formatPitchBendValue(v).text),['-8192','-1','0','+1','+8191']);
 for(const v of [0,8191,8192,8193,16383]){const value=formatPitchBendValue(v);assert.equal(value.raw,v);assert.equal(value.signed,v-8192);assert.equal(value.mode,'raw');}
});

test('semitone/cents formatting uses asymmetric configured ranges without changing raw values',()=>{
 const positive=formatPitchBendValue(12288,{enabled:true,up:12,down:2}),negative=formatPitchBendValue(4096,{enabled:true,up:12,down:2});
 assert.equal(positive.semitones,6);assert.equal(positive.text,'+6 st 0 ct');assert.equal(negative.semitones,-1);assert.equal(negative.text,'-1 st 0 ct');
 assert.equal(formatPitchBendValue(4096,{enabled:true,up:96,down:1}).text,'0 st -50 ct');
 assert.equal(formatPitchBendValue(0,{enabled:true,up:1,down:96}).text,'-96 st 0 ct');
});

test('cent ties round symmetrically away from zero and carry without negative zero',()=>{
 assert.equal(formatPitchBendValue(8192+1024,{enabled:true,up:1,down:1}).totalCents,13);
 assert.equal(formatPitchBendValue(8192-1024,{enabled:true,up:1,down:1}).totalCents,-13);
 for(const raw of [8191,8192,8193]){const f=formatPitchBendValue(raw,{enabled:true,up:1,down:1});assert.equal(f.text,'0 st 0 ct');for(const key of ['totalCents','wholeSemitones','cents','roundedSemitones'])assert.equal(Object.is(f[key],-0),false);}
 const top=formatPitchBendValue(16383,{enabled:true,up:2,down:2});assert.equal(top.semitones,8191*2/8192);assert.equal(top.totalCents,200);assert.equal(top.text,'+2 st 0 ct');
 const wide=formatPitchBendValue(16383,{enabled:true,up:96,down:96});assert.equal(wide.text,'+95 st +99 ct');assert.equal(wide.totalCents,9599);
});

test('formatters reject out-of-range or noninteger MIDI values and malformed grid settings',()=>{
 for(const raw of [-1,16384,0.5,NaN,Infinity,'8192'])assert.throws(()=>formatPitchBendValue(raw),{code:'INVALID_CONTROLLER_READOUT'});
 for(const grid of [{up:0},{down:97},{up:1.5},{enabled:1},{down:NaN}])assert.throws(()=>formatPitchBendValue(8192,grid),{code:'INVALID_CONTROLLER_READOUT'});
});

test('project cursor readout uses clip-relative ticks and keeps explicit outside/no-prior states distinct',()=>{
 const index=buildControllerReadoutIndex(clip([pb('a',10,9000),pb('b',100,8192)]));
 assert.equal(query(index,999).status,'before-clip');assert.equal(query(index,999).value,null);
 const initial=query(index,1000);assert.equal(initial.status,'default-center');assert.equal(initial.value,8192);assert.equal(initial.hasData,false);
 assert.equal(query(index,1009.999).hasData,false);assert.equal(query(index,1010).value,9000);assert.equal(query(index,1099.99).value,9000);
 assert.equal(query(index,1100).value,8192);assert.equal(query(index,1100).hasData,true);assert.equal(query(index,1100.001).status,'after-clip');assert.equal(query(index,1100.001).value,null);
 assert.equal(query(index,1000,{kind:'cc',channel:0,controller:11}).status,'no-data');assert.equal(query(index,1000,{kind:'cc',channel:0,controller:11}).value,null);
});

test('same-tick readout takes the final explicit source order rather than array position',()=>{
 const c=clip([pb('last',10,12000,{order:30}),pb('first',10,10000,{order:10}),pb('middle',10,11000,{order:20})]),before=JSON.stringify(c),index=buildControllerReadoutIndex(c),value=query(index,1010);
 assert.equal(value.value,12000);assert.equal(value.eventId,'last');assert.equal(value.generated,false);assert.equal(index.sampleCount,1);assert.equal(JSON.stringify(c),before);
});

test('Ramp cursor values match integer MIDI steps, not continuously evaluated fractional cursor positions',()=>{
 const c=clip([pb('a',0,8192,{curve:{type:'ramp'}}),pb('b',100,8292)]),index=buildControllerReadoutIndex(c);
 for(let tick=0;tick<100;tick++){const v=query(index,1000+tick+.75);assert.equal(v.value,8192+tick);assert.equal(v.sampleTick,tick);assert.equal(v.generated,tick>0);}
 assert.equal(query(index,1100).value,8292);
});

test('Bezier cursor queries agree with independent cubic values and quantized equal-endpoint humps',()=>{
 const curve={type:'bezier',handles:[{x:1/3,value:8192},{x:2/3,value:8192}]},index=buildControllerReadoutIndex(clip([pb('a',0,8192,{curve}),pb('b',100,8292)]));
 for(const tick of [0,10,25,50,75,99,100])assert.equal(query(index,1000+tick).value,8192+Math.floor(100*(tick/100)**3+.5));
 assert.equal(query(index,1050.999).value,8205);
 const hump=buildControllerReadoutIndex(clip([cc('a',0,0,{curve:{type:'bezier',handles:[{x:1/3,value:127},{x:2/3,value:127}]}}),cc('b',100,0)]));
 assert.equal(query(hump,1050,{kind:'cc',channel:0,controller:11}).value,95);assert.equal(query(hump,1100,{kind:'cc',channel:0,controller:11}).value,0);
});

test('sample-only split boundaries do not invent earlier state and raw chase anchors are distinguished',()=>{
 function fragment(delta,chaseControllers){const c=clip([pb('a',0,9000,{curve:{type:'ramp'}}),pb('b',100,9010)]),right={...structuredClone(c),id:'right',startTick:c.startTick+delta,lengthTicks:c.lengthTicks-delta};splitMidiCurves(c,right,delta,{chaseControllers});return right;}
 const suppressed=buildControllerReadoutIndex(fragment(20,false));assert.equal(query(suppressed,1020).status,'default-center');assert.equal(query(suppressed,1024).hasData,false);assert.equal(query(suppressed,1025).value,9003);assert.equal(query(suppressed,1025).generated,true);
 const changed=buildControllerReadoutIndex(fragment(25,false));assert.equal(query(changed,1025).value,9003);assert.equal(query(changed,1025).generated,true);
 const chased=buildControllerReadoutIndex(fragment(20,true));assert.equal(query(chased,1020).value,9002);assert.equal(query(chased,1020).hasData,true);assert.equal(query(chased,1020).generated,false);
});

test('indexed held values equal the actual emitted curve stream across every integer and fractional query',()=>{
 const c=clip([pb('a',0,0,{curve:{type:'bezier',handles:[{x:.8,value:16000},{x:.1,value:300}]}}),pb('b',100,16383)]),index=buildControllerReadoutIndex(c);
 const emitted=materializeMidiCurves(c).events.sort((a,b)=>a.tick-b.tick||Number(!a.curveGenerated)-Number(!b.curveGenerated)||a.order-b.order);let value=8192,at=0;
 for(let tick=0;tick<=100;tick++){while(at<emitted.length&&emitted[at].tick<=tick){const e=emitted[at++];value=e.data[0]+128*e.data[1];}assert.equal(query(index,1000+tick).value,value);if(tick<100)assert.equal(query(index,1000+tick+.99).value,value);}
});

test('channel, CC number and polyphonic pressure keys stay independent; all-channel views never invent a single shared state',()=>{
 const c=clip([pb('a',0,8192,{channel:0,order:0}),pb('b',0,8192,{channel:1,order:1}),cc('c',0,100,{order:2}),cc('d',0,50,{controller:7,order:3}),{id:'p60',kind:'channel',status:0xa0,data:[60,30],tick:0,order:4},{id:'p61',kind:'channel',status:0xa0,data:[61,70],tick:0,order:5}]),index=buildControllerReadoutIndex(c);
 const all=query(index,1000,{kind:'pitchBend',channel:'all'});assert.equal(all.status,'multiple-channels');assert.equal(all.value,null);assert.deepEqual(all.channels.map(c=>[c.lane.channel,c.value]),[[0,8192],[1,8192]]);
 assert.equal(query(index,1000,{kind:'cc',channel:0,controller:11}).value,100);assert.equal(query(index,1000,{kind:'cc',channel:0,controller:7}).value,50);
 assert.equal(query(index,1000,{kind:'polyPressure',channel:0,pitch:60}).value,30);assert.equal(query(index,1000,{kind:'polyPressure',channel:0,pitch:61}).value,70);
 assert.equal(query(index,1000,{kind:'cc',channel:'all',controller:7}).value,50);assert.equal(query(index,1000,{kind:'cc',channel:'all',controller:7}).channels.length,1);
});

test('empty all-channel lane and non-emitting split lane retain explicit default/no-data information',()=>{
 const empty=buildControllerReadoutIndex(clip([]));const pbValue=query(empty,1000,{kind:'pitchBend',channel:'all'});assert.equal(pbValue.status,'default-center');assert.equal(pbValue.hasData,false);assert.deepEqual(pbValue.channels,[]);
 const e=pb('window',0,9000,{curve:{type:'ramp',window:{startTick:-10,endTick:1000,startValue:9000,endValue:9000,emitStart:'sample'}}}),index=buildControllerReadoutIndex(clip([e]));
 assert.equal(index.sampleCount,0);assert.equal(index.lanes.length,1);const value=query(index,1010,{kind:'pitchBend',channel:'all'});assert.equal(value.channels.length,1);assert.equal(value.hasData,false);assert.equal(value.status,'default-center');
});

test('index snapshots are immutable and detached from later source or returned-result mutation',()=>{
 const c=clip([pb('a',0,9000)]),before=JSON.stringify(c),index=buildControllerReadoutIndex(c,{revision:3,documentId:'doc'});assert.equal(JSON.stringify(c),before);
 c.events[0].data[0]=0;c.events[0].data[1]=0;c.startTick=0;assert.equal(query(index,1000).value,9000);assert.equal(index.startTick,1000);
 assert.throws(()=>{index.startTick=0;},TypeError);assert.throws(()=>{index.lanes[0].channel=9;},TypeError);
 const result=query(index,1000);result.lane.channel=10;result.value=0;assert.equal(query(index,1000).value,9000);assert.equal(query(index,1000).lane.channel,0);
});

test('revision/document cache avoids repeated source scans and invalidates on revision or document changes',()=>{
 const cache=createControllerReadoutCache(),c=clip([pb('a',0,9000)]),first=cache.get(c,{documentId:'A',revision:1});
 Object.defineProperty(c,'events',{get(){throw new Error('source reread');}});
 for(let i=0;i<2000;i++){assert.equal(cache.get(c,{documentId:'A',revision:1}),first);assert.equal(query(first,1000+(i%101)).value,9000);}
 assert.throws(()=>cache.get(c,{documentId:'A',revision:2}),/source reread/);
 const second=cache.get(clip([pb('a',0,10000)]),{documentId:'B',revision:1});assert.notEqual(second,first);assert.equal(query(second,1000).value,10000);assert.equal(query(first,1000).value,9000);cache.clear();assert.equal(cache.size,0);
});

test('readout cache bounds retained clip indices with LRU eviction',()=>{
 const cache=createControllerReadoutCache({maxEntries:2}),a=clip([],{id:'a'}),b=clip([],{id:'b'}),c=clip([],{id:'c'}),identity={documentId:'A',revision:0};
 const first=cache.get(a,identity);cache.get(b,identity);cache.get(c,identity);assert.equal(cache.size,2);assert.notEqual(cache.get(a,identity),first);assert.equal(cache.size,2);
 assert.throws(()=>createControllerReadoutCache({maxEntries:0}),{code:'INVALID_CONTROLLER_READOUT'});assert.throws(()=>cache.get(a,{revision:0}),{code:'INVALID_CONTROLLER_READOUT'});
});

test('readout rejects malformed queries, numeric events and over-budget curves rather than returning fabricated values',()=>{
 const index=buildControllerReadoutIndex(clip([]));for(const projectTick of [NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>query(index,projectTick),{code:'INVALID_CONTROLLER_READOUT'});
 for(const lane of [{kind:'velocity',channel:0},{kind:'pitchBend',channel:16},{kind:'cc',channel:0,controller:128},{kind:'polyPressure',channel:0}])assert.throws(()=>query(index,1000,lane),{code:'INVALID_CONTROLLER_READOUT'});
 assert.throws(()=>query({},1000),{code:'INVALID_CONTROLLER_READOUT'});const malformed=pb('bad',0,8192);malformed.data=[128,64];assert.throws(()=>buildControllerReadoutIndex(clip([malformed])),{code:'INVALID_CONTROLLER_READOUT'});
 assert.throws(()=>buildControllerReadoutIndex(clip([pb('a',0,8192,{order:0}),pb('b',0,10000,{order:0})])),{code:'INVALID_CONTROLLER_READOUT'});
 assert.throws(()=>buildControllerReadoutIndex(clip([pb('a',0,0,{curve:{type:'ramp'}}),pb('b',2_000_002,16383)],{lengthTicks:2_000_002})),{code:'MIDI_CURVE_TOO_COMPLEX'});
});

test('200000-point index supports many independent held-value queries without rescanning event arrays',()=>{
 const events=Array.from({length:200000},(_,i)=>pb(`event-${i}`,i,i%16384)),index=buildControllerReadoutIndex(clip(events,{lengthTicks:200000}));assert.equal(index.sampleCount,200000);
 for(let i=0;i<2000;i++){const tick=(i*7919)%200000;assert.equal(query(index,1000+tick+.5).value,tick%16384);}
});
