import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject} from '../src/core/engine.mjs';
import {compileControllerShape} from '../src/media/controller-shapes.mjs';
import {compileControllerShapeGesture} from '../src/media/controller-shape-gesture.mjs';
import {planNoteShape} from '../src/media/note-shapes.mjs';
import {writeMidi,parseMidi} from '../src/media/midi.mjs';
import {renderProject} from '../src/media/render.mjs';
const ok=(e,command,args={})=>{const r=e.execute({command,arguments:args});assert.equal(r.status,'applied',JSON.stringify(r));return r;};
const note=(id,tick,extra={})=>({id,startTick:tick,durationTicks:120,pitch:69,velocity:70,channel:0,...extra});
function fixture(notes=[note('a',0),note('b',240),note('c',480),note('d',720),note('e',960)]){const e=new Engine(createProject({sampleRate:8000}));ok(e,'track.add',{id:'t',type:'midi',instrument:'sine'});ok(e,'clip.add',{id:'clip',type:'midi',trackId:'t',lengthTicks:3840,notes,events:[{id:'cc',tick:300,kind:'channel',status:176,data:[11,100]},{id:'raw',tick:400,kind:'sysex',status:240,data:[125,247]}]});return e;}
const clip=e=>e.project.clips[0],args=(extra={})=>({clipId:'clip',field:'velocity',kind:'line',startTick:0,endTick:960,startValue:20,endValue:100,...extra});
function reject(e,a,code){const p=structuredClone(e.project),h=e.exportHistory(),r=e.execute({command:'midi.notes.shape',arguments:a});assert.equal(r.status,'error',JSON.stringify(a));if(code)assert.equal(r.errors[0].code,code);assert.deepEqual(e.project,p);assert.deepEqual(e.exportHistory(),h);}

