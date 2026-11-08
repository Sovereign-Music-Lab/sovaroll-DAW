import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject} from '../src/core/engine.mjs';
import {renderProject} from '../src/media/render.mjs';

function fixture(sourceRate,projectRate){
 const frames=sourceRate/10,source={frames,sampleRate:sourceRate,channels:[new Float32Array(frames)]};
 for(let i=0;i<frames;i++)source.channels[0][i]=Math.sin(i*.317)*.4+Math.sin(i*.017)*.1;
 const project=createProject({sampleRate:projectRate}),hash='e'.repeat(64);
 const engine=new Engine(project);
 const result=engine.execute({command:'batch',arguments:{commands:[
  {command:'track.add',arguments:{id:'audio',type:'audio',name:'Source'}},
  {command:'asset.add',arguments:{asset:{id:'source',name:'source.wav',path:`assets/${hash}.wav`,sha256:hash,sampleRate:sourceRate,channels:1,frames}}},
  {command:'clip.add',arguments:{id:'clip',trackId:'audio',type:'audio',assetId:'source',startSample:37,offsetFrames:23,lengthFrames:frames-100,gainDb:0}}
 ]}});assert.equal(result.status,'applied');
 return {engine,assets:new Map([['source',source]])};
}

test('audio splits preserve every rendered sample with unequal source/project rates and source offsets',()=>{
 for(const [sourceRate,projectRate] of [[44100,48000],[48000,44100],[24000,48000],[48000,48000]]){
  const {engine,assets}=fixture(sourceRate,projectRate),before=engine.project;
  const original=renderProject(before,assets,{durationSeconds:.15});
  const result=engine.execute({command:'clip.split',arguments:{clipId:'clip',atSample:Math.round(projectRate*.04)},expectedRevision:before.revision});
  assert.equal(result.status,'applied',JSON.stringify(result));
  const after=renderProject(engine.project,assets,{durationSeconds:.15});
  assert.deepEqual(after.channels,original.channels,`${sourceRate} -> ${projectRate} split changed source playback`);
  const undo=engine.execute({command:'history.undo',arguments:{}});assert.equal(undo.status,'applied');
  assert.deepEqual(renderProject(engine.project,assets,{durationSeconds:.15}).channels,original.channels);
 }
});
