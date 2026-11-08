import test from 'node:test';
import assert from 'node:assert/strict';
import {convertMidiTicks,midiTickFraction,DEFAULT_MIDI_DISPLAY_PPQ} from '../src/media/midi-display-time.mjs';
import {adjustMidiNoteLengths,adjustMidiStreamLengths,resolveLengthAdjustment} from '../src/media/midi-length-adjustment.mjs';
import {compileMidiStreams,mergeMidiStreams} from '../src/media/midi-stream.mjs';
import {chaseMidiStreams} from '../src/media/midi-chase.mjs';
import {compileMidiPlayback} from '../src/media/midi-playback.mjs';
import {compileTempoMap} from '../src/media/time.mjs';
import {defaultModifiers} from '../src/media/midi-modifiers.mjs';
const opts=(lengthAdjustmentTicks=5,projectPpq=960,displayPpq=480)=>({projectPpq,displayPpq,lengthAdjustmentTicks});
const n=(key,startTick,durationTicks,extra={})=>({key,scope:'port-a',startTick,durationTicks,channel:0,pitch:60,...extra});
const run=(notes,o=opts())=>adjustMidiNoteLengths(notes,o);
const ends=x=>x.notes.map(n=>n.startTick+n.durationTicks);
const note=(id,startTick,durationTicks,extra={})=>({id,startTick,durationTicks,pitch:60,velocity:90,channel:0,releaseVelocity:33,...extra});
function project(notes,events=[]){return {ppq:960,sampleRate:8000,tempoMap:[{tick:0,bpm:120}],tracks:[{id:'t',type:'midi',instrument:'sine',gainDb:0,pan:0}],clips:[{id:'c',trackId:'t',type:'midi',startTick:0,lengthTicks:4000,notes,events}],assets:[],masterGainDb:0};}
const adjust=p=>adjustMidiStreamLengths(compileMidiStreams(p),opts());
const on=s=>s.tracks.flatMap(t=>t.events.filter(e=>e.kind==='noteOn'));

