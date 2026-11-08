// Real CoreMIDI roundtrip: each test owns its virtual endpoint. Never sends to
// pre-existing hardware, IAC or another application's endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openCoreMidi} from '../macos/client.mjs';
async function setup(t){
 const receiver=await openCoreMidi({testReceiver:true}),sender=await openCoreMidi();
 t.after(async()=>{await sender.close();await receiver.close();});
 const received=[],changes=[],transmitted=[];sender.events.on('transmitted',e=>transmitted.push(e));receiver.events.on('received',e=>received.push(e));sender.events.on('ports-changed',e=>changes.push(e));
 const name='newdaw-가상포트-'+randomUUID();const endpoint=await receiver.request('test.createReceiver',{name});
 const waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await delay(10);}assert.fail('CoreMIDI receiver condition timed out: '+JSON.stringify({received:received.flatMap(e=>e.packets),changes}));};
 await waitFor(()=>changes.length>0);
 // Other running MIDI applications can probe a new public endpoint. Match our
 // real CoreMIDI host timestamps, retaining all ambient traffic for diagnostics.
 const words=()=>{const own=new Set(transmitted.map(e=>e.hostTime));return received.flatMap(e=>e.packets.filter(p=>own.has(p.timestamp)).flatMap(p=>p.words));};
 t.after(()=>{const own=new Set(transmitted.map(e=>e.hostTime)),ambient=received.flatMap(e=>e.packets).filter(p=>!own.has(p.timestamp));if(ambient.length)t.diagnostic(`Observed ${ambient.length} unsolicited packets; excluded by exact sender host timestamp, not by content.`);});
 const send=async messages=>sender.send(endpoint.id,messages);
 return {receiver,sender,name,endpoint,received,changes,transmitted,waitFor,words,send};
}
function channelWord(b){return (0x20000000 | b[0]<<16 | b[1]<<8 | (b[2]??0))>>>0;}
function decodeSysEx(words){let bytes=[];const forms=[];for(let i=0;i<words.length;i+=2){assert.equal(words[i]>>>28,3);const b=[words[i]>>>24,(words[i]>>>16)&255,(words[i]>>>8)&255,words[i]&255,words[i+1]>>>24,(words[i+1]>>>16)&255,(words[i+1]>>>8)&255,words[i+1]&255];const count=b[1]&15;assert.ok(count<=6);forms.push(b[1]>>>4);bytes.push(...b.slice(2,2+count));assert.ok(b.slice(2+count).every(x=>x===0));}return {bytes:[0xf0,...bytes,0xf7],forms};}

