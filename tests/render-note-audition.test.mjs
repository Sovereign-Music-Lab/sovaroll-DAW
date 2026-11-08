import {renderProject} from '../src/media/render.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,Engine} from '../src/core/engine.mjs';
import {renderNoteAudition} from '../src/media/render-note-audition.mjs';
function fixture(start=0){const e=new Engine(createProject({sampleRate:8000}));for(const [command,args] of [['track.add',{id:'t',type:'midi',instrument:'sine'}],['clip.add',{id:'c',type:'midi',trackId:'t',startTick:start,lengthTicks:3840,notes:[{id:'n',pitch:69,velocity:70,startTick:0,durationTicks:1920}],events:[{id:'cc',tick:0,kind:'channel',status:176,data:[11,90]}]}]])assert.equal(e.execute({command,arguments:args}).status,'applied');return e.project;}
const args=value=>({clipId:'c',updates:[{noteId:'n',value}]});
test('Audition render is bounded audible and preserves the original project',()=>{const p=fixture(),before=structuredClone(p),a=renderNoteAudition(p,args(30)),b=renderNoteAudition(p,args(100));assert.equal(a.channels[0].length,2800);const energy=x=>x.reduce((s,n)=>s+n*n,0);assert.ok(energy(b.channels[0])>energy(a.channels[0])*5);assert.equal(b.channels[0].at(-1),0);assert.deepEqual(p,before);});
test('Audition render rebases late project positions without the offline 120-second limit',()=>{const a=renderNoteAudition(fixture(),args(90)),b=renderNoteAudition(fixture(960*1200),args(90));assert.deepEqual(a.channels,b.channels);assert.equal(b.sourceStartTick,960*1200);});
test('Audition render honors silence and rejects unbounded duration',()=>{const p=fixture();p.tracks[0].mute=true;assert.equal(renderNoteAudition(p,args(90)).silent,true);assert.throws(()=>renderNoteAudition(p,args(90),{durationSeconds:10}));});
test('Audition preserves a tempo transition after rebasing the source range',()=>{
 const p=fixture(9600);p.tempoMap=[{tick:0,bpm:120},{tick:9840,bpm:60}];p.clips[0].notes[0].durationTicks=480;
 const rebased=fixture();rebased.tempoMap=[{tick:0,bpm:120},{tick:240,bpm:60}];rebased.clips[0].notes[0].durationTicks=480;
 assert.deepEqual(renderNoteAudition(p,args(90),{durationSeconds:1}).channels,renderNoteAudition(rebased,args(90),{durationSeconds:1}).channels);
});
test('Audition honors track pan and controller expression silence',()=>{
 const p=fixture();p.tracks[0].pan=-1;const a=renderNoteAudition(p,args(100));assert.ok(a.channels[0].some(x=>Math.abs(x)>.01));assert.ok(a.channels[1].every(x=>Math.abs(x)<1e-7));
 p.clips[0].events[0].data=[11,0];const b=renderNoteAudition(p,args(100));assert.ok(b.channels.every(c=>c.every(x=>x===0)));
});
test('Audition excludes a selected note at the exact preview endpoint',()=>{
 const p=fixture();p.clips[0].notes.push({id:'later',pitch:80,velocity:100,channel:0,startTick:672,durationTicks:960});
 const a=renderNoteAudition(p,args(90)),b=renderNoteAudition(p,{clipId:'c',updates:[{noteId:'n',value:90},{noteId:'later',value:100}]});assert.deepEqual(a.channels,b.channels);
});

test('Audition retains project pan law and matches mix before its bounded end fade',()=>{
 const p=fixture(),legacy=renderNoteAudition(p,args(100));p.panLaw='equalPower';assert.deepEqual(renderNoteAudition(p,args(100)).channels,legacy.channels);
 p.panLaw='0dB';const before=structuredClone(p),audition=renderNoteAudition(p,args(100)),source=structuredClone(p);source.clips[0].notes[0].velocity=100;
 const mix=renderProject(source,new Map(),{durationSeconds:.35,tailSeconds:0});
 for(let channel=0;channel<2;channel++)assert.deepEqual(audition.channels[channel].slice(0,2700),mix.channels[channel].slice(0,2700));
 const energy=x=>x.reduce((sum,n)=>sum+n*n,0);assert.ok(Math.abs(energy(audition.channels[0])/energy(legacy.channels[0])-2)<1e-6);assert.deepEqual(p,before);
});


test('Audition uses saved Pre, EQ and synced delay through the shared renderer without mutating source',()=>{
 const p=fixture();p.tempoMap=[{tick:0,bpm:120},{tick:240,bpm:90}];
 p.tracks[0].pre={gainDb:-2,invertPolarity:true,lowCut:{enabled:true,frequencyHz:100,slope:12}};
 p.tracks[0].eq={enabled:true,bands:[100,400,1600,3000].map(frequencyHz=>({enabled:true,frequencyHz,gainDb:6,q:1}))};
 p.tracks[0].delay={enabled:true,timeMs:50,feedback:.3,wet:.4,sync:true,division:'1/32',rhythm:'straight'};
 const before=structuredClone(p),wet=renderNoteAudition(p,args(100)),source=structuredClone(p);source.clips[0].notes[0].velocity=100;
 const mix=renderProject(source,new Map(),{durationSeconds:.35,tailSeconds:0});
 for(let c=0;c<2;c++)assert.deepEqual(wet.channels[c].slice(0,2700),mix.channels[c].slice(0,2700));
 const dry=structuredClone(p);delete dry.tracks[0].eq;delete dry.tracks[0].delay;
 assert.notDeepEqual(wet.channels,renderNoteAudition(dry,args(100)).channels);
 assert.equal(wet.frames,2800);assert(wet.channels.every(c=>c.at(-1)===0));assert.deepEqual(p,before);
});
