import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject,validateProject} from '../src/core/engine.mjs';
import {compileMidiStreams} from '../src/media/midi-stream.mjs';
import {writeMidi,parseMidi} from '../src/media/midi.mjs';
import {renderProject} from '../src/media/render.mjs';
import {defaultModifiers,defaultTrackParameters} from '../src/media/midi-modifiers.mjs';
import {chaseMidiStreams} from '../src/media/midi-chase.mjs';
const run=(e,command,args={},extra={})=>{const r=e.execute({command,arguments:args,...extra});assert.notEqual(r.status,'error',JSON.stringify(r.errors));return r;};
const n=(id='n',startTick=0,extra={})=>({id,pitch:60,velocity:90,channel:0,startTick,durationTicks:0,...extra});
const cc=(tick,value,extra={})=>({kind:'channel',tick,status:176,data:[64,value],...extra});
function fixture(notes=[n()],events=[]){const e=new Engine(createProject({sampleRate:8000}));run(e,'track.add',{id:'t',type:'midi'});run(e,'clip.add',{id:'c',trackId:'t',type:'midi',lengthTicks:1920,notes,events});return e;}
const wire=p=>compileMidiStreams(p).tracks[0].events.map(e=>[e.tick,e.status,...e.data]);

test('Instantaneous notes: implicit note-on precedes its same-tick note-off including tick zero',()=>{
 const e=fixture([n('a'),n('b',0,{pitch:67}),n('last',100)]);
 assert.deepEqual(wire(e.project),[[0,144,60,90],[0,128,60,0],[0,144,67,90],[0,128,67,0],[100,144,60,90],[100,128,60,0]]);
 assert.equal(validateProject(e.project),true);
});
test('Instantaneous notes: explicit source order preserves intervening pedal and release encoding',()=>{
 const e=fixture([n('n',100,{onOrder:1,offOrder:3,noteOffEncoding:'zeroVelocityNoteOn'})],[cc(100,127,{order:2}),cc(200,0,{order:4})]);
 assert.deepEqual(wire(e.project),[[100,144,60,90],[100,176,64,127],[100,144,60,0],[200,176,64,0]]);
});
test('Instantaneous notes: backwards or orphan explicit off order rejects atomically in model and pure stream',()=>{
 const e=fixture(),before=e.checkpoint();
 for(const args of [{onOrder:5,offOrder:4},{offOrder:1},{onOrder:2,offOrder:2}]){
  const r=e.execute({command:'midi.notes.update',arguments:{clipId:'c',noteId:'n',...args}});assert.equal(r.errors[0].code,'MIDI_ZERO_NOTE_ORDER');assert.deepEqual(e.checkpoint(),before);
  const p=e.project;Object.assign(p.clips[0].notes[0],args);assert.throws(()=>compileMidiStreams(p),{code:'MIDI_ZERO_NOTE_ORDER'});
 }
});
test('Instantaneous notes: native SMF0 and SMF1 roundtrip keep zero duration release bytes and source order',()=>{
 const e=fixture([n('n',100,{onOrder:2,offOrder:4,releaseVelocity:73})],[cc(100,127,{order:3}),cc(200,0,{order:5})]);
 for(const format of [0,1]){
  const parsed=parseMidi(writeMidi(e.project,{format})),t=parsed.tracks.find(t=>t.notes.length),note=t.notes[0];
  assert.equal(note.durationTicks,0);assert.equal(note.startTick,100);assert.equal(note.releaseVelocity,73);assert.ok(note.onOrder<t.events[0].order&&t.events[0].order<note.offOrder);
  assert.equal(parsed.warnings.some(w=>w.includes('expanded')),false);
 }
});
test('Instantaneous notes: default and transpose output modifiers never inflate same-tick duration',()=>{
 const e=fixture();run(e,'midi.modifiers.set',{trackId:'t',settings:{transpose:12}});run(e,'midi.trackParameters.set',{trackId:'t',settings:{delayMs:50}});
 const stream=compileMidiStreams(e.project);assert.deepEqual(stream.tracks[0].events.map(e=>[e.tick,e.pitch]),[[96,72],[96,72]]);assert.equal(stream.modifierStats.clampedNotes,0);
 run(e,'midi.modifiers.set',{trackId:'t',settings:{lengthRatio:{numerator:7,denominator:2}}});assert.deepEqual(compileMidiStreams(e.project).tracks[0].events.map(e=>e.tick),[96,96]);
});
test('Instantaneous notes: an explicit length randomizer can expand zero while a negative adjustment stays zero',()=>{
 const e=fixture();
 for(const [value,wanted] of [[12,12],[-12,0]]){run(e,'midi.modifiers.set',{trackId:'t',settings:{random:[{target:'length',min:value,max:value},{target:'off',min:0,max:0}]}});assert.equal(compileMidiStreams(e.project).tracks[0].events[0].durationTicks,wanted);}
});
test('Instantaneous notes: Freeze stores the exact wire and grows its container for a delayed point at the end',()=>{
 const e=fixture([n('n',1919)]);run(e,'midi.trackParameters.set',{trackId:'t',settings:{delayMs:50}});const expected=wire(e.project);
 run(e,'midi.modifiers.freeze',{trackId:'t'});const c=e.project.clips[0];assert.equal(c.notes[0].durationTicks,0);assert.ok(c.notes[0].startTick<c.lengthTicks);assert.deepEqual(wire(e.project),expected);
 run(e,'history.undo');assert.equal(e.project.clips[0].notes[0].startTick,1919);
});
test('Instantaneous notes: start quantize clamps before exclusive part end and undo reset restores the zero reference',()=>{
 const e=fixture([n('n',1919)]);run(e,'midi.notes.quantize',{clipId:'c',noteIds:['n'],gridTicks:960,target:'start'});
 assert.equal(e.project.clips[0].notes[0].startTick,1919);assert.deepEqual(e.project.clips[0].notes[0].quantizeReference,{startTick:1919,durationTicks:0});
 run(e,'midi.notes.quantize',{clipId:'c',noteIds:['n'],gridTicks:960,target:'length'});assert.equal(e.project.clips[0].notes[0].durationTicks,0);
 run(e,'midi.notes.resetQuantize',{clipId:'c',noteIds:['n']});assert.equal(e.project.clips[0].notes[0].durationTicks,0);
 run(e,'midi.notes.freezeQuantize',{clipId:'c',noteIds:['n']});assert.equal(e.project.clips[0].notes[0].quantizeReference.durationTicks,0);
});
test('Instantaneous notes: split boundary moves one intact ordered pair to the right part',()=>{
 const e=fixture([n('left',479),n('right',480,{onOrder:2,offOrder:3})]);const expected=wire(e.project);
 run(e,'clip.split',{clipId:'c',atTick:480});assert.equal(e.project.clips[0].notes.length,1);assert.equal(e.project.clips[1].notes[0].startTick,0);assert.deepEqual(wire(e.project),expected);
 run(e,'history.undo');assert.equal(e.project.clips.length,1);
});
test('Instantaneous notes: Merge emits both endpoints at left and excludes both endpoints at right',()=>{
 const e=fixture([n('left',480,{releaseVelocity:45}),n('right',960)]);const r=run(e,'midi.mergeLoop',{leftTick:480,rightTick:960});
 const c=e.project.clips.find(c=>c.id===r.changes.merge.clipId);assert.equal(c.notes.length,1);assert.equal(c.notes[0].durationTicks,0);assert.ok(c.notes[0].onOrder<c.notes[0].offOrder);
 const p=e.project;p.tracks=p.tracks.filter(t=>t.id===c.trackId);p.clips=[c];assert.deepEqual(wire(p),[[480,144,60,90],[480,128,60,45]]);
});
test('Instantaneous notes: unheld notes are silent and finite in legacy and stateful oscillator paths',()=>{
 for(const events of [[],[{tick:0,kind:'channel',status:176,data:[7,100]}]])for(const instrument of ['sine','triangle','sawtooth']){
  const e=fixture([n('n',100)],events);run(e,'track.update',{trackId:'t',instrument});const r=renderProject(e.project);assert.ok(r.channels.every(c=>c.every(x=>x===0)));
 }
});
test('Instantaneous notes: pedal-held same-tick pairs sound until release without any one-tick timing inflation',()=>{
 const e=fixture([n('n',100,{onOrder:2,offOrder:3})],[cc(100,127,{order:1}),cc(960,0,{order:4})]);
 const r=renderProject(e.project),channel=r.channels[0];assert.ok(channel.slice(1000,3000).some(x=>Math.abs(x)>.001));assert.ok(channel.slice(4401).every(x=>x===0));assert.ok(channel.every(Number.isFinite));
 assert.equal(e.project.clips[0].notes[0].durationTicks,0);
});
test('Instantaneous notes: source Chase held-note prefix can be represented as an exact ordered MIDI part',()=>{
 const e=fixture([n('held',0,{durationTicks:100,releaseVelocity:47})],[cc(10,127),cc(960,0)]),p=e.project,compiled=compileMidiStreams(p),prefix=chaseMidiStreams(compiled,p,{tick:480}).tracks[0].events;
 const on=prefix.find(e=>e.kind==='noteOn'),off=prefix.find(e=>e.kind==='noteOff');assert.equal(on.tick,off.tick);
 const model=new Engine(createProject());run(model,'track.add',{id:'t',type:'midi'});run(model,'clip.add',{id:'c',trackId:'t',type:'midi',startTick:480,lengthTicks:480,
  notes:[n('n',0,{onOrder:prefix.indexOf(on),offOrder:prefix.indexOf(off),releaseVelocity:off.releaseVelocity})],
  events:prefix.filter(e=>e.kind==='raw').map(e=>({kind:e.rawKind,tick:0,status:e.status,data:e.data,order:prefix.indexOf(e)}))});
 assert.deepEqual(wire(model.project),prefix.map(e=>[e.tick,e.status,...e.data]));
});
test('Instantaneous notes: invalid negative duration dry run and later batch failure preserve complete history',()=>{
 const e=fixture(),before=e.checkpoint();run(e,'midi.notes.add',{clipId:'c',notes:[n('new',100)]},{dryRun:true});assert.deepEqual(e.checkpoint(),before);
 assert.equal(e.execute({command:'midi.notes.update',arguments:{clipId:'c',noteId:'n',durationTicks:-1}}).status,'error');
 assert.equal(e.execute({command:'batch',arguments:{commands:[{command:'midi.notes.add',arguments:{clipId:'c',notes:[n('new',100)]}},{command:'clip.remove',arguments:{clipId:'missing'}}]}}).status,'error');assert.deepEqual(e.checkpoint(),before);
});

