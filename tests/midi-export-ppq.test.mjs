import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/core/engine.mjs';
import {writeMidiDetailed,writeMidi,parseMidi} from '../src/media/midi.mjs';
function fixture(){const e=new Engine();for(const [command,args]of[['track.add',{id:'t',type:'midi'}],['clip.add',{id:'p',trackId:'t',type:'midi',notes:[{id:'n',pitch:60,startTick:20,durationTicks:1,velocity:90,releaseVelocity:42,onOrder:0,offOrder:2}],events:[{id:'cc',kind:'channel',status:176,tick:20,order:1,data:[64,127]}]}],['marker.add',{id:'m',name:'Marker',tick:60}]])assert.equal(e.execute({command,arguments:args}).status,'applied');const p=e.project;p.tempoMap=[{tick:0,bpm:120},{tick:100,bpm:90}];return p;}
test('MIDI output PPQ rescales notes, raw data and markers with half-up ties without source edits',()=>{
 for(const format of[0,1]){const p=fixture(),before=structuredClone(p),result=writeMidiDetailed(p,{format,outputPpq:24}),bytes=result.bytes;assert.equal((bytes[12]<<8)|bytes[13],24);const parsed=parseMidi(bytes,{ppq:24,extractMarkers:true}),notes=parsed.tracks.flatMap(t=>t.notes);assert.equal(notes.length,1);assert.equal(notes[0].startTick,1);assert.equal(notes[0].durationTicks,0);assert.equal(notes[0].releaseVelocity,42);assert.equal(parsed.markers[0].tick,2);assert(parsed.tempoMap.some(point=>point.tick===3));assert.equal(parsed.tracks.flatMap(t=>t.events).find(e=>e.kind==='channel').tick,1);assert(result.warnings.some(w=>w.includes('rounded')));assert.deepEqual(p,before);}
});
test('MIDI default PPQ bytes remain exact and malformed explicit resolutions reject',()=>{
 const p=fixture();assert.deepEqual(writeMidi(p),writeMidi(p,{outputPpq:960}));for(const outputPpq of[0,23,961,24.5,'96'])assert.throws(()=>writeMidi(p,{outputPpq}));
});