test('Note shapes: five independent landmark oracles update existing note values without events',()=>{
 const expected={line:[20,40,60,80,100],parabola:[20,25,40,65,100],sine:[20,60,100,60,20],triangle:[20,60,100,60,20],square:[100,100,20,20,100]};
 for(const [kind,values] of Object.entries(expected)){const e=fixture(),before=structuredClone(clip(e)),r=ok(e,'midi.notes.shape',args({kind,...(!['line','parabola'].includes(kind)?{periodTicks:960}:{})}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),values);assert.deepEqual(clip(e).events,before.events);assert.deepEqual(r.changes.created,[]);assert.deepEqual(r.changes.removed,[]);assert.equal(r.changes.noteShape.matchedNoteCount,5);assert.deepEqual(clip(e).notes.map(({velocity,...n})=>n),before.notes.map(({velocity,...n})=>n));}
});
test('Note shapes: irregular onsets evaluate the formula directly rather than a density lattice',()=>{
 const e=fixture([note('a',333),note('b',617)]);ok(e,'midi.notes.shape',args({kind:'parabola'}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),[30,53]);assert.deepEqual(clip(e).notes.map(n=>n.startTick),[333,617]);reject(e,args({density:{mode:'ticks',stepTicks:240}}));
});
test('Note shapes: right to left keeps line endpoints and Parabola click direction',()=>{
 const e=fixture();ok(e,'midi.notes.shape',args({kind:'parabola',startTick:960,endTick:0,startValue:100,endValue:20}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),[20,55,80,95,100]);ok(e,'midi.notes.shape',args({startTick:960,endTick:0,startValue:100,endValue:20}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),[20,40,60,80,100]);
});
test('Note shapes: no selection edits all coincident notes while explicit IDs restrict the entire range',()=>{
 const e=fixture([note('a',240),note('b',240,{pitch:72}),note('c',480),note('d',720)]);ok(e,'midi.notes.shape',args());assert.deepEqual(clip(e).notes.map(n=>n.velocity),[40,40,60,80]);ok(e,'history.undo');ok(e,'midi.notes.shape',args({selectedNoteIds:['b','d']}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),[70,40,70,80]);reject(e,args({selectedNoteIds:['missing']}),'NOT_FOUND');reject(e,args({selectedNoteIds:['a','a']}));
});
test('Note shapes: range is inclusive at note onset with channel and selection intersection',()=>{
 const e=fixture([note('tail',0,{durationTicks:2000}),note('left',240),note('other',480,{channel:1}),note('right',720),note('outside',721)]),before=structuredClone(clip(e));ok(e,'midi.notes.shape',args({startTick:240,endTick:720,channel:0,selectedNoteIds:['left','other','right','outside']}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),[70,20,70,100,70]);for(const id of ['tail','other','outside'])assert.deepEqual(clip(e).notes.find(n=>n.id===id),before.notes.find(n=>n.id===id));
});
test('Note shapes: release values convert only unencodable note-offs and preserve source order and references',()=>{
 const e=fixture([note('zero',0,{noteOffEncoding:'zeroVelocityNoteOn',releaseVelocity:0,onOrder:20,offOrder:21}),note('positive',480,{noteOffEncoding:'zeroVelocityNoteOn',releaseVelocity:0,onOrder:22,offOrder:23,quantizeReference:{startTick:470,durationTicks:100}}),note('explicit',960,{noteOffEncoding:'noteOff',releaseVelocity:40,onOrder:24,offOrder:25})]);const before=structuredClone(clip(e));ok(e,'midi.notes.shape',args({field:'releaseVelocity',startValue:0,endValue:100}));assert.deepEqual(clip(e).notes.map(n=>n.releaseVelocity),[0,50,100]);assert.deepEqual(clip(e).notes.map(n=>n.noteOffEncoding),['zeroVelocityNoteOn','noteOff','noteOff']);assert.deepEqual(clip(e).notes.map(({releaseVelocity,noteOffEncoding,...n})=>n),before.notes.map(({releaseVelocity,noteOffEncoding,...n})=>n));ok(e,'history.undo');assert.deepEqual(clip(e),before);
});
test('Note shapes: unchanged absent release zero stays absent and a zero-valued shape is valid',()=>{
 const e=fixture(),p=planNoteShape(e.project,args({field:'releaseVelocity',startValue:0,endValue:0}));assert.equal(p.points.length,5);assert.deepEqual(p.updates,[]);ok(e,'midi.notes.shape',args({field:'releaseVelocity',startValue:0,endValue:0}));assert.ok(clip(e).notes.every(n=>!Object.hasOwn(n,'releaseVelocity')));
});
test('Note shapes: malformed irrelevant out-of-range and zero attack values reject atomically',()=>{
 const e=fixture();for(const a of [args({startValue:0}),args({endValue:128}),args({kind:'line',phase:0}),args({kind:'sine'}),args({kind:'triangle',periodTicks:960,peak:2}),args({endTick:0}),args({startTick:-1}),args({endTick:4000}),args({channel:16}),args({field:'pitch'}),args({maxValue:127}),args({selectedNoteIds:null})])reject(e,a);
});
test('Note shapes: dry-run and late failed batch leave project and persistent history unchanged',()=>{
 const e=fixture(),p=structuredClone(e.project),h=e.exportHistory();const dry=e.execute({command:'midi.notes.shape',arguments:args(),dryRun:true});assert.equal(dry.applied,false);assert.equal(dry.changes.noteShape.updatedNoteCount,5);assert.deepEqual(e.project,p);const bad=e.execute({command:'batch',arguments:{commands:[{command:'midi.notes.shape',arguments:args()},{command:'midi.notes.shape',arguments:args({selectedNoteIds:['absent']})}]}});assert.equal(bad.status,'error');assert.deepEqual(e.project,p);assert.deepEqual(e.exportHistory(),h);
});
test('Note shapes: time-linear Line and Parabola follow exact elapsed progress across tempo changes',()=>{
 const e=fixture([note('a',0),note('b',480),note('c',960),note('d',1440),note('e',1920)]);ok(e,'tempo.set',{tempoMap:[{tick:0,bpm:120},{tick:960,bpm:60}]});ok(e,'project.timeDisplay',{options:{pianoMode:'time-linear'}});ok(e,'midi.notes.shape',args({endTick:1920,startValue:10,endValue:100}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),[10,25,40,70,100]);ok(e,'midi.notes.shape',args({kind:'parabola',endTick:1920,startValue:10,endValue:100}));assert.deepEqual(clip(e).notes.map(n=>n.velocity),[10,13,20,50,100]);
});
test('Note shapes: arbitrary exact tick evaluator snapshots options and bounds its public domain',()=>{
 const e=fixture(),a=args({kind:'parabola'});delete a.field;const c=compileControllerShape(e.project,a);a.reverse=true;a.endValue=5;e.project.timeDisplay={pianoMode:'time-linear'};assert.equal(c.valueAt(240),25);for(const t of [-1,961,1.5,NaN])assert.throws(()=>c.valueAt(t));assert.throws(()=>compileControllerShape(e.project,{...a,kind:'line',exponent:2}));
});
test('Note shapes: one Undo Redo restores exact SMF and PCM while release velocity remains MIDI-only',()=>{
 const e=fixture(),before=structuredClone(clip(e)),wire=writeMidi(e.project),pcm=renderProject(e.project).channels;const rev=e.project.revision;ok(e,'midi.notes.shape',args());assert.equal(e.project.revision,rev+1);const after=structuredClone(clip(e)),changed=renderProject(e.project).channels;assert.notDeepEqual(changed,pcm);ok(e,'history.undo');assert.deepEqual(clip(e),before);assert.deepEqual(writeMidi(e.project),wire);assert.deepEqual(renderProject(e.project).channels,pcm);ok(e,'history.redo');assert.deepEqual(clip(e),after);ok(e,'midi.notes.shape',args({field:'releaseVelocity',startValue:0,endValue:100}));assert.deepEqual(renderProject(e.project).channels,changed);const parsed=parseMidi(writeMidi(e.project));assert.deepEqual(parsed.tracks.flatMap(t=>t.notes).map(n=>n.releaseVelocity),[0,25,50,75,100]);
});
test('Note shapes: source-wide sparse range has no generated-point limit',()=>{
 const e=fixture([note('a',1)]);const project=e.project;project.clips[0].notes[0].startTick=2000001;project.clips[0].lengthTicks=4000000;const p=planNoteShape(project,args({kind:'square',startTick:0,endTick:4000000,periodTicks:1000000}));assert.equal(p.points.length,1);assert.equal(p.points[0].value,100);
});

