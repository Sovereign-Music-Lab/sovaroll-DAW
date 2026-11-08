import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileMidiStreams, mergeMidiStreams } from '../src/media/midi-stream.mjs';
import { writeMidi } from '../src/media/midi.mjs';

function fixtures(){
 const base={name:'Golden Song',ppq:960,tempoMap:[{tick:0,bpm:120},{tick:720,bpm:83}],timeSignature:{numerator:7,denominator:8},tracks:[{id:'a',type:'midi',name:'피아노'},{id:'audio',type:'audio',name:'Audio'},{id:'b',type:'midi',name:'Lead'}],clips:[]};
 const legacy=structuredClone(base);legacy.clips=[{id:'later',trackId:'a',type:'midi',startTick:100,lengthTicks:300,notes:[{pitch:60,startTick:0,durationTicks:100,velocity:87,channel:2}]},{id:'early',trackId:'a',type:'midi',startTick:0,lengthTicks:200,notes:[{pitch:60,startTick:0,durationTicks:100,velocity:100,channel:2},{pitch:64,startTick:100,durationTicks:100,velocity:64,channel:0}]},{trackId:'b',type:'midi',startTick:50,lengthTicks:250,notes:[{pitch:72,startTick:0,durationTicks:200,velocity:127}]}];
 const ordered=structuredClone(base);ordered.clips=[{id:'left',trackId:'a',type:'midi',midiOrderGroup:'split-source',startTick:0,lengthTicks:100,notes:[{pitch:60,startTick:0,durationTicks:100,velocity:100,channel:2,onOrder:1,offOrder:6,releaseVelocity:71}],events:[{id:'pedal',tick:0,order:0,kind:'channel',status:178,data:[64,127]}]},{id:'right',trackId:'a',type:'midi',midiOrderGroup:'split-source',startTick:100,lengthTicks:100,notes:[{pitch:64,startTick:0,durationTicks:100,velocity:99,channel:2,onOrder:3,offOrder:9,noteOffEncoding:'zeroVelocityNoteOn'}],events:[{tick:0,order:2,kind:'channel',status:194,data:[15]},{tick:0,order:4,kind:'channel',status:226,data:[0,64]},{tick:0,order:5,kind:'sysex',status:240,data:[125,1,247]},{tick:100,order:10,kind:'channel',status:178,data:[64,0]}]},{id:'repeat',trackId:'a',type:'midi',midiOrderGroup:'repeat-source',startTick:200,lengthTicks:200,notes:[{pitch:60,startTick:0,durationTicks:100,velocity:100,channel:2,onOrder:1,offOrder:6,releaseVelocity:71}],events:[{tick:0,order:0,kind:'channel',status:178,data:[64,127]},{tick:200,order:10,kind:'channel',status:178,data:[64,0]}]},{id:'meta',trackId:'b',type:'midi',startTick:0,lengthTicks:400,notes:[],events:[{tick:0,order:0,kind:'meta',status:255,metaType:5,data:[255,0,128]},{tick:50,order:1,kind:'sysex',status:247,data:[144,60,90]},{tick:100,order:2,kind:'channel',status:143,data:[64,75]}]}];
 const mixed=structuredClone(ordered);mixed.clips.push({id:'legacy-mixed',trackId:'a',type:'midi',startTick:50,lengthTicks:200,notes:[{pitch:67,startTick:50,durationTicks:100,velocity:61,channel:2}]});
 return {legacy,ordered,mixed};
}

