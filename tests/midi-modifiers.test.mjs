import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject,validateProject,getCommandCatalog} from '../src/core/engine.mjs';
import {compileMidiStreams} from '../src/media/midi-stream.mjs';
import {writeMidi} from '../src/media/midi.mjs';
import {renderProject,projectDurationSeconds} from '../src/media/render.mjs';
import {defaultModifiers,defaultTrackParameters} from '../src/media/midi-modifiers.mjs';
function command(e,name,args={},extra={}){const result=e.execute({command:name,arguments:args,expectedRevision:e.project.revision,...extra});assert.notEqual(result.status,'error',JSON.stringify(result.errors));return result;}
function fixture({notes,events=[],startTick=0,lengthTicks=3840}={}){const e=new Engine(createProject({sampleRate:8000}));command(e,'track.add',{id:'t',type:'midi',name:'Modifiers'});command(e,'clip.add',{id:'c',trackId:'t',type:'midi',name:'Part',startTick,lengthTicks,notes:notes??[{id:'n',pitch:60,velocity:100,startTick:240,durationTicks:480,channel:0,releaseVelocity:42}],events});return e;}
const set=(e,settings)=>command(e,'midi.modifiers.set',{trackId:'t',settings});
const params=(e,settings)=>command(e,'midi.trackParameters.set',{trackId:'t',settings});
const part=(e,settings)=>command(e,'midi.partModifiers.set',{clipId:'c',settings});
const stream=e=>compileMidiStreams(e.project).tracks[0].events;
const ons=e=>stream(e).filter(x=>x.kind==='noteOn');
const wire=e=>stream(e).map(x=>({tick:x.tick,status:x.status,data:x.data,metaType:x.metaType}));
const cc=(id,tick,value,extra={})=>({id,tick,kind:'channel',status:0xb0,data:[11,value],...extra});
const pair=(first,second)=>[first,second];