test('Note shape gesture: frozen selection and source onsets ignore density and preserve modifier phase',()=>{
 const e=fixture([note('a',333),note('b',617)]),project=e.project,target={field:'velocity',channel:'all',selectedNoteIds:['a']};
 const g=compileControllerShapeGesture(project,{clipId:'clip',kind:'triangle',snapEnabled:false,zoom:960,start:{tick:0,value:20,x:0,y:90},periodTicks:960,noteTarget:target});
 g.update({tick:960,value:100,x:960,y:20});target.selectedNoteIds.push('b');project.clips[0].notes[0].startTick=0;
 g.update({tick:960,value:100,x:960,y:20},{ctrlKey:true});g.update({tick:1200,value:100,x:1200,y:20},{ctrlKey:true});
 const p=g.preview();assert.equal(p.points.length,1);assert.equal(p.points[0].tick,333);assert.equal(p.points[0].value,85);const result=g.finish();assert.equal(result.arguments.phase,.25);assert.equal(result.arguments.density,undefined);assert.deepEqual(result.arguments.selectedNoteIds,['a']);assert.deepEqual(result.plan,p);
});
test('Note shape gesture: Line handles both directions and ignores waveform modifier meanings',()=>{
 const e=fixture();const g=compileControllerShapeGesture(e.project,{clipId:'clip',kind:'line',snapEnabled:false,zoom:960,start:{tick:960,value:100,x:960,y:20},noteTarget:{field:'velocity'}});
 g.update({tick:0,value:20,x:0,y:90},{ctrlKey:true,shiftKey:true});const r=g.finish();assert.equal(r.arguments.exponent,undefined);assert.equal(r.arguments.reverse,undefined);assert.deepEqual(r.plan.points.map(p=>p.value),[20,40,60,80,100]);
});
test('Note shape gesture: zero attack translation and stale note target poison whole gesture',()=>{
 const e=fixture();const g=compileControllerShapeGesture(e.project,{clipId:'clip',kind:'parabola',snapEnabled:false,zoom:960,start:{tick:0,value:1,x:0,y:110},noteTarget:{field:'velocity'}});
 g.update({tick:960,value:100,x:960,y:20});g.update({tick:960,value:100,x:960,y:20},{altKey:true});g.update({tick:960,value:99,x:960,y:21},{altKey:true});assert.throws(()=>g.preview());assert.throws(()=>g.finish(),{code:'CONTROLLER_SHAPE_ABORTED'});
 assert.throws(()=>compileControllerShapeGesture(e.project,{clipId:'clip',kind:'line',start:{tick:0,value:20,x:0,y:90},noteTarget:{field:'velocity',clipId:'different'}}),{code:'INVALID_NOTE_SHAPE'});
});
