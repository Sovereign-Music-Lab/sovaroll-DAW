import test from 'node:test';import assert from 'node:assert/strict';
import {planAudioSlip} from '../src/media/editor-geometry.mjs';
const project=()=>({assets:[{id:'a',sampleRate:48000,frames:48000},{id:'b',sampleRate:8000,frames:8000}],clips:[{id:'x',type:'audio',assetId:'a',startSample:200,offsetFrames:12000,lengthFrames:12000},{id:'y',type:'audio',assetId:'b',startSample:900,offsetFrames:800,lengthFrames:4000,fadeWindow:{offsetFrames:400,lengthFrames:5000},volumeEnvelope:[{frame:7000,gain:1}],silencedRanges:[{startFrame:100,endFrame:200}]}]});
test('Grouped source slip uses equal seconds at different sample rates and intersects retained windows',()=>{
 const p=project(),before=structuredClone(p),forward=planAudioSlip(p,['x','y'],.2);
 assert.equal(forward.seconds,999/8000);assert.equal(forward.limited,true);assert.deepEqual(forward.commands.map(c=>c.arguments.deltaFrames),[5994,999]);
 const backward=planAudioSlip(p,['x','y'],-1);assert.equal(backward.seconds,-.0125);assert.deepEqual(backward.commands.map(c=>c.arguments.deltaFrames),[-600,-100]);assert.deepEqual(p,before);
});
test('Whole-file selection constrains the group to zero; MIDI and missing or duplicate clips fail',()=>{
 const p=project();p.clips[0].offsetFrames=0;p.clips[0].lengthFrames=48000;assert.deepEqual(planAudioSlip(p,['x','y'],1).commands,[]);
 for(const ids of [['missing'],['x','x'],[]])assert.throws(()=>planAudioSlip(p,ids,1));p.clips[0].type='midi';assert.throws(()=>planAudioSlip(p,['x','y'],.1));
});
