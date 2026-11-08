import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateProject} from '../src/core/engine.mjs';
import {compileEditorGeometry} from '../src/media/editor-geometry.mjs';
import {resolveTimeDisplay} from '../src/media/time-display.mjs';
const project=()=>({...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60},{tick:7680,bpm:180}]});
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const time=()=>({...project(),timeDisplay:resolveTimeDisplay({timelineMode:'time-linear',pianoMode:'time-linear'})});

test('Editor geometry: legacy display settings remain valid and two views select modes independently',()=>{
 const p=project(),before=structuredClone(p);assert.equal(compileEditorGeometry(p).timeline.mode,'beat-linear');assert.deepEqual(p,before);
 p.timeDisplay=resolveTimeDisplay({timelineMode:'time-linear'});const g=compileEditorGeometry(p,{clip:{type:'midi',startTick:3840},zoom:48});assert.equal(g.timeline.tickToX(7680),576);assert.equal(g.piano.tickToX(3840),192);
 delete p.timeDisplay.timelineMode;delete p.timeDisplay.pianoMode;assert.equal(validateProject(p),true);assert.equal(compileEditorGeometry(p).timeline.mode,'beat-linear');
});
test('Editor geometry: time-linear uses a fixed120BPM zoom reference and variable musical spans',()=>{
 const g=compileEditorGeometry(time(),{zoom:48}).timeline;assert.equal(g.tickToX(3840),192);assert.equal(g.tickToX(7680),576);close(g.tickToX(11520),704);
 assert.equal(g.secondsToX(3)-g.secondsToX(2),96);assert.equal(g.secondsToX(7)-g.secondsToX(6),96);
 assert.equal(g.span(2880,4800),144);assert.equal(g.span(0,1920),96);
});
test('Editor geometry: piano local origin maps tempo before and after clip boundaries',()=>{
 const g=compileEditorGeometry(time(),{clip:{type:'midi',startTick:2880},zoom:48}).piano;
 assert.equal(g.tickToX(0),0);assert.equal(g.tickToX(960),48);assert.equal(g.tickToX(1920),144);assert.equal(g.xToSeconds(0),1.5);assert.equal(g.xToSeconds(144),3);
 assert.equal(g.xToTick(48),960);assert.equal(g.xToTick(144),1920);assert.equal(g.span(480,1920),120);
});
test('Editor geometry: anchored pointer deltas move source ticks consistently across tempo changes',()=>{
 const g=compileEditorGeometry(time(),{clip:{type:'midi',startTick:0},zoom:48}).piano;
 const tick=2880,dx=144,newTick=g.xToTick(g.tickToX(tick)+dx);assert.equal(newTick,4800);assert.equal(newTick-tick,1920);assert.equal(g.span(2880,4800),144);
 // The same pixel drag at a different anchor intentionally spans a different number of ticks.
 assert.equal(g.xToTick(g.tickToX(4800)+dx)-4800,1440);
});
test('Editor geometry: audio sample positions and MIDI positions share coordinates in both modes',()=>{
 for(const mode of ['beat-linear','time-linear']){const p=project();p.timeDisplay=resolveTimeDisplay({timelineMode:mode});const g=compileEditorGeometry(p).timeline;
  for(const [tick,sample] of [[0,0],[1920,48000],[3840,96000],[4800,144000],[7680,288000],[10560,336000]])close(g.sampleToX(sample),g.tickToX(tick));
  const positions=[1,2,3,4].map(sec=>g.secondsToX(sec));if(mode==='time-linear')assert.deepEqual(positions,[96,192,288,384]);else assert.deepEqual(positions,[96,192,240,288]);
 }
});
test('Editor geometry: view grid preserves source step multiples and coarsens bounded dense spans',()=>{
 const g=compileEditorGeometry(time()).timeline,lines=g.grid(0,7680,960,{minPixels:0});assert.deepEqual(lines.map(p=>p.tick),[0,960,1920,2880,3840,4800,5760,6720,7680]);assert.deepEqual(lines.map(p=>p.x),[0,48,96,144,192,288,384,480,576]);
 const large=g.grid(0,1e12,1,{maxLines:100,minPixels:0});assert.ok(large.length<=100);assert.equal(large[0].tick,0);assert.ok(large.every(p=>Number.isSafeInteger(p.tick)));
 const visible=g.grid(4000,7000,240,{minPixels:42});assert.ok(visible.every(p=>p.tick%240===0));for(let i=1;i<visible.length;i++)assert.ok(visible[i].x-visible[i-1].x>=42);
});
test('Editor geometry: frozen views survive source edits and inverse mapping retains fractional positions',()=>{
 const p=time(),g=compileEditorGeometry(p,{clip:{type:'midi',startTick:2880},zoom:73.5});p.tempoMap[0].bpm=300;p.timeDisplay.pianoMode='beat-linear';
 assert.ok(Object.isFrozen(g));assert.ok(Object.isFrozen(g.piano));assert.equal(g.piano.tickToX(960),73.5);
 for(const tick of [0,1,0.25,959.99,960,1920.125,100000])close(g.piano.xToTick(g.piano.tickToX(tick)),tick);
});
test('Editor geometry: invalid modes domains grid limits and overflow fail before coordinate use',()=>{
 for(const options of [{timelineMode:'seconds'},{pianoMode:null}])assert.throws(()=>resolveTimeDisplay(options));
 for(const zoom of [0,NaN,Infinity,10001])assert.throws(()=>compileEditorGeometry(project(),{zoom}));const g=compileEditorGeometry(time()).piano;
 for(const v of [-1,NaN,Infinity]){assert.throws(()=>g.tickToX(v));assert.throws(()=>g.xToTick(v));}
 assert.throws(()=>g.span(2,1));assert.throws(()=>g.grid(2,1,1));assert.throws(()=>g.grid(0,1,0));assert.throws(()=>g.grid(0,1,1,{maxLines:1}));assert.throws(()=>g.grid(0,1,1,{minPixels:-1}));
});
