import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/core/engine.mjs';
import {resolveFormattedTimeCommand as resolve} from '../src/media/formatted-time-command.mjs';
const fixture=()=>({...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}],timeDisplay:{primaryFormat:'seconds'},clips:[{id:'c',type:'midi',startTick:2880,lengthTicks:9600,notes:[{id:'n',startTick:0,durationTicks:959,pitch:60,velocity:90}]}]});
const args={clipId:'c',noteId:'n'},error=code=>e=>e.code===code;
test('Formatted edit: note local position and duration use clip origin and new tempo anchor',()=>{
 const p=fixture(),before=JSON.stringify(p),a={...args,velocity:77},times={startTick:'00:00:01.000',durationTicks:'00:00:01.000'};
 const r=resolve(p,'midi.notes.update',a,times);assert.equal(r.arguments.startTick,1440);assert.equal(r.arguments.durationTicks,960);assert.equal(r.conversions[1].startTick,4320);assert.equal(r.conversions[0].tick,4320);assert.equal(JSON.stringify(p),before);assert.deepEqual(a,{...args,velocity:77});
});
test('Formatted edit: clip absolute start and anchored duration differ from note local coordinates',()=>{
 const r=resolve(fixture(),'clip.update',{clipId:'c'},{startTick:'00:00:03.000',lengthTicks:'00:00:01.000'});assert.equal(r.arguments.startTick,4800);assert.equal(r.arguments.lengthTicks,960);assert.equal(r.scope,'timeline');
});
test('Formatted edit: omitted times retain source identity and raw supplied start anchors duration',()=>{
 const p=fixture();let r=resolve(p,'midi.notes.update',{...args,velocity:77},{});assert.deepEqual(r.arguments,{...args,velocity:77});assert.deepEqual(r.conversions,[]);
 r=resolve(p,'midi.notes.update',{...args,startTick:1920},{durationTicks:'00:00:01.000'});assert.equal(r.arguments.durationTicks,960);assert.equal(r.conversions[0].startTick,4800);
});
test('Formatted edit: explicit source rounding reports exact target while default rejects fractional tick',()=>{
 const p=fixture();assert.throws(()=>resolve(p,'midi.notes.update',args,{startTick:'00:00:00.001'}),error('TIME_NOT_REPRESENTABLE'));
 const r=resolve(p,'midi.notes.update',args,{startTick:'00:00:00.001'},{rounding:'nearest'});assert.equal(r.arguments.startTick,2);assert.equal(r.conversions[0].exact,false);assert.deepEqual(r.conversions[0].targetTick,{numerator:'72048',denominator:'25'});
});
test('Formatted edit: controller companion move and length resolve into one ordered transaction',()=>{
 const r=resolve(fixture(),'midi.notes.update',{...args,pitch:62,velocity:77},{startTick:'00:00:01.000',durationTicks:'00:00:01.000'},{controllers:'extended'});assert.equal(r.command,'batch');assert.deepEqual(r.arguments.commands[0].arguments,{clipId:'c',noteIds:['n'],deltaTick:1440,deltaPitch:2,controllers:'extended',anchorNoteId:'n'});assert.deepEqual(r.arguments.commands[1].arguments,{...args,velocity:77,durationTicks:960});
});
test('Formatted edit: scope overrides sample timecode userfps and musical input remain explicit',()=>{
 const p=fixture();p.timeDisplay={primaryFormat:'samples',pianoFormat:'timecode',timelineFormat:'user-fps',userFps:25};assert.equal(resolve(p,'midi.notes.update',args,{startTick:'48000'},{scope:'primary'}).arguments.startTick,1440);assert.equal(resolve(p,'midi.notes.update',args,{startTick:'00:00:01:00'}).arguments.startTick,1440);assert.equal(resolve(p,'clip.update',{clipId:'c'},{startTick:'00:00:01:00'}).arguments.startTick,1920);p.timeDisplay={primaryFormat:'bars-beats'};assert.equal(resolve(p,'midi.notes.update',args,{startTick:'001.2.1.000'}).arguments.startTick,960);
});
test('Formatted edit: unknown batch ambiguous malformed and unsafe anchors reject before mutation',()=>{
 const p=fixture(),before=JSON.stringify(p);for(const command of ['batch','__proto__','midi.events.update'])assert.throws(()=>resolve(p,command,args,{}),error('UNSUPPORTED_FORMATTED_TIME_COMMAND'));
 for(const [a,t,o]of [[{...args,startTick:0},{startTick:'00:00:00.000'},{}],[args,{velocity:'90'},{}],[args,{},null],[args,{}, {scope:'all'}],[args,{}, {rounding:'automatic'}],[args,{}, {controllers:'copy'}],[args,{}, {typo:1}],[{...args,noteId:'missing'},{},{}],[{...args,startTick:Number.MAX_SAFE_INTEGER},{durationTicks:'00:00:00.000'},{}],[args,{durationTicks:1},{}],[args,[],{}]])assert.throws(()=>resolve(p,'midi.notes.update',a,t,o));assert.equal(JSON.stringify(p),before);
});
