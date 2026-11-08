import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject} from '../src/core/engine.mjs';
import {compileNotePaint,planNotePaint} from '../src/media/note-paint.mjs';
import {writeMidi,parseMidi} from '../src/media/midi.mjs';
import {renderProject} from '../src/media/render.mjs';
const ok=(e,command,args={})=>{const r=e.execute({command,arguments:args});assert.equal(r.status,'applied',JSON.stringify(r));return r;};
const note=(id,tick,extra={})=>({id,startTick:tick,durationTicks:120,pitch:69,velocity:70,channel:0,...extra});
function fixture(notes=[0,240,333,480,720,960,1200].map((t,i)=>note('n'+i,t))){const e=new Engine(createProject({sampleRate:8000}));ok(e,'track.add',{id:'t',type:'midi',instrument:'sine'});ok(e,'clip.add',{id:'clip',type:'midi',trackId:'t',lengthTicks:3840,notes,events:[{id:'cc',tick:300,kind:'channel',status:176,data:[11,100]},{id:'raw',tick:400,kind:'sysex',status:240,data:[125,247]}]});return e;}
const clip=e=>e.project.clips[0],args=(extra={})=>({clipId:'clip',field:'velocity',path:[{tick:0,value:20},{tick:960,value:100}],...extra}),values=e=>clip(e).notes.map(n=>n.velocity);
function reject(e,a,code){const p=e.project,h=e.exportHistory(),r=e.execute({command:'midi.notes.paint',arguments:a});assert.equal(r.status,'error',JSON.stringify(a));if(code)assert.equal(r.errors[0].code,code);assert.deepEqual(e.project,p);assert.deepEqual(e.exportHistory(),h);}

