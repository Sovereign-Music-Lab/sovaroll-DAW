import test from 'node:test';import assert from 'node:assert/strict';
import {Engine,createProject} from '../src/core/engine.mjs';
import {planMidiPartEndResize} from '../src/media/editor-geometry.mjs';
test('Part end sizing preserves MIDI sources, changes group lengths and has one Undo',()=>{
 const e=new Engine(createProject());for(const [command,args] of [['track.add',{id:'t',type:'midi'}],['clip.add',{id:'a',trackId:'t',type:'midi',startTick:0,lengthTicks:960,notes:[]}],['clip.add',{id:'b',trackId:'t',type:'midi',startTick:1920,lengthTicks:480,notes:[]}]])assert.equal(e.execute({command,arguments:args}).status,'applied');
 const before=structuredClone(e.project.clips),commands=planMidiPartEndResize(e.project,['a','b'],240);assert.equal(e.execute({command:'batch',arguments:{commands}}).status,'applied');assert.deepEqual(e.project.clips.map(c=>c.lengthTicks),[1200,720]);assert.equal(e.execute({command:'history.undo',arguments:{}}).status,'applied');assert.deepEqual(e.project.clips,before);
});
test('Shortening cannot discard late notes or controller events; original stays untouched',()=>{
 const p={clips:[{id:'a',type:'midi',startTick:0,lengthTicks:960,notes:[{startTick:400,durationTicks:200}],events:[{tick:800}]}]},before=structuredClone(p);
 assert.throws(()=>planMidiPartEndResize(p,['a'],-200),/컨트롤러/);assert.throws(()=>planMidiPartEndResize(p,['a'],-500),/노트/);assert.deepEqual(p,before);assert.deepEqual(planMidiPartEndResize(p,['a'],0),[]);assert.throws(()=>planMidiPartEndResize(p,['a','missing'],100),/MIDI/);
});

test('Left sizing keeps absolute note/controller timing, right edge and one Undo',()=>{
 const e=new Engine(createProject());for(const [command,args]of [['track.add',{id:'t',type:'midi'}],['clip.add',{id:'a',trackId:'t',type:'midi',startTick:960,lengthTicks:1920,notes:[{id:'n',pitch:60,velocity:90,startTick:480,durationTicks:240}]}],['midi.events.add',{clipId:'a',events:[{id:'cc',kind:'channel',status:176,data:[1,64],tick:720,order:10}]}]]){const r=e.execute({command,arguments:args});assert.equal(r.status,'applied',JSON.stringify(r));}
 const before=structuredClone(e.project.clips);const r=e.execute({command:'midi.clip.resizeStart',arguments:{clipId:'a',deltaTicks:240}});assert.equal(r.status,'applied',JSON.stringify(r));const c=e.project.clips[0];assert.equal(c.startTick,1200);assert.equal(c.startTick+c.lengthTicks,2880);assert.equal(c.startTick+c.notes[0].startTick,1440);assert.equal(c.startTick+c.events[0].tick,1680);assert.equal(e.execute({command:'midi.clip.resizeStart',arguments:{clipId:'a',deltaTicks:300}}).status,'error');assert.equal(e.execute({command:'history.undo',arguments:{}}).status,'applied');assert.deepEqual(e.project.clips,before);
});