test('MIDI display ticks: default120 per sixteenth is independent of stored PPQ and tempo',()=>{
 assert.equal(DEFAULT_MIDI_DISPLAY_PPQ,480);for(const ppq of [480,960,1920]){assert.equal(convertMidiTicks(ppq/4,ppq,480),120);assert.equal(convertMidiTicks(120,480,ppq),ppq/4);}assert.equal(convertMidiTicks(1,480,960),2);
});
test('MIDI display ticks: exact rational view never silently rounds editing positions',()=>{
 assert.deepEqual(midiTickFraction(1,960,480),{numerator:'1',denominator:2});assert.deepEqual(midiTickFraction(3,960,480),{numerator:'3',denominator:2});assert.deepEqual(midiTickFraction(0,32767,480),{numerator:'0',denominator:1});assert.throws(()=>convertMidiTicks(1,960,480),{code:'MIDI_TICK_NOT_REPRESENTABLE'});assert.equal(convertMidiTicks(1,960,480,'floor'),0);assert.equal(convertMidiTicks(1,960,480,'ceil'),1);assert.equal(convertMidiTicks(1,960,480,'nearest'),1);assert.equal(convertMidiTicks(1,960,120,'nearest'),0);
});
test('MIDI display ticks: large safe positions retain exact intermediate arithmetic and reject output overflow',()=>{
 const m=Number.MAX_SAFE_INTEGER;assert.equal(convertMidiTicks(m,32767,32767),m);assert.equal(convertMidiTicks(m,32767,16384,'floor'),Number(BigInt(m)*16384n/32767n));assert.throws(()=>convertMidiTicks(m,1,32767),{code:'MIDI_TICK_OVERFLOW'});assert.deepEqual(midiTickFraction(m,1,32767),{numerator:(BigInt(m)*32767n).toString(),denominator:1});
});
test('MIDI display ticks: malformed positions resolutions and implicit rounding choices reject',()=>{
 for(const value of [-1,0.5,NaN,Infinity,'1',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>convertMidiTicks(value,960,480));for(const ppq of [0,-1,32768,1.5,'480']){assert.throws(()=>midiTickFraction(1,ppq,480));assert.throws(()=>convertMidiTicks(1,960,ppq));}assert.throws(()=>convertMidiTicks(1,960,480,'truncate'));
});
test('Length Adjustment: adjacent same-channel same-pitch notes gain only the required gap',()=>{
 const r=run([n('a',0,100),n('b',100,100),n('c',200,100)]);assert.deepEqual(ends(r),[90,190,300]);assert.equal(r.stats.adjustedNotes,2);assert.equal(r.policy.gapProjectTicks,10);assert.equal(r.diagnostics.length,0);
});
test('Length Adjustment: overlap is bounded by the next onset and an existing larger gap is preserved',()=>{
 assert.deepEqual(ends(run([n('a',0,300),n('b',100,50),n('c',200,10)])),[90,150,210]);assert.deepEqual(ends(run([n('a',0,80),n('b',100,200)])),[80,300]);
});
test('Length Adjustment: scope channel and pitch are independent collision keys',()=>{
 const input=[n('a',0,200),n('b',100,100,{channel:1}),n('c',100,100,{pitch:61}),n('d',100,100,{scope:'port-b'})];assert.deepEqual(run(input).notes,input);const keys=[n('x',0,100,{scope:'a:1'}),n('x',100,100,{scope:'a',channel:1})];assert.deepEqual(run(keys).notes,keys);
});
test('Length Adjustment: zero disables adjustment including overlaps without changing source objects',()=>{
 const input=[n('a',0,200,{metadata:{tags:['keep']}}),n('b',100,200)],before=structuredClone(input),r=run(input,opts(0));assert.deepEqual(r.notes,input);assert.deepEqual(r.changes,[]);r.notes[0].metadata.tags.push('changed');assert.deepEqual(input,before);assert.equal(r.policy.gapProjectTicks,0);
});
test('Length Adjustment: nonchronological source array keeps its order while chronological neighbors determine gaps',()=>{
 const input=[n('last',200,100),n('first',0,200),n('middle',100,200)],before=structuredClone(input),r=run(input);assert.deepEqual(r.notes.map(n=>n.key),['last','first','middle']);assert.deepEqual(ends(r),[300,90,190]);assert.deepEqual(input,before);assert.deepEqual(run(r.notes).notes,r.notes);
});
test('Length Adjustment: simultaneous notes are not deleted or shifted and report the impossible intra-group gap',()=>{
 const r=run([n('a',0,200),n('b',0,150),n('c',100,100)]);assert.deepEqual(ends(r),[90,90,200]);assert.equal(r.notes.length,3);assert.equal(r.stats.coincidentGroups,1);assert.equal(r.diagnostics[0].code,'LENGTH_COINCIDENT_NOTES');assert.deepEqual(r.notes.map(n=>n.startTick),[0,0,100]);
});
test('Length Adjustment: oversized gap clamps to zero length with explicit infeasible-gap diagnosis',()=>{
 const r=run([n('a',20,100),n('b',25,100)]);assert.deepEqual(ends(r),[20,125]);assert.equal(r.notes[0].durationTicks,0);assert.equal(r.stats.infeasibleGaps,1);assert.equal(r.diagnostics[0].availableTicks,5);assert.equal(r.diagnostics[0].requestedTicks,10);
});
test('Length Adjustment: existing instantaneous notes stay instantaneous and terminal notes are not shortened',()=>{
 const input=[n('a',0,0),n('b',100,0),n('c',200,300)],r=run(input);assert.deepEqual(r.notes,input);assert.equal(r.stats.adjustedNotes,0);
});
test('Length Adjustment: minimum gap rounds upward at fractional project resolution with explicit policy metadata',()=>{
 const r=run([n('a',0,50),n('b',50,50)],opts(1,1000,480));assert.equal(r.policy.gapProjectTicks,3);assert.deepEqual(ends(r),[47,100]);assert.deepEqual(ends(run([n('a',0,50),n('b',50,50)],opts(1,1000,960))),[48,100]);
});
test('Length Adjustment: invalid preferences sparse inputs duplicate keys and overflow reject without mutation',()=>{
 for(const bad of [null,{}, {...opts(),unknown:1},{...opts(),lengthAdjustmentTicks:-1},{...opts(),lengthAdjustmentTicks:1000001},{...opts(),displayPpq:0},{...opts(),projectPpq:32768}])assert.throws(()=>resolveLengthAdjustment(bad));for(const bad of [Array(1),[n('a',0,1),n('a',2,1)],[n('a',0,1,{channel:16})],[n('a',0,1,{pitch:128})],[n('a',Number.MAX_SAFE_INTEGER,1)],[n('',0,1)],[n('a',0,-1)]])assert.throws(()=>run(bad));assert.throws(()=>run(Array.from({length:200001},(_,i)=>n(String(i),i,1))));assert.deepEqual(run([]).notes,[]);
});
test('Length Adjustment: diagnostic samples are bounded while every affected note remains counted',()=>{
 const r=run(Array.from({length:200},(_,i)=>n(String(i),i,100)));assert.equal(r.stats.infeasibleGaps,199);assert.equal(r.stats.adjustedNotes,199);assert.equal(r.diagnostics.length,32);assert.equal(r.stats.omittedDiagnostics,167);assert.equal(r.notes.length,200);
});
test('Length Adjustment: deterministic randomized result matches independent all-neighbor reference',()=>{
 let seed=7;const random=m=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%m;};
 for(let trial=0;trial<40;trial++){const input=Array.from({length:80},(_,i)=>n(String(i),random(100),random(100),{scope:String(random(3)),channel:random(2),pitch:60+random(3)})),gap=1+random(12),actual=run(input,opts(gap,480,480));
  for(const [i,source]of input.entries()){const later=input.filter(b=>b.scope===source.scope&&b.channel===source.channel&&b.pitch===source.pitch&&b.startTick>source.startTick);const next=later.length?Math.min(...later.map(n=>n.startTick)):Infinity;const end=Math.min(source.startTick+source.durationTicks,Math.max(source.startTick,next-gap));assert.equal(actual.notes[i].durationTicks,end-source.startTick);}
 }
});
test('Length Adjustment: full200000-note input is processed without pairwise scanning or lost terminal notes',t=>{
 const input=Array.from({length:200000},(_,i)=>n(String(i),i*10,20));const start=performance.now(),r=run(input,opts(1,480,480));assert.equal(r.stats.adjustedNotes,199999);assert.equal(r.notes[199999].durationTicks,20);assert.equal(r.notes[100000].durationTicks,9);t.diagnostic(`200000 notes processed in ${Math.round(performance.now()-start)} ms; not a realtime latency guarantee`);
});
test('Length stream: note endpoints metadata raw CC SysEx and zero-velocity off encoding stay coherent',()=>{
 const p=project([note('a',0,100,{releaseVelocity:0,noteOffEncoding:'zeroVelocityNoteOn'}),note('b',100,100)],[{id:'cc',tick:20,order:0,kind:'channel',status:176,data:[11,75]},{id:'sx',tick:30,order:0,kind:'sysex',status:240,data:[125,247]}]);const compiled=compileMidiStreams(p),before=structuredClone(compiled),r=adjustMidiStreamLengths(compiled,opts()),events=r.tracks[0].events;assert.equal(on(r)[0].durationTicks,90);const off=events.find(e=>e.kind==='noteOff'&&e.noteId==='a');assert.equal(off.tick,90);assert.equal(off.status,144);assert.deepEqual(off.data,[60,0]);assert.equal(off.nominalEndTick,90);assert.deepEqual(events.filter(e=>e.kind==='raw'),compiled.tracks[0].events.filter(e=>e.kind==='raw'));assert.deepEqual(compiled,before);assert.equal(r.endTick,compiled.endTick);assert.equal(r.eventCount,compiled.eventCount);
});
test('Length stream: adjustment follows modifier onset pitch and duration rather than changing stored notes',()=>{
 const p=project([note('a',0,80),note('b',100,80)]);p.tracks[0].midiModifiers={...defaultModifiers(),transpose:12,lengthRatio:{numerator:2,denominator:1}};const before=structuredClone(p),r=adjust(p);assert.equal(on(r)[0].pitch,72);assert.equal(on(r)[0].durationTicks,90);assert.equal(on(r)[1].durationTicks,160);assert.deepEqual(p,before);
});
test('Length stream: separate outputs stay independent while caller route merging and channel overrides expose shared collisions',()=>{
 const p=project([note('a',0,200)]);p.tracks.push({...p.tracks[0],id:'b'});p.clips.push({id:'b',trackId:'b',type:'midi',startTick:0,lengthTicks:4000,notes:[note('b',100,100,{channel:1})]});const original=compileMidiStreams(p);assert.equal(on(adjustMidiStreamLengths(original,opts()))[0].durationTicks,200);const routed=structuredClone(original);for(const t of routed.tracks)for(const e of t.events){e.channel=4;e.status=e.status&240|4;}const merged={...routed,tracks:[{trackId:'destination:42',events:mergeMidiStreams(routed),endTick:4000}]};assert.equal(on(adjustMidiStreamLengths(merged,opts()))[0].durationTicks,90);assert.equal(on(adjustMidiStreamLengths(merged,opts()))[0].channel,4);
});
test('Length stream: shortened zero-length endpoint remains after its own onset at the same tick',()=>{
 const r=adjust(project([note('a',20,100),note('b',25,100)]));const events=r.tracks[0].events.filter(e=>e.noteId==='a');assert.deepEqual(events.map(e=>[e.kind,e.tick]),[['noteOn',20],['noteOff',20]]);assert.equal(r.lengthAdjustment.stats.infeasibleGaps,1);
});
test('Length stream: Chase inside the new gap emits no held key while an earlier cursor restores its shortened end',()=>{
 const p=project([note('a',0,100),note('b',100,100)]),compiled=adjust(p);assert.equal(on(chaseMidiStreams(compiled,p,{tick:95})).length,0);const held=on(chaseMidiStreams(compiled,p,{tick:50}));assert.equal(held.length,1);assert.equal(held[0].nominalEndTick,90);assert.equal(on(chaseMidiStreams(compiled,p,{tick:100})).length,0);
});
test('Length stream: MIDI playback uses adjusted note release times while sustain remains a separate controller state',()=>{
 const p=project([note('a',0,100),note('b',100,100)]),timeline=compileTempoMap(p.tempoMap,p.ppq),plan=compileMidiPlayback(adjust(p),{timeline,contentDuration:3});assert.equal(plan.tracks[0].voices[0].releaseTime,timeline.tickToSeconds(90));
 p.clips[0].events=[{id:'pedal',tick:0,order:0,kind:'channel',status:176,data:[64,127]},{id:'release',tick:300,order:0,kind:'channel',status:176,data:[64,0]}];const held=compileMidiPlayback(adjust(p),{timeline,contentDuration:3});assert.equal(held.tracks[0].voices[0].releaseTime,timeline.tickToSeconds(300));assert.equal(p.clips[0].notes[0].durationTicks,100);
});
test('Length stream: missing duplicate malformed and out-of-order endpoints reject atomically',()=>{
 const original=compileMidiStreams(project([note('a',0,100),note('b',100,100)]));for(const edit of [x=>x.tracks[0].events.pop(),x=>x.tracks[0].events[0].durationTicks++,x=>x.tracks[0].events.reverse(),x=>x.tracks.push(structuredClone(x.tracks[0])),x=>x.tracks[0].events[1].channel=9,x=>x.tracks[0].events[0].noteKey='']){const bad=structuredClone(original);edit(bad);const before=structuredClone(bad);assert.throws(()=>adjustMidiStreamLengths(bad,opts()));assert.deepEqual(bad,before);}assert.deepEqual(adjustMidiStreamLengths(original,opts(0)).tracks,original.tracks);
});
