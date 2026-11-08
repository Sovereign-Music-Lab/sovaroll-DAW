import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateProject} from '../src/core/engine.mjs';
import {compileProjectTimeDisplay,resolveTimeDisplay,defaultTimeDisplay} from '../src/media/time-display.mjs';
const project=()=>({...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60},{tick:7680,bpm:180}]});
const make=options=>compileProjectTimeDisplay({...project(),timeDisplay:resolveTimeDisplay(options)});

test('Time display: legacy project default and inherited formats are detached and do not materialize settings',()=>{
 const p=project(),before=structuredClone(p),t=compileProjectTimeDisplay(p,1000);assert.equal(t.position(1).text,'001.1.1.25/24');assert.equal(t.formatFor('timeline'),'bars-beats');assert.deepEqual(p,before);assert.ok(!Object.hasOwn(p,'timeDisplay'));
 const options=defaultTimeDisplay(),v=resolveTimeDisplay(options);options.frameRate.numerator=24;assert.equal(v.frameRate.numerator,30);assert.ok(Object.isFrozen(t.options.frameRate));
});
test('Time display: primary and two independent ruler formats resolve without changing musical source',()=>{
 const t=make({primaryFormat:'seconds',timelineFormat:'samples',pianoFormat:'timecode'});assert.equal(t.position(3840).text,'00:00:02.000');assert.equal(t.position(3840,'timeline').text,'96000');assert.equal(t.position(3840,'piano').text,'00:00:02:00');assert.equal(make({primaryFormat:'user-fps',userFps:60}).position(960).text,'00:00:00:30');
});
test('Time display: local positions and anchored durations use tempo at their project origin',()=>{
 const t=make({primaryFormat:'seconds'});assert.equal(t.position(960).text,'00:00:00.500');assert.equal(t.position(960,'piano',3840).text,'00:00:01.000');assert.equal(t.duration(2880,4800).text,'00:00:01.500');assert.equal(t.duration(0,1920).text,'00:00:01.000');
 assert.equal(make({}).duration(2880,4800).text,'000.2.0.000');
});
test('Time display: exact audio sample identity and display-only fractional cursor quantization are explicit',()=>{
 const t=make({primaryFormat:'samples'});for(const sample of [0,1,1001,48000,Number.MAX_SAFE_INTEGER]){const r=t.samplePosition(sample);assert.equal(r.text,String(sample));assert.equal(r.precision,'exact-source-sample');}
 assert.equal(t.position(0.5).text,'12');assert.equal(t.position(0.5).precision,'float64-display');assert.equal(make({}).position(0.5).text,'001.1.1.000');assert.equal(make({}).position(0.5).precision,'float64-display');
});
test('Time display: timecode uses actual rate80 subframes and dropped labels while user FPS stays independent',()=>{
 const p={...project(),tempoMap:[{tick:0,bpm:60}],ppq:1000,timeDisplay:resolveTimeDisplay({primaryFormat:'timecode',frameRate:{nominalFps:30,numerator:30,denominator:1,dropFrame:true},showSubframes:true})};
 const t=compileProjectTimeDisplay(p);assert.equal(t.position(60000).text,'00:01:00;02.00');assert.equal(t.position(500).text,'00:00:00;15.00');assert.equal(t.position(0).text,'00:00:00;00.00');
 p.timeDisplay=resolveTimeDisplay({...p.timeDisplay,primaryFormat:'user-fps',userFps:25});assert.equal(compileProjectTimeDisplay(p).position(500).text,'00:00:00:12.40');
});
test('Time display: invalid full settings source loading and domains reject before a misleading display',()=>{
 for(const options of [null,[],{typo:1},{primaryFormat:'minutes'},{timelineFormat:null},{showSubframes:1},{userFps:0},{frameRate:{nominalFps:30}},{frameRate:{nominalFps:25,numerator:25,denominator:1,dropFrame:true}},{frameRate:{nominalFps:30,numerator:121,denominator:1,dropFrame:false}}])assert.throws(()=>resolveTimeDisplay(options));
 const p=project();p.timeDisplay={primaryFormat:'seconds'};assert.throws(()=>validateProject(p));
 const t=make({});assert.throws(()=>t.position(-1));assert.throws(()=>t.position(Infinity));assert.throws(()=>t.position(0,'other'));assert.throws(()=>t.duration(3,2));assert.throws(()=>t.position(1,'primary',Number.MAX_SAFE_INTEGER));assert.throws(()=>t.samplePosition(0.5));
});
