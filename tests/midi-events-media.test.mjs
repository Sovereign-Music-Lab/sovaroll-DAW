import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, writeMidi } from '../src/media/midi.mjs';
import { Engine } from '../src/core/engine.mjs';

const managed = new Set([3, 0x2f, 0x51, 0x58]);
function variable(value) { const out = [value & 127]; while ((value = Math.floor(value / 128))) out.unshift((value & 127) | 128); return out; }
function makeSmf(tracks, ppq = 960, format = tracks.length === 1 ? 0 : 1) {
  const chunks = tracks.map(track => { const bytes = []; let previous = 0; for (const event of track) { bytes.push(...variable(event.tick - previous)); for (const byte of event.bytes) bytes.push(byte); previous = event.tick; } return Uint8Array.from(bytes); });
  const output = new Uint8Array(14 + chunks.reduce((sum, item) => sum + 8 + item.length, 0)), view = new DataView(output.buffer);
  output.set([77,84,104,100,0,0,0,6,0,format,0,tracks.length,ppq >> 8,ppq & 255]); let position = 14;
  for (const chunk of chunks) { output.set([77,84,114,107], position); view.setUint32(position + 4, chunk.length); output.set(chunk, position + 8); position += 8 + chunk.length; }
  return output;
}
// Independent wire decoder: no parseMidi, writer helpers or core model is used here.
function wire(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tracks = [];
  assert.equal(new TextDecoder().decode(bytes.subarray(0,4)), 'MThd');
  let cursor = 8 + view.getUint32(4);
  for (let track = 0; track < view.getUint16(10); track++) {
    assert.equal(new TextDecoder().decode(bytes.subarray(cursor,cursor+4)), 'MTrk');
    const end = cursor + 8 + view.getUint32(cursor + 4); cursor += 8;
    let tick = 0, running = 0; const events = [];
    const vlq = () => { let value = 0, byte; do { byte = bytes[cursor++]; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
    while (cursor < end) {
      tick += vlq(); let status = bytes[cursor]; if (status & 128) cursor++; else status = running;
      let metaType, length;
      if (status === 255) { running = 0; metaType = bytes[cursor++]; length = vlq(); }
      else if (status === 240 || status === 247) { running = 0; length = vlq(); }
      else { running = status; length = (status >> 4) === 12 || (status >> 4) === 13 ? 1 : 2; }
      const data = Array.from(bytes.subarray(cursor,cursor + length)); cursor += length;
      events.push({tick,status,...(metaType === undefined ? {} : {metaType}),data});
    }
    assert.equal(cursor,end); tracks.push(events);
  }
  assert.equal(cursor,bytes.length);
  return {format:view.getUint16(8),ppq:view.getUint16(12),tracks};
}
const performance = events => events.filter(event => event.status !== 255 || !managed.has(event.metaType));
function importedProject(parsed) {
  return {name:'Imported',ppq:960,tempoMap:parsed.tempoMap,timeSignature:{numerator:4,denominator:4},
    tracks:parsed.tracks.map((track,index)=>({id:`t${index}`,type:'midi',name:track.name})),
    clips:parsed.tracks.map((track,index)=>({id:`c${index}`,trackId:`t${index}`,type:'midi',startTick:0,lengthTicks:Math.max(1,track.endTick),notes:track.notes,events:track.events}))};
}
const event = (tick,...bytes) => ({tick,bytes});
const sysex = (tick,status,data) => ({tick,bytes:[status].concat(variable(data.length),data)});
const eot = tick => event(tick,255,47,0);

const allMessages = [
  event(0,0xb2,0,3),event(0,0xb2,32,7),event(0,0xc2,48),event(0,0x92,60,100),
  event(0,0xb2,64,127),event(0,0xa2,60,65),event(0,0xd2,29),event(0,0xe2,0,0),event(0,0xe2,127,127),
  sysex(0,0xf0,[0x7d,0x01,0xf7]),sysex(0,0xf7,[0x90,0x05,0x7f]),
  event(480,0x82,60,73),event(480,0x92,61,101),event(480,0x82,62,41),
  event(960,0x92,61,0),event(960,0xb2,64,0),event(960,255,5,3,255,128,0),eot(1200),
];

test('all channel states, F0/F7 framing, opaque metadata, unmatched off and same-tick source order survive a wire roundtrip',()=>{
  const source=makeSmf([allMessages]),parsed=parseMidi(source),project=importedProject(parsed),out=wire(writeMidi(project));
  assert.equal(out.format,1);assert.deepEqual(performance(out.tracks[1]),performance(wire(source).tracks[0]));
  assert.equal(parsed.tracks[0].notes[0].releaseVelocity,73);assert.equal(parsed.tracks[0].notes[0].onOrder,3);assert.equal(parsed.tracks[0].notes[0].offOrder,11);
  assert.equal(parsed.tracks[0].notes[1].noteOffEncoding,'zeroVelocityNoteOn');assert.equal(parsed.tracks[0].notes[1].releaseVelocity,0);
  assert.equal(parsed.tracks[0].endTick,1200);assert.equal(out.tracks[1].at(-1).tick,1200);
  assert.ok(parsed.warnings.some(message=>message.includes('Unmatched')&&message.includes('retained')));
  assert.ok(parsed.warnings.some(message=>message.includes('metadata')&&message.includes('not applied')));
});

test('controller-only, sysex-only and opaque-metadata-only tracks import without notes and retain terminal release events',()=>{
  const sources=[[event(0,0xb0,64,127),event(480,0xb0,64,0),eot(480)], [sysex(0,0xf7,[0xff,0xf8]),eot(700)], [event(0,255,6,2,65,66),eot(960)]];
  const parsed=parseMidi(makeSmf(sources)),out=wire(writeMidi(importedProject(parsed)));
  assert.equal(parsed.tracks.length,3);assert.ok(parsed.tracks.every(track=>track.notes.length===0));
  for(let index=0;index<3;index++){assert.deepEqual(performance(out.tracks[index+1]),performance(wire(makeSmf([sources[index]])).tracks[0]));assert.equal(out.tracks[index+1].at(-1).tick,parsed.tracks[index].endTick);}
});

test('running channel status expands into equivalent bytes and simultaneous PPQ-rounded events keep source order',()=>{
  const source=makeSmf([[event(0,0xb4,64,127),event(1,11,50),event(1,0x94,70,90),event(2,0x84,70,60),eot(3)]],3);
  const parsed=parseMidi(source,{ppq:2}),project=importedProject(parsed);project.ppq=2;
  const events=performance(wire(writeMidi(project)).tracks[1]);
  assert.deepEqual(events.map(x=>[x.tick,x.status,x.data]),[[0,0xb4,[64,127]],[1,0xb4,[11,50]],[1,0x94,[70,90]],[2,0x84,[70,60]]]);
  assert.ok(parsed.warnings.some(message=>message.includes('rounded')));assert.ok(parsed.warnings.some(message=>message.includes('expanded')));
});

test('legacy note fallback still emits off before on, while imported order can deliberately emit on before off',()=>{
  const project=importedProject(parseMidi(makeSmf([[event(0,0x90,60,100),event(480,0x90,62,110),event(480,0x80,60,30),event(960,0x80,62,40),eot(960)]])));
  let middle=performance(wire(writeMidi(project)).tracks[1]).filter(event=>event.tick===480);
  assert.deepEqual(middle.map(event=>event.status),[0x90,0x80]);
  for(const note of project.clips[0].notes){delete note.onOrder;delete note.offOrder;}
  middle=performance(wire(writeMidi(project)).tracks[1]).filter(event=>event.tick===480);assert.deepEqual(middle.map(event=>event.status),[0x80,0x90]);
});

test('format 0 merges independent tracks deterministically while preserving channel bytes and each source track ordering',()=>{
  const parsed=parseMidi(makeSmf([allMessages,[event(0,0xbf,7,99),event(0,0xcf,12),eot(1200)]])),project=importedProject(parsed),out=wire(writeMidi(project,{format:0}));
  assert.equal(out.format,0);assert.equal(out.tracks.length,1);assert.equal(out.ppq,960);
  const expected=[...performance(wire(makeSmf([allMessages])).tracks[0]).map((e,index)=>({...e,track:0,index})),...performance(wire(makeSmf([[event(0,0xbf,7,99),event(0,0xcf,12),eot(1200)]])).tracks[0]).map((e,index)=>({...e,track:1,index}))].sort((a,b)=>a.tick-b.tick||a.track-b.track||a.index-b.index).map(({track,index,...rest})=>rest);
  assert.deepEqual(performance(out.tracks[0]),expected);assert.equal(out.tracks[0].filter(e=>e.metaType===3).length,1);
  assert.throws(()=>writeMidi(project,{format:2}),/format must be 0 or 1/);
});

test('managed metadata is not duplicated into raw events; normalized names, omitted meter and out-of-range tempo are explicit',()=>{
  const parsed=parseMidi(makeSmf([[event(0,255,3,3,32,65,32),event(0,255,0x51,3,0,0,1),event(0,255,0x58,4,7,3,24,8),event(0,255,6,1,88),eot(0)]]));
  assert.equal(parsed.tracks[0].name,'A');assert.deepEqual(parsed.tracks[0].events.map(event=>event.metaType),[6]);assert.equal(parsed.tempoMap[0].bpm,120);
  for(const term of ['normalized','Time signature','20–300'])assert.ok(parsed.warnings.some(message=>message.includes(term)),term);
});

test('cross-clip explicit endpoint order survives a split-style partition and clip offsets are applied once',()=>{
  const project=importedProject(parseMidi(makeSmf([[event(0,0x90,60,100),event(480,0xb0,64,127),event(480,0x80,60,31),event(960,0xb0,64,0),eot(960)]])));
  const original={...project.clips[0],midiOrderGroup:'source-stream'};project.clips=[{...original,startTick:100,lengthTicks:480,events:[]},{...original,id:'right',startTick:580,lengthTicks:480,notes:[],events:original.events.map(e=>({...e,tick:e.tick-480}))}];
  const out=performance(wire(writeMidi(project)).tracks[1]);assert.deepEqual(out.map(e=>[e.tick,e.status,e.data]),[[100,0x90,[60,100]],[580,0xb0,[64,127]],[580,0x80,[60,31]],[1060,0xb0,[64,0]]]);
});

function engineFrom(source) {
  const engine=new Engine(),parsed=parseMidi(makeSmf([source]));
  const apply=(command,args)=>{const result=engine.execute({command,arguments:args});assert.equal(result.status,'applied',JSON.stringify(result.errors));return result;};
  apply('track.add',{id:'track',type:'midi'});apply('clip.add',{id:'clip',trackId:'track',type:'midi',lengthTicks:Math.max(1,parsed.tracks[0].endTick),notes:parsed.tracks[0].notes,events:parsed.tracks[0].events});
  return {engine,apply};
}

test('consecutive clip copies release previous notes and pedal before the next repeated onset without renumbering source metadata',()=>{
  const source=[event(0,0xb0,64,127),event(0,0x90,60,90),event(100,0x80,60,73),event(100,0xb0,64,0),eot(100)],{engine,apply}=engineFrom(source),original=engine.project.clips[0];
  apply('clip.duplicate',{clipId:'clip',count:2});
  const out=performance(wire(writeMidi(engine.project)).tracks[1]);
  for(const tick of [100,200])assert.deepEqual(out.filter(e=>e.tick===tick).map(({status,data})=>({status,data})),[{status:0x80,data:[60,73]},{status:0xb0,data:[64,0]},{status:0xb0,data:[64,127]},{status:0x90,data:[60,90]}]);
  for(const clip of engine.project.clips){assert.deepEqual(clip.notes.map(({id,...note})=>note),original.notes.map(({id,...note})=>note));assert.deepEqual(clip.events.map(({id,...event})=>event),original.events.map(({id,...event})=>event));}
});

test('actual split lineage and whole-track copies preserve the source CC-before-release boundary in both SMF formats',()=>{
  const source=[event(0,0x90,60,100),event(50,0xb0,64,127),event(50,0x80,60,71),event(100,0xb0,64,0),eot(100)],{engine,apply}=engineFrom(source),expected=performance(wire(makeSmf([source])).tracks[0]);
  apply('clip.split',{clipId:'clip',atTick:50});const split=engine.project.clips;assert.ok(split[0].midiOrderGroup);assert.equal(split[0].midiOrderGroup,split[1].midiOrderGroup);
  assert.deepEqual(performance(wire(writeMidi(engine.project)).tracks[1]),expected);
  apply('track.duplicate',{trackId:'track',newTrackId:'copy'});const copy=engine.project.clips.filter(clip=>clip.trackId==='copy');assert.equal(copy[0].midiOrderGroup,copy[1].midiOrderGroup);assert.notEqual(copy[0].midiOrderGroup,split[0].midiOrderGroup);
  const format1=wire(writeMidi(engine.project));assert.deepEqual(performance(format1.tracks[1]),expected);assert.deepEqual(performance(format1.tracks[2]),expected);
  const merged=performance(wire(writeMidi(engine.project,{format:0})).tracks[0]);assert.deepEqual(merged.filter(e=>e.tick===50).map(e=>[e.status,e.data]),[[0xb0,[64,127]],[0x80,[60,71]],[0xb0,[64,127]],[0x80,[60,71]]]);
});

test('mixed legacy and ordered independent clips honor chronological groups while all-legacy tracks retain global off-before-on',()=>{
  const p=importedProject(parseMidi(makeSmf([[event(0,0xb0,64,127),event(0,0x90,60,99),event(100,0x80,60,0),eot(100)]])));
  const ordered={...p.clips[0],id:'ordered',startTick:100};const legacy={id:'legacy',trackId:'t0',type:'midi',startTick:0,lengthTicks:100,notes:[{pitch:62,velocity:90,startTick:0,durationTicks:100}]};p.clips=[ordered,legacy];
  assert.deepEqual(performance(wire(writeMidi(p)).tracks[1]).filter(e=>e.tick===100).map(e=>e.status),[0x80,0xb0,0x90]);
  p.clips=[{...legacy,id:'first',lengthTicks:200,notes:[{pitch:60,velocity:100,startTick:100,durationTicks:100}]},{...legacy,id:'second',startTick:50,lengthTicks:50,notes:[{pitch:62,velocity:100,startTick:0,durationTicks:50}]}];
  assert.deepEqual(performance(wire(writeMidi(p)).tracks[1]).filter(e=>e.tick===100).map(e=>e.status),[0x80,0x90]);
  for(const midiOrderGroup of [null,42,'','bad group',new Array(129).fill('x').join('')]){p.clips[0].midiOrderGroup=midiOrderGroup;assert.throws(()=>writeMidi(p),/order groups/);}
});

test('large SysEx payload is serialized without variadic stack overflow and preserves every byte',()=>{
  const data=Array.from({length:1024*1024},(_,index)=>index%256),parsed=parseMidi(makeSmf([[sysex(0,0xf7,data),eot(1)]]));
  const out=performance(wire(writeMidi(importedProject(parsed))).tracks[1]);assert.deepEqual(out[0].data,data);
});

test('payload, event-count, raw status and conflicting order limits fail explicitly',()=>{
  const source=makeSmf([[sysex(0,0xf7,new Array(1024*1024+1).fill(0)),eot(1)]]);assert.throws(()=>parseMidi(source),/payload limit/);
  assert.throws(()=>parseMidi(makeSmf([[...Array.from({length:5},()=>sysex(0,0xf7,new Array(1024*1024).fill(0))),eot(1)]])),/payload limit/);
  assert.throws(()=>parseMidi(makeSmf([[...Array.from({length:200001},()=>event(0,0xb0,64,127)),eot(1)]])),/200000 retained/);
  const valid=importedProject(parseMidi(makeSmf([[event(0,0xb0,64,127),eot(1)]])));
  const badEvents=[{kind:'channel',status:0x90,data:[60,1]},{kind:'channel',status:0xb0,data:[64,255]},{kind:'channel',status:0xc0,data:[1,2]},{kind:'sysex',status:0xf1,data:[]},{kind:'meta',status:255,metaType:0x51,data:[7,161,32]}];
  for(const bad of badEvents){const project=structuredClone(valid);project.clips[0].events=[{tick:0,order:0,...bad}];assert.throws(()=>writeMidi(project));}
  const duplicate=structuredClone(valid);duplicate.clips[0].events.push({...duplicate.clips[0].events[0]});assert.throws(()=>writeMidi(duplicate),error=>error.code==='MIDI_ORDER_CONFLICT');
  const release=importedProject(parseMidi(makeSmf([[event(0,0x90,60,100),event(1,0x90,60,0),eot(1)]])));release.clips[0].notes[0].releaseVelocity=1;assert.throws(()=>writeMidi(release),/cannot carry nonzero/);
  assert.throws(()=>parseMidi(makeSmf([[event(0,255,128,0),eot(0)]])),/seven bits/);
});
