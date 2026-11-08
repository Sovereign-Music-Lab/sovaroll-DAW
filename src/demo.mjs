import { createHash } from 'node:crypto';
import path from 'node:path';
import { createProject, Engine } from './core/engine.mjs';
import { encodeWav } from './media/wav.mjs';
import { atomicWrite } from './storage.mjs';

export async function createDemoProject(directory) {
  const engine = new Engine(createProject({ name: 'First Light', sampleRate: 48000 }));
  const commands = [];
  const track = (id, name, type, color, instrument, gainDb) => {
    commands.push({command:'track.add',arguments:{id,name,type,color,...(instrument ? {instrument} : {})}});
    commands.push({command:'track.update',arguments:{trackId:id,gainDb}});
  };
  track('track-keys','01 · Glass keys','midi','#a3f0bf','triangle',-12);
  track('track-bass','02 · Low tide','midi','#b9a6ff','sine',-13);
  track('track-pulse','03 · Paper pulse','audio','#f7b267',null,-9);
  const chords = [[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,65]];
  const notes = [];
  chords.forEach((chord, bar) => {
    for (let step = 0; step < 8; step++) notes.push({ id:`key-${bar}-${step}`,pitch:chord[step%4]+12,startTick:bar*3840+step*480,durationTicks:400,velocity:step%2?70:86,channel:0 });
  });
  commands.push({command:'clip.add',arguments:{id:'clip-keys',trackId:'track-keys',type:'midi',name:'Window reflections',startTick:0,lengthTicks:15360,notes}});
  commands.push({command:'clip.add',arguments:{id:'clip-bass',trackId:'track-bass',type:'midi',name:'Foundation',startTick:0,lengthTicks:15360,notes:[48,45,41,43].map((pitch,index)=>({id:`bass-${index}`,pitch,startTick:index*3840,durationTicks:3400,velocity:90,channel:0}))}});
  const sampleRate=48000, frames=sampleRate*8, mono=new Float32Array(frames);
  // Reproducible synthetic audio test fixture; no downloaded or licensed media.
  let seed=42;
  for(let beat=0;beat<16;beat++) {
    const start=Math.round(beat*0.5*sampleRate);
    for(let i=0;i<6000 && start+i<frames;i++) {
      seed=(1664525*seed+1013904223)>>>0;
      const noise=(seed/4294967296)*2-1,t=i/sampleRate;
      mono[start+i]+=Math.sin(2*Math.PI*(52*t+3*(1-Math.exp(-t*35))))*Math.exp(-t*30)*.5 + noise*Math.exp(-t*100)*.18;
    }
  }
  const wav=encodeWav({sampleRate,channels:[mono]}),sha256=createHash('sha256').update(wav).digest('hex');
  const asset={id:'asset-pulse',name:'Paper pulse.wav',path:`assets/${sha256}.wav`,sha256,sampleRate,channels:1,frames};
  await atomicWrite(path.join(directory,asset.path),wav);
  commands.push({command:'asset.add',arguments:{asset}});
  commands.push({command:'clip.add',arguments:{id:'clip-pulse',trackId:'track-pulse',type:'audio',name:'Paper pulse · WAV',assetId:asset.id,startSample:0,offsetFrames:0,lengthFrames:frames,gainDb:0}});
  const result=engine.execute({command:'batch',arguments:{commands},expectedRevision:0});
  if(result.status==='error') throw new Error(`Demo creation failed: ${JSON.stringify(result.errors)}`);
  return engine.project;
}