// Captured from the frozen v0.11 writer BEFORE extracting the scheduler.
const golden = {
 legacy:['d9efa0529290c9efd77b1baf7d6062ea26238246120f5a7b8f57105dae491d82','27c2ccac02fd8def333849b41eefcc886f9546c683ce77058b6161e77474c4f7'],
 ordered:['3ee98b72d3cc1e6a3ee2943021d206377676d0493f56753f0dc69271b06ff463','d705009b2c72cb3d822f4b9304bd9fd0fea0b4cfe20bfc6d0ffeb944d7ceadba'],
 mixed:['5fdb8b3a342b6572af6737189d51c015c1c9bdcf4472029abf5277e350c0cfee','b16731f4c66660fd4b671fa8ab3574a3d89742a192efb328090aa6fbcf76dc64'],
};
test('scheduler extraction preserves all six pre-refactor SMF 0/1 golden byte hashes exactly',()=>{
 for(const [name,p] of Object.entries(fixtures()))for(const format of [0,1])assert.equal(createHash('sha256').update(writeMidi(p,{format})).digest('hex'),golden[name][format],`${name} format ${format}`);
});

test('normalized note endpoints have unique identities, original nominal timing and encoded release bytes',()=>{
 const p=fixtures().ordered,compiled=compileMidiStreams(p),[track]=compiled.tracks;
 assert.deepEqual(compiled.tracks.map(t=>[t.trackId,t.sourceTrack,t.endTick]),[['a',0,400],['b',2,400]]);
 const onset=track.events.find(e=>e.kind==='noteOn'&&e.clipId==='right'),off=track.events.find(e=>e.kind==='noteOff'&&e.clipId==='right');
 assert.equal(onset.noteKey,'note:1:0');assert.equal(onset.noteKey,off.noteKey);assert.equal(onset.clipIndex,1);assert.equal(onset.channel,2);assert.equal(onset.pitch,64);assert.equal(onset.velocity,99);
 assert.equal(onset.nominalStartTick,100);assert.equal(onset.nominalEndTick,200);assert.equal(onset.durationTicks,100);assert.equal(off.nominalStartTick,100);assert.equal(off.durationTicks,100);
 assert.equal(off.noteOffEncoding,'zeroVelocityNoteOn');assert.equal(off.status,0x92);assert.deepEqual(off.data,[64,0]);
 const firstOff=track.events.find(e=>e.kind==='noteOff'&&e.clipId==='left');assert.equal(firstOff.releaseVelocity,71);assert.deepEqual(firstOff.data,[60,71]);
 const rawOff=compiled.tracks[1].events.find(e=>e.status===0x8f);assert.equal(rawOff.kind,'raw');assert.equal(rawOff.rawKind,'channel');assert.equal(rawOff.noteKey,undefined);assert.equal(rawOff.channel,15);assert.deepEqual(rawOff.data,[64,75]);
 assert.equal(new Set(track.events.filter(e=>e.kind==='noteOn').map(e=>e.noteKey)).size,3);
});

test('scheduler distinguishes raw framing and metadata without decoding or altering payload bytes',()=>{
 const streams=compileMidiStreams(fixtures().ordered),all=streams.tracks.flatMap(t=>t.events),sysex=all.filter(e=>e.rawKind==='sysex');
 assert.deepEqual(sysex.map(e=>[e.status,e.data]),[[240,[125,1,247]],[247,[144,60,90]]]);
 const meta=all.find(e=>e.rawKind==='meta');assert.equal(meta.status,255);assert.equal(meta.metaType,5);assert.deepEqual(meta.data,[255,0,128]);assert.equal(meta.channel,undefined);
 assert.equal(streams.rawEventCount,10);assert.equal(streams.noteCount,3);assert.equal(streams.eventCount,16);assert.equal(streams.payloadBytes,22);
});

test('shared lineage compares source order across fragments; independent repetitions release before the next onset',()=>{
 const events=compileMidiStreams(fixtures().ordered).tracks[0].events;
 assert.deepEqual(events.filter(e=>e.tick===100).map(e=>[e.status,e.data]),[[0xc2,[15]],[0x92,[64,99]],[0xe2,[0,64]],[0xf0,[125,1,247]],[0x82,[60,71]]]);
 assert.deepEqual(events.filter(e=>e.tick===200).map(e=>[e.status,e.data]),[[0x92,[64,0]],[0xb2,[64,0]],[0xb2,[64,127]],[0x92,[60,100]]]);
 const legacy=compileMidiStreams(fixtures().legacy).tracks[0].events.filter(e=>e.tick===100);assert.equal(legacy[0].kind,'noteOff');assert.ok(legacy.slice(1).every(e=>e.kind==='noteOn'));
});