test('Note Paint: exact original onsets follow straight path and unrelated source is unchanged',()=>{
 const e=fixture(),before=clip(e),r=ok(e,'midi.notes.paint',args());assert.deepEqual(values(e),[20,40,48,60,80,100,70]);assert.deepEqual(clip(e).events,before.events);assert.deepEqual(clip(e).notes.map(({velocity,...n})=>n),before.notes.map(({velocity,...n})=>n));assert.deepEqual(r.changes.created,[]);assert.deepEqual(r.changes.removed,[]);assert.equal(r.changes.notePaint.matchedNoteCount,6);
});
test('Note Paint: turns follow piecewise path and last traversal wins without losing visited tail',()=>{
 const e=fixture();ok(e,'midi.notes.paint',args({path:[{tick:0,value:20},{tick:960,value:100},{tick:480,value:10},{tick:720,value:60}]}));assert.deepEqual(values(e),[20,40,48,10,60,100,70]);
});
test('Note Paint: opposite direction evaluates the same straight geometry',()=>{
 const e=fixture();ok(e,'midi.notes.paint',args({path:[{tick:960,value:100},{tick:0,value:20}]}));assert.deepEqual(values(e),[20,40,48,60,80,100,70]);
});
test('Note Paint: single click and vertical path edit only exact onset and all coincident notes',()=>{
 const e=fixture([note('a',240),note('b',240,{pitch:72}),note('c',241)]);ok(e,'midi.notes.paint',args({path:[{tick:240,value:10},{tick:240,value:90.5}]}));assert.deepEqual(values(e),[91,91,70]);ok(e,'midi.notes.paint',args({path:[{tick:240,value:30}]}));assert.deepEqual(values(e),[30,30,70]);
});
test('Note Paint: fractional pointer ticks and values round once at exact note time',()=>{
 const e=fixture([note('a',240)]);ok(e,'midi.notes.paint',args({path:[{tick:239.75,value:30.25},{tick:240.25,value:90.75}]}));assert.deepEqual(values(e),[61]);const empty=planNotePaint(e.project,args({path:[{tick:240.25,value:99}]}));assert.deepEqual(empty.points,[]);
});
test('Note Paint: sparse and dense collinear pointer packets agree without density lattice',()=>{
 const e=fixture(),sparse=planNotePaint(e.project,args()),dense=planNotePaint(e.project,args({path:Array.from({length:17},(_,i)=>({tick:i*60,value:20+i*5}))}));assert.deepEqual(dense.points,sparse.points);reject(e,args({density:{mode:'ticks',stepTicks:240}}));
});
test('Note Paint: selected IDs restrict whole path and channel selection intersects without fallback',()=>{
 const e=fixture([note('a',240),note('b',240,{pitch:72}),note('other',480,{channel:1}),note('later',720)]);ok(e,'midi.notes.paint',args({selectedNoteIds:['b','other'],channel:0}));assert.deepEqual(values(e),[70,40,70,70]);reject(e,args({selectedNoteIds:['missing']}),'NOT_FOUND');reject(e,args({selectedNoteIds:['b','b']}));
});
test('Note Paint: range uses onset rather than overlapping note tails and leaves unvisited gaps unchanged',()=>{
 const e=fixture([note('tail',0,{durationTicks:2000}),note('a',240),note('b',480),note('c',720)]);ok(e,'midi.notes.paint',args({path:[{tick:240,value:10},{tick:480,value:110},{tick:240,value:20}]}));assert.deepEqual(values(e),[70,20,110,70]);
});
test('Note Paint: elapsed interpolation accounts for clip offset and fractional tempo-boundary packets',()=>{
 const e=fixture([note('a',0),note('b',480),note('c',960),note('d',1440),note('z',1920)]);ok(e,'clip.update',{clipId:'clip',startTick:2880});ok(e,'tempo.set',{tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}]});ok(e,'project.timeDisplay',{options:{pianoMode:'time-linear'}});ok(e,'midi.notes.paint',args({path:[{tick:0,value:10},{tick:1920,value:100}]}));assert.deepEqual(values(e),[10,25,40,70,100]);const p=planNotePaint(e.project,args({path:[{tick:959.5,value:10},{tick:960.5,value:100}]}));assert.equal(p.points[0].value,40);
});
test('Note Paint: frozen project selection and request mutations cannot change an active plan',()=>{
 const e=fixture(),project=e.project,ids=['n1'],start={tick:0,value:20},p=compileNotePaint(project,{clipId:'clip',field:'velocity',selectedNoteIds:ids,start});ids.push('n2');start.value=127;project.clips[0].notes[1].startTick=0;project.timeDisplay={pianoMode:'time-linear'};p.push({tick:960,value:100});const s=p.snapshot();assert.deepEqual(s.points,[{noteId:'n1',tick:240,value:40}]);s.points[0].value=1;const r=p.finish();assert.equal(r.plan.points[0].value,40);assert.deepEqual(r.arguments.selectedNoteIds,['n1']);assert.throws(()=>p.push({tick:960,value:10}),{code:'NOTE_PAINT_CLOSED'});
});
test('Note Paint: note sample and work limits poison commit without partial segment preview',()=>{
 const e=fixture();for(const budget of [{maxNotes:1},{maxWork:2},{maxSamples:1}]){const p=compileNotePaint(e.project,{clipId:'clip',field:'velocity',start:{tick:0,value:20},...budget}),before=p.snapshot();assert.throws(()=>p.push({tick:960,value:100}),{code:'NOTE_PAINT_LIMIT'});assert.deepEqual(p.snapshot().points,before.points);assert.throws(()=>p.finish(),{code:'NOTE_PAINT_ABORTED'});}
});
test('Note Paint: malformed input invalid field value and late sample fail atomically',()=>{
 const e=fixture();for(const a of [args({path:[]}),args({field:'pitch'}),args({channel:16}),args({selectedNoteIds:null}),args({path:[{tick:0,value:0}]}),args({path:[{tick:0,value:20},{tick:4000,value:20}]}),args({path:[{tick:0,value:NaN}]}),args({path:[{tick:-1,value:30}]}),args({path:[{tick:0,value:30,extra:true}]}),args({stepTicks:1})])reject(e,a);
 const p=compileNotePaint(e.project,{clipId:'clip',field:'velocity',start:{tick:0,value:20}});p.push({tick:480,value:90});assert.throws(()=>p.push({tick:500,value:128}));assert.throws(()=>p.finish(),{code:'NOTE_PAINT_ABORTED'});
});
test('Note Paint: release edits convert only nonzero zero-velocity note-ons and Undo restores encoding',()=>{
 const e=fixture([note('a',0,{releaseVelocity:0,noteOffEncoding:'zeroVelocityNoteOn',onOrder:20,offOrder:21}),note('b',480,{releaseVelocity:0,noteOffEncoding:'zeroVelocityNoteOn',onOrder:22,offOrder:23,quantizeReference:{startTick:470,durationTicks:100}}),note('c',960,{releaseVelocity:50,noteOffEncoding:'noteOff'})]),before=clip(e);ok(e,'midi.notes.paint',args({field:'releaseVelocity',path:[{tick:0,value:0},{tick:960,value:100}]}));assert.deepEqual(clip(e).notes.map(n=>n.releaseVelocity),[0,50,100]);assert.deepEqual(clip(e).notes.map(n=>n.noteOffEncoding),['zeroVelocityNoteOn','noteOff','noteOff']);assert.deepEqual(clip(e).notes.map(({releaseVelocity,noteOffEncoding,...n})=>n),before.notes.map(({releaseVelocity,noteOffEncoding,...n})=>n));assert.deepEqual(parseMidi(writeMidi(e.project)).tracks.flatMap(t=>t.notes).map(n=>n.releaseVelocity),[0,50,100]);ok(e,'history.undo');assert.deepEqual(clip(e),before);
});
test('Note Paint: revisiting release zero preserves original absent field and note-on encoding',()=>{
 const e=fixture([note('a',0),note('b',480,{releaseVelocity:0,noteOffEncoding:'zeroVelocityNoteOn'})]),before=clip(e);ok(e,'midi.notes.paint',args({field:'releaseVelocity',path:[{tick:0,value:50},{tick:480,value:100},{tick:0,value:0},{tick:480,value:0}]}));assert.deepEqual(clip(e),before);
});
test('Note Paint: dry-run and late batch failure preserve full project and history',()=>{
 const e=fixture(),before=e.project,h=e.exportHistory(),r=e.execute({command:'midi.notes.paint',arguments:args(),dryRun:true});assert.equal(r.applied,false);assert.equal(r.changes.notePaint.matchedNoteCount,6);assert.deepEqual(e.project,before);const bad=e.execute({command:'batch',arguments:{commands:[{command:'midi.notes.paint',arguments:args()},{command:'midi.notes.paint',arguments:args({selectedNoteIds:['missing']})}]}});assert.equal(bad.status,'error');assert.deepEqual(e.project,before);assert.deepEqual(e.exportHistory(),h);
});
test('Note Paint: one Undo Redo restores exact SMF and rendered audio',()=>{
 const e=fixture(),before=clip(e),midi=writeMidi(e.project),pcm=renderProject(e.project).channels,rev=e.project.revision;ok(e,'midi.notes.paint',args());assert.equal(e.project.revision,rev+1);const after=clip(e),changed=renderProject(e.project).channels;assert.notDeepEqual(changed,pcm);ok(e,'history.undo');assert.deepEqual(clip(e),before);assert.deepEqual(writeMidi(e.project),midi);assert.deepEqual(renderProject(e.project).channels,pcm);ok(e,'history.redo');assert.deepEqual(clip(e),after);
});
test('Note Paint: very long sparse range does not generate points or consume source-length work',()=>{
 const e=fixture(),project=e.project;project.clips[0].lengthTicks=Number.MAX_SAFE_INTEGER;const p=planNotePaint(project,args({path:[{tick:0,value:10},{tick:Number.MAX_SAFE_INTEGER,value:100}]}));assert.equal(p.points.length,7);assert.equal(p.work,8);assert.ok(p.points.every(n=>n.value===10));
});