test('CoreMIDI: discovers live virtual destination by unique ID and reports add/remove changes',async t=>{
 const x=await setup(t),ports=await x.sender.ports();assert.equal(ports.backend,'CoreMIDI');assert.equal(ports.protocol,'MIDI1-UMP');const port=ports.destinations.find(p=>p.id===x.endpoint.id);assert.equal(port.name,x.name);assert.equal(port.offline,false);assert.equal(port.direction,'output');assert.equal(ports.destinations.filter(p=>p.id===x.endpoint.id).length,1);
 const before=x.changes.length;await x.receiver.request('test.removeReceiver',{name:x.name});await x.waitFor(()=>x.changes.length>before);assert.equal((await x.sender.ports()).destinations.some(p=>p.id===x.endpoint.id),false);
});
test('CoreMIDI: actual channel bytes preserve all sixteen channels, bank/program/order and note release velocity',async t=>{
 const x=await setup(t),messages=[];for(let c=0;c<16;c++)messages.push([0xb0|c,0,3],[0xb0|c,32,7],[0xc0|c,41],[0xd0|c,22],[0xa0|c,60,19],[0xe0|c,1,95],[0x90|c,60,99],[0x80|c,60,37]);
 const r=await x.send(messages);assert.equal(r.acceptedMessages,messages.length);await x.waitFor(()=>x.words().length===messages.length);assert.deepEqual(x.words(),messages.map(channelWord));assert.ok(x.received.every(e=>BigInt(e.arrivalHostTime)>0n));assert.ok(x.received.flatMap(e=>e.packets).every(p=>BigInt(p.timestamp)>=0n));
});
test('CoreMIDI: complete empty, six-byte and long SysEx7 traverse real UMP packet storage losslessly',async t=>{
 const x=await setup(t);for(const count of [0,1,6,7,12,4097,65534]){x.received.length=0;const bytes=[0xf0,...Array.from({length:count},(_,i)=>i%128),0xf7];await x.send([bytes]);const expected=Math.max(1,Math.ceil(count/6))*2;await x.waitFor(()=>x.words().length===expected);const result=decodeSysEx(x.words());assert.deepEqual(result.bytes,bytes);if(count<=6)assert.deepEqual(result.forms,[0]);else{assert.equal(result.forms[0],1);assert.equal(result.forms.at(-1),3);assert.ok(result.forms.slice(1,-1).every(x=>x===2));}}
});
test('CoreMIDI: validation rejects complete invalid batches before any MIDI is transmitted',async t=>{
 const x=await setup(t),valid=[0x90,60,80];for(const bad of [[],[0x90,60],[0x90,128,1],[0xc0,2,3],[0x90,60,true],[0xf0,2],[0xf7,1],[0xf8],[-1],[256],[0xf0,128,0xf7],[0xf0,0xf7,0xf7]])await assert.rejects(x.send([valid,bad]),e=>['INVALID_MIDI','INVALID_REQUEST','UNSUPPORTED_MIDI'].includes(e.code));
 await assert.rejects(x.sender.request('send',{destinationId:x.endpoint.id,messages:[valid],extra:true}),{code:'INVALID_REQUEST'});await assert.rejects(x.sender.send(true,[valid]),{code:'INVALID_REQUEST'});await assert.rejects(x.send([]),{code:'INVALID_MIDI'});await delay(50);assert.deepEqual(x.words(),[]);
});
test('CoreMIDI: explicit release emits owned overlapping key offs and CC120 only for used channels',async t=>{
 const x=await setup(t);await x.send([[0xb3,64,127],[0x93,60,90],[0x93,60,70],[0x95,65,90],[0x85,65,12]]);await x.waitFor(()=>x.words().length===5);x.received.length=0;const result=await x.sender.release(x.endpoint.id);assert.equal(result.acceptedWords,4);await x.waitFor(()=>x.words().length===4);assert.deepEqual(x.words(),[[0x83,60,0],[0x83,60,0],[0xb3,120,0],[0xb5,120,0]].map(channelWord));assert.equal((await x.sender.release(x.endpoint.id)).acceptedWords,0);
});
test('CoreMIDI: orderly process close releases pending notes into a separate receiver',async t=>{
 const x=await setup(t);await x.send([[0x92,64,90]]);await x.waitFor(()=>x.words().length===1);const r=await x.sender.close();assert.equal(r.code,0);await x.waitFor(()=>x.words().length===3);assert.deepEqual(x.words(),[[0x92,64,90],[0x82,64,0],[0xb2,120,0]].map(channelWord));await assert.rejects(x.sender.ports(),{code:'NATIVE_CLOSED'});
});
test('CoreMIDI: SIGTERM releases owned MIDI state and exits without an orphan helper',async t=>{
 const x=await setup(t);await x.send([[0x96,70,90]]);await x.waitFor(()=>x.words().length===1);const closed=new Promise(resolve=>x.sender.events.once('closed',resolve));process.kill(x.sender.pid,'SIGTERM');assert.equal((await closed).code,0);await x.waitFor(()=>x.words().length===3);assert.deepEqual(x.words().slice(1),[[0x86,70,0],[0xb6,120,0]].map(channelWord));await assert.rejects(x.sender.ports(),{code:'NATIVE_EXIT'});
});
test('CoreMIDI: disconnected destination fails explicitly without falling back to any other port',async t=>{
 const x=await setup(t);await x.send([[0x91,61,90]]);await x.waitFor(()=>x.words().length===1);await x.receiver.request('test.removeReceiver',{name:x.name});const other=await x.receiver.request('test.createReceiver',{name:x.name+'-other'});assert.notEqual(other.id,x.endpoint.id);x.received.length=0;await assert.rejects(x.send([[0x81,61,0]]),{code:'COREMIDI_ERROR'});await assert.rejects(x.sender.release(x.endpoint.id),{code:'COREMIDI_ERROR'});const errors=[];x.sender.events.on('cleanup-error',e=>errors.push(e));await x.sender.close();assert.equal(errors.length,1);assert.equal(errors[0].destinationId,x.endpoint.id);await delay(50);assert.deepEqual(x.words(),[]);
});
test('CoreMIDI: normal backend cannot create a test receiver or dispose another client endpoint',async t=>{
 const x=await setup(t);await assert.rejects(x.sender.request('test.createReceiver',{name:'not-allowed'}),{code:'INVALID_TEST_RECEIVER'});await assert.rejects(x.sender.request('test.removeReceiver',{name:x.name}),{code:'INVALID_TEST_RECEIVER'});assert.ok((await x.sender.ports()).destinations.some(p=>p.id===x.endpoint.id));
});
test('CoreMIDI: batch and active-note limits reject before sending, then explicit release recovers',async t=>{
 const x=await setup(t);await assert.rejects(x.send(Array.from({length:1025},()=>[0x90,60,80])),{code:'INVALID_MIDI'});await assert.rejects(x.send([[0xf0,...Array(65535).fill(1),0xf7]]),{code:'MIDI_LIMIT'});assert.deepEqual(x.words(),[]);
 for(let i=0;i<4;i++)await x.send(Array.from({length:1024},()=>[0x90,60,80]));await x.waitFor(()=>x.words().length===4096);await assert.rejects(x.send([[0x90,60,80]]),{code:'MIDI_LIMIT'});await x.sender.release(x.endpoint.id);await x.waitFor(()=>x.words().length===8193);await x.send([[0x90,60,80],[0x80,60,0]]);await x.waitFor(()=>x.words().length===8195);
});

test('CoreMIDI: full polyphony permits an ordered off/on replacement without transient overflow',async t=>{
 const x=await setup(t);for(let i=0;i<4;i++)await x.send(Array.from({length:1024},()=>[0x90,60,80]));await x.waitFor(()=>x.words().length===4096);await x.send([[0x80,60,0],[0x90,61,90]]);await x.waitFor(()=>x.words().length===4098);assert.deepEqual(x.words().slice(-2),[[0x80,60,0],[0x90,61,90]].map(channelWord));await assert.rejects(x.send([[0x90,62,90],[0x80,60,0]]),{code:'MIDI_LIMIT'});assert.equal(x.words().length,4098);
});