test('Merge Chase: key-down and pedal-held sources create exact remaining and zero-duration notes',()=>{
 const e=fixture([n('held',0,{durationTicks:100}),n('down',200,{durationTicks:800,pitch:67})],[cc(10,127),cc(800,0)]);
 const r=run(e,'midi.mergeLoop',{leftTick:480,rightTick:960,includeChase:true}),c=e.project.clips.at(-1);
 assert.equal(r.changes.merge.chasedNoteCount,2);assert.deepEqual(c.notes.map(n=>[n.pitch,n.startTick,n.durationTicks]),[[60,0,0],[67,0,520]]);assert.equal(c.allowNoteTails,true);
 const p=e.project;p.tracks=p.tracks.filter(t=>t.id===c.trackId);p.clips=[c];const audio=renderProject(p);assert.ok(audio.channels[0].slice(2300,3000).some(n=>Math.abs(n)>.001));assert.ok(audio.channels[0].slice(4700).every(n=>n===0));
});
test('Merge Chase: a prior raw note-off cannot inflate a released-held note to its later paired endpoint',()=>{
 const e=fixture([n('held',0,{durationTicks:1200})],[cc(10,127),{tick:100,kind:'channel',status:128,data:[60,37]},cc(800,0)]);
 run(e,'midi.mergeLoop',{leftTick:480,rightTick:960,includeChase:true});const c=e.project.clips.at(-1);assert.equal(c.notes[0].durationTicks,0);assert.equal(c.notes[0].releaseVelocity,37);
});
test('Merge Chase: options select SysEx and program while excluding notes and part-external controllers',()=>{
 const e=fixture([n('held',0,{durationTicks:1000})],[{tick:10,kind:'channel',status:192,data:[9]},{tick:20,kind:'sysex',status:240,data:[67,1,247]},cc(30,127)]);
 run(e,'midi.mergeLoop',{leftTick:480,rightTick:960,includeChase:true,chaseOptions:{notes:false,controllers:false,sysex:true}});const c=e.project.clips.at(-1);assert.equal(c.notes.length,0);assert.deepEqual(c.events.map(e=>[e.status,...e.data]),[[192,9],[240,67,1,247]]);
});
test('Merge Chase: a note ending exactly at locate is an ordered zero pair and malformed options leave state unchanged',()=>{
 const e=fixture([n('ends',0,{durationTicks:480})]);const before=e.checkpoint();
 assert.equal(e.execute({command:'midi.mergeLoop',arguments:{leftTick:480,rightTick:960,includeChase:true,chaseOptions:{notes:1}}}).status,'error');assert.deepEqual(e.checkpoint(),before);
 run(e,'midi.mergeLoop',{leftTick:480,rightTick:960,includeChase:true});assert.equal(e.project.clips.at(-1).notes[0].durationTicks,0);
});
test('Sostenuto playback: only rising-edge captured keys sustain and simultaneous zero pairs obey explicit order',()=>{
 const e=fixture([n('captured',100,{onOrder:1,offOrder:3}),n('late',200,{pitch:67,durationTicks:100})],[{tick:100,kind:'channel',status:176,data:[66,127],order:2},{tick:960,kind:'channel',status:176,data:[66,0],order:4}]);
 const full=renderProject(e.project);assert.ok(full.channels[0].slice(2000,3000).some(n=>Math.abs(n)>.001));assert.ok(full.channels[0].slice(4401).every(n=>n===0));
 const p=e.project;p.clips[0].notes=p.clips[0].notes.filter(n=>n.id==='late');const late=renderProject(p);assert.ok(late.channels[0].slice(1700).every(n=>n===0));
});
test('Sostenuto playback: Chase reconstruction and Freeze preserve the same rendered output after locate',()=>{
 const e=fixture([n('captured',100,{durationTicks:100}),n('down',300,{pitch:67,durationTicks:600})],[{tick:150,kind:'channel',status:176,data:[66,127]},{tick:960,kind:'channel',status:176,data:[66,0]}]);
 run(e,'midi.mergeLoop',{leftTick:480,rightTick:1200,includeChase:true});const c=e.project.clips.at(-1);assert.deepEqual(c.notes.map(n=>n.durationTicks),[0,420]);
 run(e,'midi.modifiers.set',{trackId:c.trackId,settings:{transpose:12}});const p=e.project;p.tracks=p.tracks.filter(t=>t.id===c.trackId);p.clips=[c];const before=renderProject(p,new Map(),{durationSeconds:1});
 run(e,'midi.modifiers.freeze',{trackId:c.trackId});const q=e.project;q.tracks=q.tracks.filter(t=>t.id===c.trackId);q.clips=q.clips.filter(x=>x.trackId===c.trackId);const after=renderProject(q,new Map(),{durationSeconds:1});assert.deepEqual(after.channels,before.channels);assert.ok(after.channels[0].slice(2200,3000).some(n=>Math.abs(n)>.001));
});