test('MIDI modifiers: track and part offsets combine with rational velocity/length without editing source notes',()=>{
 const e=fixture(),original=e.project.clips[0].notes;set(e,{transpose:12,velocityShift:5,velocityRatio:{numerator:1,denominator:2},lengthRatio:{numerator:3,denominator:2}});part(e,{transpose:-3,velocityShift:10});const note=ons(e)[0];assert.equal(note.pitch,69);assert.equal(note.velocity,60);assert.equal(note.durationTicks,720);assert.deepEqual(e.project.clips[0].notes,original);assert.equal(stream(e).find(x=>x.kind==='noteOff').data[1],42);
});
test('MIDI modifiers: bypass disables track modifiers but retains independent part and delay parameters',()=>{
 const e=fixture();set(e,{transpose:12,bypass:true,velocityShift:100,lengthRatio:{numerator:2,denominator:1}});part(e,{transpose:2,velocityShift:-10});params(e,{delayMs:100});const n=ons(e)[0];assert.equal(n.pitch,62);assert.equal(n.velocity,90);assert.equal(n.tick,432);assert.equal(n.durationTicks,480);set(e,{bypass:false});assert.equal(ons(e)[0].pitch,74);
});
test('MIDI modifiers: two seeded generators are independent repeatable and disabled by Off',()=>{
 const e=fixture({notes:Array.from({length:40},(_,i)=>({id:'n'+i,pitch:60,startTick:i*60,durationTicks:30,velocity:80,channel:0}))});set(e,{seed:44,random:pair({target:'position',min:-10,max:10},{target:'velocity',min:-5,max:5})});const first=ons(e);assert.deepEqual(ons(e),first);assert.ok(first.every(n=>Math.abs(n.tick-Number(n.noteId.slice(1))*60)<=10&&n.velocity>=75&&n.velocity<=85));set(e,{seed:45});assert.notDeepEqual(ons(e).map(n=>[n.noteId,n.tick,n.velocity]),first.map(n=>[n.noteId,n.tick,n.velocity]));set(e,{random:pair({target:'off',min:-100,max:100},{target:'off',min:20,max:20})});assert.ok(ons(e).every(n=>n.velocity===80&&n.tick===Number(n.noteId.slice(1))*60));
});
test('MIDI modifiers: fixed pitch and length random offsets affect both note endpoints coherently',()=>{
 const e=fixture();set(e,{random:pair({target:'pitch',min:7,max:7},{target:'length',min:120,max:120})});const events=stream(e);assert.equal(events[0].pitch,67);assert.equal(events[1].pitch,67);assert.equal(events[1].tick-events[0].tick,600);assert.equal(events[1].data[1],42);
});
test('MIDI modifiers: range slots compose velocity clamp and octave-only pitch limit',()=>{
 const e=fixture();set(e,{ranges:pair({mode:'velocityLimit',min:20,max:70},{mode:'noteLimit',min:72,max:84})});const n=ons(e)[0];assert.equal(n.velocity,70);assert.equal(n.pitch,72);set(e,{ranges:pair({mode:'noteLimit',min:36,max:48},{mode:'velocityLimit',min:110,max:127})});assert.equal(ons(e)[0].pitch,48);assert.equal(ons(e)[0].velocity,110);
});
test('MIDI modifiers: range filters remove complete note pairs while preserving unrelated raw events',()=>{
 const e=fixture({notes:[{id:'low',pitch:48,velocity:20,startTick:0,durationTicks:480,channel:0},{id:'high',pitch:72,velocity:100,startTick:0,durationTicks:480,channel:0}],events:[cc('cc',0,64)]});set(e,{ranges:pair({mode:'velocityFilter',min:50,max:110},{mode:'noteFilter',min:60,max:72})});assert.deepEqual(ons(e).map(n=>n.noteId),['high']);assert.equal(stream(e).filter(x=>x.kind==='noteOff').length,1);assert.equal(stream(e).filter(x=>x.kind==='raw').length,1);assert.equal(e.project.clips[0].notes.length,2);
});
test('MIDI modifiers: narrow pitch range fallback and zero velocity suppression are explicit policies',()=>{
 const e=fixture();set(e,{ranges:pair({mode:'noteLimit',min:61,max:62},{mode:'off',min:0,max:127})});const compiled=compileMidiStreams(e.project);assert.equal(ons(e)[0].pitch,61);assert.equal(compiled.modifierStats.narrowRangeFallbacks,1);assert.ok(compiled.modifierWarnings.some(x=>x.includes('octave-equivalent')));set(e,{velocityShift:-127});assert.equal(ons(e).length,0);assert.equal(stream(e).filter(x=>x.kind==='noteOff').length,0);
});
test('MIDI modifiers: output saturation, minimum duration and negative random start never create invalid MIDI',()=>{
 const e=fixture();set(e,{transpose:127,velocityShift:127,lengthRatio:{numerator:1,denominator:1000},random:pair({target:'position',min:-1000,max:-1000},{target:'length',min:-1000,max:-1000})});const n=ons(e)[0];assert.equal(n.pitch,127);assert.equal(n.velocity,127);assert.equal(n.tick,0);assert.equal(n.durationTicks,1);assert.equal(stream(e)[1].tick,1);
});
test('MIDI modifiers: millisecond delay traverses tempo changes and delays every retained event',()=>{
 const e=fixture({events:[cc('cc',960,64)]});command(e,'tempo.set',{tempoMap:[{tick:0,bpm:120},{tick:960,bpm:60}]});params(e,{delayMs:500});const n=ons(e)[0];assert.equal(n.tick,1080);assert.equal(n.nominalEndTick,1320);assert.equal(stream(e).find(x=>x.kind==='raw').tick,1440);assert.equal(e.project.clips[0].notes[0].startTick,240);
});
test('MIDI modifiers: negative delay clamps project-start note pairs and raw events without orphan notes',()=>{
 const e=fixture({events:[cc('cc',0,64)]});params(e,{delayMs:-1000});const n=ons(e)[0];assert.equal(n.tick,0);assert.equal(n.nominalEndTick,1);assert.equal(stream(e).find(x=>x.kind==='raw').tick,0);assert.doesNotThrow(()=>writeMidi(e.project));
});
test('MIDI modifiers: bank MSB LSB program volume pan setup precedes original tick-zero data on its channel',()=>{
 const e=fixture({events:[cc('cc',0,55)]});params(e,{setupChannel:3,bankMsb:2,bankLsb:4,program:12,volume:90,pan:32});const setup=stream(e).filter(x=>x.setupParameter);assert.deepEqual(setup.map(x=>[x.status,...x.data]),[[179,0,2],[179,32,4],[195,12],[179,7,90],[179,10,32]]);assert.deepEqual(stream(e).slice(0,5),setup);assert.equal(e.project.clips[0].events.length,1);params(e,{program:null});assert.equal(stream(e).some(e=>e.setupParameter==='program'),false);
});
test('MIDI modifiers: schema discovery and validation reject invalid ratios ranges targets and audio tracks',()=>{
 assert.ok(getCommandCatalog().some(c=>c.name==='midi.modifiers.freeze'||c.command==='midi.modifiers.freeze'));
 const e=fixture();command(e,'track.add',{id:'audio',type:'audio'});const before=e.checkpoint();
 for(const settings of [{velocityRatio:{numerator:1,denominator:0}},{transpose:128},{seed:-1},{random:pair({target:'pitch',min:10,max:1},{target:'off',min:0,max:0})},{ranges:pair({mode:'noteFilter',min:80,max:40},{mode:'off',min:0,max:127})},{ranges:[]},{bypass:'true'}]){const result=e.execute({command:'midi.modifiers.set',arguments:{trackId:'t',settings}});assert.equal(result.applied,false);assert.equal(result.status,'error');assert.deepEqual(e.checkpoint(),before);}
 const audio=e.execute({command:'midi.trackParameters.set',arguments:{trackId:'audio',settings:{delayMs:20}}});assert.equal(audio.errors[0].code,'TYPE_MISMATCH');assert.deepEqual(e.checkpoint(),before);
});
test('MIDI modifiers: dry-run stale revision failed batch and undo leave source and settings atomic',()=>{
 const e=fixture(),before=e.checkpoint();set(e,{transpose:12});const after=e.project;command(e,'history.undo');assert.deepEqual(e.project.clips,before.project.clips);assert.equal(e.project.tracks[0].midiModifiers,undefined);command(e,'history.redo');assert.deepEqual(e.project.tracks,after.tracks);
 const checkpoint=e.checkpoint();command(e,'midi.modifiers.set',{trackId:'t',settings:{transpose:7}},{dryRun:true});assert.deepEqual(e.checkpoint(),checkpoint);
 const stale=e.execute({command:'midi.modifiers.set',arguments:{trackId:'t',settings:{transpose:4}},expectedRevision:0});assert.equal(stale.errors[0].code,'REVISION_CONFLICT');
 const batch=e.execute({command:'batch',arguments:{commands:[{command:'midi.modifiers.set',arguments:{trackId:'t',settings:{transpose:4}}},{command:'midi.partModifiers.set',arguments:{clipId:'missing',settings:{transpose:2}}}]}});assert.equal(batch.applied,false);assert.deepEqual(e.checkpoint(),checkpoint);
});
test('MIDI Freeze: modifiers part offsets delay setup and curves preserve emitted MIDI and exact PCM after reset',()=>{
 const e=fixture({events:[cc('a',0,20,{curve:{type:'ramp'}}),cc('b',960,110)]});set(e,{transpose:7,velocityRatio:{numerator:3,denominator:4},velocityShift:10,lengthRatio:{numerator:2,denominator:1},seed:7,random:pair({target:'position',min:-20,max:20},{target:'velocity',min:-10,max:10})});part(e,{transpose:5,velocityShift:-5});params(e,{delayMs:100,bankMsb:2,bankLsb:3,program:4,volume:110,pan:40});const beforeWire=wire(e),beforeMidi=writeMidi(e.project),beforePCM=renderProject(e.project),original=e.project;
 const result=command(e,'midi.modifiers.freeze',{trackId:'t'});assert.ok(result.changes.created.length>5);assert.deepEqual(e.project.tracks[0].midiModifiers,defaultModifiers());assert.deepEqual(e.project.tracks[0].midiParameters,defaultTrackParameters());assert.ok(e.project.clips.every(c=>(c.events??[]).every(x=>!x.curve)));assert.deepEqual(wire(e),beforeWire);assert.deepEqual(writeMidi(e.project),beforeMidi);const afterPCM=renderProject(e.project);assert.deepEqual(afterPCM.channels,beforePCM.channels);assert.equal(e.project.clips[0].notes[0].id,'n');assert.notDeepEqual(e.project.clips[0].notes,original.clips[0].notes);validateProject(e.project);
 const checkpoint=e.checkpoint(),again=command(e,'midi.modifiers.freeze',{trackId:'t'});assert.equal(again.status,'unchanged');assert.deepEqual(e.checkpoint(),checkpoint);
});
test('MIDI Freeze: filtered notes are removed only on commit and undo restores original settings and notes',()=>{
 const e=fixture();set(e,{ranges:pair({mode:'noteFilter',min:72,max:90},{mode:'off',min:0,max:127})});const before=e.project;command(e,'midi.modifiers.freeze',{trackId:'t'},{dryRun:true});assert.deepEqual(e.project,before);command(e,'midi.modifiers.freeze',{trackId:'t'});assert.equal(e.project.clips[0].notes.length,0);command(e,'history.undo');assert.deepEqual(e.project.clips,before.clips);assert.deepEqual(e.project.tracks,before.tracks);
});
test('MIDI Freeze: overlapping clips, note endpoints and coincident sampled/raw events retain stream order',()=>{
 const e=fixture({startTick:480,events:[cc('a',0,10,{order:10,curve:{type:'ramp'}}),cc('b',960,90,{order:11})]});command(e,'clip.add',{id:'c2',trackId:'t',type:'midi',name:'Overlap',startTick:0,lengthTicks:3840,notes:[{id:'other',pitch:65,velocity:70,startTick:960,durationTicks:480,channel:0,onOrder:20,offOrder:21}],events:[cc('later',960,33,{order:5})]});params(e,{delayMs:-100});set(e,{random:pair({target:'position',min:-100,max:100},{target:'off',min:0,max:0})});const before=wire(e);command(e,'midi.modifiers.freeze',{trackId:'t'});assert.deepEqual(wire(e),before);assert.equal(new Set(e.project.clips.map(c=>c.midiOrderGroup)).size,1);
});
test('MIDI Freeze: split-window sampled start is materialized without inventing a source Step',()=>{
 const e=fixture({events:[cc('window',0,30,{curve:{type:'ramp',window:{startTick:-240,endTick:960,startValue:10,endValue:110,emitStart:'sample'}}}),cc('end',960,110)]});const before=wire(e);command(e,'midi.modifiers.freeze',{trackId:'t'});assert.deepEqual(wire(e),before);assert.equal(e.project.clips[0].events.some(x=>x.id==='window'),false);assert.ok(e.project.clips[0].events.every(x=>x.curve===undefined));
});
test('MIDI Freeze: timing-dependent quantize references invalidate while unchanged local timing references survive',()=>{
 const e=fixture();command(e,'midi.notes.quantize',{clipId:'c',gridTicks:240,strength:0});set(e,{transpose:12});command(e,'midi.modifiers.freeze',{trackId:'t'});assert.ok(e.project.clips[0].notes[0].quantizeReference);set(e,{lengthRatio:{numerator:2,denominator:1}});const result=command(e,'midi.modifiers.freeze',{trackId:'t'});assert.deepEqual(result.changes.invalidatedQuantizeNoteIds,['n']);assert.equal(e.project.clips[0].notes[0].quantizeReference,undefined);
});
test('MIDI Freeze: release velocity and zero-velocity Note On encoding survive transformation',()=>{
 const e=fixture({notes:[{id:'n',pitch:60,startTick:0,durationTicks:480,velocity:100,channel:3,noteOffEncoding:'zeroVelocityNoteOn',releaseVelocity:0}]});set(e,{transpose:5});const before=wire(e);command(e,'midi.modifiers.freeze',{trackId:'t'});assert.deepEqual(wire(e),before);assert.equal(e.project.clips[0].notes[0].noteOffEncoding,'zeroVelocityNoteOn');assert.equal(stream(e).find(x=>x.kind==='noteOff').status,147);
});
test('MIDI modifiers: extended note output determines duration and Freeze keeps automatic render length',()=>{
 const e=fixture({lengthTicks:960,notes:[{id:'n',pitch:60,velocity:90,startTick:480,durationTicks:480,channel:0}]});set(e,{lengthRatio:{numerator:4,denominator:1}});params(e,{delayMs:500});assert.equal(projectDurationSeconds(e.project),1.75);const before=renderProject(e.project);command(e,'midi.modifiers.freeze',{trackId:'t'});assert.equal(projectDurationSeconds(e.project),1.75);assert.deepEqual(renderProject(e.project).channels,before.channels);
});
test('MIDI modifiers: modified silence and setup-only tracks produce valid output without phantom notes',()=>{
 const e=fixture({notes:[]});command(e,'clip.remove',{clipId:'c'});params(e,{program:3});assert.equal(ons(e).length,0);const before=writeMidi(e.project),pcm=renderProject(e.project);command(e,'midi.modifiers.freeze',{trackId:'t'});assert.equal(e.project.clips.length,1);assert.equal(e.project.clips[0].notes.length,0);assert.deepEqual(writeMidi(e.project),before);assert.deepEqual(renderProject(e.project).channels,pcm.channels);
});
test('MIDI modifiers: moving an unchanged note into a split fragment preserves its seeded variations',()=>{
 const e=fixture({notes:[{id:'first',pitch:60,startTick:0,durationTicks:240,velocity:80,channel:0},{id:'second',pitch:67,startTick:1920,durationTicks:240,velocity:90,channel:0}]});set(e,{seed:123,random:pair({target:'position',min:-30,max:30},{target:'velocity',min:-10,max:10})});const before=wire(e);command(e,'clip.split',{clipId:'c',atTick:960});assert.deepEqual(wire(e),before);
});
test('MIDI Freeze: selected muted track is processed and other tracks remain byte-identical',()=>{
 const e=fixture();command(e,'track.duplicate',{trackId:'t',newTrackId:'other'});const original=e.project,otherClips=original.clips.filter(c=>c.trackId==='other');command(e,'track.update',{trackId:'t',mute:true});set(e,{transpose:12});command(e,'midi.modifiers.freeze',{trackId:'t'});assert.equal(e.project.clips.find(c=>c.id==='c').notes[0].pitch,72);assert.deepEqual(e.project.clips.filter(c=>c.trackId==='other'),otherClips);assert.deepEqual(e.project.tracks[1],original.tracks[1]);assert.equal(e.project.tracks[0].mute,true);
});
test('MIDI Freeze: SysEx metadata and orphan note-off payloads survive delayed materialization',()=>{
 const e=fixture({events:[{id:'sysex',tick:10,kind:'sysex',status:240,data:[1,2,247]},{id:'meta',tick:20,kind:'meta',status:255,metaType:1,data:[65,66]},{id:'rawOff',tick:30,kind:'channel',status:128,data:[70,44]}]});params(e,{delayMs:250});const before=wire(e);command(e,'midi.modifiers.freeze',{trackId:'t'});assert.deepEqual(wire(e),before);assert.deepEqual(e.project.clips[0].events.map(e=>[e.id,e.data]),[['sysex',[1,2,247]],['meta',[65,66]],['rawOff',[70,44]]]);
});
test('MIDI modifiers: rendered pitch velocity and duration match independently constructed effective notes',()=>{
 const e=fixture();set(e,{transpose:12,velocityRatio:{numerator:1,denominator:2},lengthRatio:{numerator:3,denominator:2}});const expected=structuredClone(e.project);delete expected.tracks[0].midiModifiers;Object.assign(expected.clips[0].notes[0],{pitch:72,velocity:50,durationTicks:720});const actual=renderProject(e.project),reference=renderProject(expected);assert.equal(actual.channels[0].length,reference.channels[0].length);let difference=0;for(let i=0;i<actual.channels[0].length;i++)difference=Math.max(difference,Math.abs(actual.channels[0][i]-reference.channels[0][i]));assert.ok(difference<1e-6,`PCM error ${difference}`);assert.ok(actual.channels[0].some(v=>Math.abs(v)>.001));
});
test('MIDI Freeze: over-budget setup output and timing overflow roll back every source and setting',()=>{
 const e=fixture({events:Array.from({length:200000},(_,i)=>({id:'e'+i,tick:i%3841,kind:'channel',status:176,data:[1,i%128]}))});params(e,{program:4});const before=e.checkpoint();const result=e.execute({command:'midi.modifiers.freeze',arguments:{trackId:'t'}});assert.equal(result.status,'error');assert.equal(result.errors[0].code,'MIDI_TOO_LARGE');assert.deepEqual(e.checkpoint(),before);
 const big=fixture({startTick:Number.MAX_SAFE_INTEGER-10000,lengthTicks:1000});params(big,{delayMs:10000});const frozen=big.checkpoint();assert.equal(big.execute({command:'midi.modifiers.freeze',arguments:{trackId:'t'}}).applied,false);assert.deepEqual(big.checkpoint(),frozen);
});

test('MIDI modifiers: neutral group freeze retains revision and Undo boundary',()=>{
 const e=fixture();command(e,'track.duplicate',{trackId:'t',newTrackId:'other'});set(e,{transpose:12});command(e,'midi.modifiers.set',{trackId:'other',settings:{transpose:-12}});
 const before=e.checkpoint(),commands=['t','other'].map(trackId=>({command:'midi.modifiers.freeze',arguments:{trackId}}));command(e,'batch',{commands});const frozen=e.checkpoint();
 assert.deepEqual(e.project.clips.map(c=>c.notes[0].pitch),[72,48]);assert.equal(command(e,'batch',{commands}).status,'unchanged');assert.deepEqual(e.checkpoint(),frozen);
 command(e,'history.undo');assert.deepEqual(e.project.clips,before.project.clips);assert.deepEqual(e.project.tracks,before.project.tracks);
});