test('compilation is repeatable and output mutations cannot change the input project or another compile',()=>{
 const p=fixtures().ordered,before=structuredClone(p),first=compileMidiStreams(p),second=compileMidiStreams(p);assert.deepEqual(first,second);assert.deepEqual(p,before);
 const raw=first.tracks.flatMap(t=>t.events).find(e=>e.kind==='raw');raw.data[0]=99;raw.tick=900;
 const on=first.tracks[0].events.find(e=>e.kind==='noteOn');on.data[0]=1;on.velocity=1;first.tracks[0].events.pop();
 assert.deepEqual(p,before);assert.deepEqual(compileMidiStreams(p),second);
});

test('active track filtering preserves original indices and budgets only selected events, including large inactive note sets',()=>{
 const p=fixtures().ordered;p.clips.push({trackId:'a',type:'midi',startTick:0,lengthTicks:1,notes:new Array(200001).fill({pitch:60,velocity:100,startTick:0,durationTicks:1})});
 const selected=compileMidiStreams(p,{trackIds:['b']});assert.deepEqual(selected.tracks.map(t=>[t.trackId,t.sourceTrack]),[['b',2]]);assert.equal(selected.tracks[0].events[0].clipIndex,3);assert.equal(selected.noteCount,0);assert.equal(selected.rawEventCount,3);assert.equal(selected.eventCount,3);assert.equal(selected.payloadBytes,8);assert.equal(selected.endTick,400);
 assert.deepEqual(compileMidiStreams(p,{trackIds:[]}),{tracks:[],endTick:0,noteCount:0,rawEventCount:0,eventCount:0,payloadBytes:0});
 const other=fixtures().ordered;other.clips[3].events[0].data=[999];assert.doesNotThrow(()=>compileMidiStreams(other,{trackIds:['a']}));assert.throws(()=>compileMidiStreams(other,{trackIds:['b']}),/data byte/);
});

test('selection IDs are validated and unknown clip references remain errors',()=>{
 const p=fixtures().ordered;
 for(const trackIds of [['unknown'],['audio'],['a','a'],'a',[null]])assert.throws(()=>compileMidiStreams(p,{trackIds}));
 p.clips[0].trackId='missing';assert.throws(()=>compileMidiStreams(p,{trackIds:['b']}),/missing MIDI track/);
});

test('source validation and budgets are shared, while generic scheduling has no SMF track-count limit',()=>{
 const p=fixtures().ordered;
 for(const mutate of [p=>{p.clips[0].notes[0].releaseVelocity=128;},p=>{p.clips[0].notes[0].onOrder=0;},p=>{p.clips[0].events[0].tick=101;},p=>{p.clips[1].events[2].data=new Array(1024*1024+1).fill(0);},p=>{p.clips[0].midiOrderGroup=null;}]){const bad=structuredClone(p);mutate(bad);assert.throws(()=>compileMidiStreams(bad));}
 const many={tracks:Array.from({length:300},(_,index)=>({id:`t${index}`,type:'midi',name:'Track'})),clips:[],ppq:960,tempoMap:[{tick:0,bpm:120}]};assert.equal(compileMidiStreams(many).tracks.length,300);assert.throws(()=>writeMidi(many),/255 musical tracks/);assert.doesNotThrow(()=>writeMidi(many,{format:0}));
});

test('format-zero stream merging uses project track order at equal ticks without mutating per-track streams',()=>{
 const compiled=compileMidiStreams(fixtures().ordered),before=structuredClone(compiled),merged=mergeMidiStreams(compiled);
 assert.deepEqual(compiled,before);for(let index=1;index<merged.length;index++)assert.ok(merged[index-1].tick<=merged[index].tick);
 assert.deepEqual(merged.filter(e=>e.tick===100).map(e=>e.sourceTrack),[0,0,0,0,0,2]);
 assert.equal(merged.length,compiled.eventCount);
});
