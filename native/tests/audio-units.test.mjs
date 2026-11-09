import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {encodeWav,decodeWav} from '../../src/media/wav.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),binary=path.join(root,'.native-build/newdaw-audio-units'),exec=promisify(execFile);
before(async()=>{await exec(process.execPath,['scripts/build-native-audio-units.mjs'],{cwd:root,timeout:120000});});
async function helper(t){
 const child=spawn(binary,[],{stdio:['pipe','pipe','pipe']});let input='',events=[],waiters=[];
 child.stdout.on('data',bytes=>{input+=bytes.toString();while(input.includes('\n')){const index=input.indexOf('\n'),line=input.slice(0,index);input=input.slice(index+1);const event=JSON.parse(line);events.push(event);for(const waiter of [...waiters])if(waiter.predicate(event)){events.splice(events.indexOf(event),1);waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(event);}}});
 child.on('error',error=>{for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}});
 const next=(predicate,timeout=10000)=>{const index=events.findIndex(predicate);if(index>=0)return Promise.resolve(events.splice(index,1)[0]);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Audio Unit helper event timeout'));},timeout)};waiters.push(waiter);});};
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 t.after(async()=>{if(child.exitCode===null){send({command:'quit'});await new Promise(resolve=>child.once('exit',resolve));}});
 return {send,next};
}
test('Audio Unit discovery returns bounded metadata without instantiation',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list',limit:1});
 const list=await h.next(event=>event.event==='list');assert.ok(list.count<=1);assert.ok(list.availableCount>=list.count);assert.equal(list.instantiated,false);
 for(const component of list.components){assert.equal(typeof component.id,'string');assert.equal(typeof component.name,'string');assert.equal(typeof component.manufacturer,'string');assert.equal(component.instantiated,false);}
 h.send({command:'status'});const status=await h.next(event=>event.event==='status');assert.equal(status.instantiated,false);assert.equal(status.selected,null);
});

test('Audio Unit selection validates identity and never instantiates plugin code',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list'});
 const list=await h.next(event=>event.event==='list');h.send({command:'select',id:'not-present'});const missing=await h.next(event=>event.event==='error');assert.equal(missing.code,'AUDIO_UNIT_NOT_FOUND');
 h.send({command:'list',limit:0});const invalid=await h.next(event=>event.event==='error');assert.equal(invalid.code,'INVALID_LIMIT');
 if(list.count>0){
  const id=list.components[0].id;h.send({command:'select',id});const selected=await h.next(event=>event.event==='selected');assert.equal(selected.instantiated,false);assert.equal(selected.component.id,id);
  h.send({command:'status'});const status=await h.next(event=>event.event==='status');assert.equal(status.selected,id);assert.equal(status.instantiated,false);
 }else assert.equal(list.availableCount,0,'An empty host still exposes safe discovery without executing plugin code');
});

test('Audio Unit offline instantiation requires explicit intent and releases the exact component',async t=>{
 const fourCC=value=>[...value].reduce((result,char)=>(result*256+char.charCodeAt(0))>>>0,0);
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list'});
 const list=await h.next(event=>event.event==='list'),effect=list.components.find(component=>component.type===fourCC('aufx'));
 h.send({command:'instantiate',id:'not-present',offline:true});const missing=await h.next(event=>event.event==='error');assert.equal(missing.code,'AUDIO_UNIT_NOT_FOUND');
 const id=effect?.id??'not-present';h.send({command:'instantiate',id,offline:false});const offline=await h.next(event=>event.event==='error');assert.equal(offline.code,'OFFLINE_REQUIRED');
 if(effect){
  h.send({command:'instantiate',id:effect.id,offline:true});const result=await h.next(event=>['instantiated','error'].includes(event.event));
  if(result.event==='error'){
   assert.equal(result.code,'INSTANTIATION_FAILED');assert.ok(result.message);console.log(JSON.stringify({status:'environment-limited',code:result.code,message:result.message}));
  }else{
   assert.equal(result.component.id,effect.id);assert.equal(result.offline,true);assert.ok(result.inputChannels>0);assert.ok(result.outputChannels>0);
   h.send({command:'status'});const active=await h.next(event=>event.event==='status');assert.equal(active.instantiated,true);
   h.send({command:'release'});await h.next(event=>event.event==='released');h.send({command:'status'});const released=await h.next(event=>event.event==='status');assert.equal(released.instantiated,false);
  }
 }else console.log(JSON.stringify({status:'environment-limited',reason:'No effect Audio Unit discovered'}));
});

test('Audio Unit offline effect renders bounded PCM deterministically and preserves lifecycle',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list'});
 const list=await h.next(event=>event.event==='list'),effect=list.components.find(component=>component.type===1635083896);
 if(!effect){console.log(JSON.stringify({status:'environment-limited',reason:'No effect Audio Unit discovered'}));return;}
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-au-render-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const rate=48000,left=Float32Array.from({length:4800},(_,i)=>.2*Math.sin(i*.05)),right=Float32Array.from({length:4800},(_,i)=>.1*Math.cos(i*.08));
 const wave=encodeWav({sampleRate:rate,channels:[left,right]}),file=path.join(directory,'input.wav');await fs.writeFile(file,wave);
 const sourcePcm=bytes=>{bytes=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let at=12;at+8<=bytes.length;){const size=bytes.readUInt32LE(at+4);if(bytes.toString('ascii',at,at+4)==='data')return bytes.subarray(at+8,at+8+size);at+=8+size+(size%2);}throw new Error('Missing WAV data');};
 h.send({command:'render',path:file,offline:true});const noInstance=await h.next(event=>event.event==='error');assert.equal(noInstance.code,'NO_INSTANCE');
 h.send({command:'instantiate',id:effect.id,offline:true});const instantiated=await h.next(event=>['instantiated','error'].includes(event.event));assert.equal(instantiated.event,'instantiated',JSON.stringify(instantiated));
 const outputs=[];
 for(let i=0;i<2;i++){
  h.send({command:'render',path:file,offline:true});const rendered=await h.next(event=>['rendered','error'].includes(event.event));assert.equal(rendered.event,'rendered',JSON.stringify(rendered));
  assert.equal(rendered.frames,4800);assert.equal(rendered.sampleRate,rate);assert.equal(rendered.channels,2);assert.equal(rendered.sourceSha256,createHash('sha256').update(sourcePcm(wave)).digest('hex'));outputs.push(rendered.pcmSha256);
 }
 assert.equal(outputs[0],outputs[1],'Repeated offline render must be deterministic');
 h.send({command:'render',path:path.join(directory,'missing.wav'),offline:true});const missing=await h.next(event=>event.event==='error');assert.equal(missing.code,'WAV_NOT_READABLE');
 h.send({command:'status'});const active=await h.next(event=>event.event==='status');assert.equal(active.instantiated,true);
 h.send({command:'release'});await h.next(event=>event.event==='released');
});

test('Audio Unit parameters are bounded, validated and affect deterministic offline rendering',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list',limit:256});
 const list=await h.next(event=>event.event==='list'),effects=list.components.filter(component=>component.type===1635083896);
 h.send({command:'parameters'});assert.equal((await h.next(event=>event.event==='error')).code,'NO_INSTANCE');
 h.send({command:'setParameter',keyPath:'missing',value:0});assert.equal((await h.next(event=>event.event==='error')).code,'NO_INSTANCE');
 let parameterEvent=null;
 for(const effect of effects.slice(0,16)){
  h.send({command:'instantiate',id:effect.id,offline:true});const instantiated=await h.next(event=>['instantiated','error'].includes(event.event));if(instantiated.event==='error')continue;
  h.send({command:'parameters'});const listed=await h.next(event=>['parameters','error'].includes(event.event));
  if(listed.event==='parameters'&&listed.parameters.some(parameter=>parameter.maxValue>parameter.minValue)){parameterEvent=listed;break;}
  h.send({command:'release'});await h.next(event=>event.event==='released');
 }
 assert.ok(parameterEvent,'Expected an available system effect with a bounded parameter tree');
 assert.ok(parameterEvent.count<=256);assert.equal(parameterEvent.count,parameterEvent.parameters.length);
 const parameter=parameterEvent.parameters.find(parameter=>parameter.maxValue>parameter.minValue),target=parameter.value===parameter.minValue?parameter.maxValue:parameter.minValue;
 for(const field of ['keyPath','identifier','name'])assert.equal(typeof parameter[field],'string');for(const field of ['value','defaultValue','minValue','maxValue'])assert.ok(Number.isFinite(parameter[field]));
 h.send({command:'setParameter',keyPath:'missing',value:target});assert.equal((await h.next(event=>event.event==='error')).code,'AUDIO_UNIT_PARAMETER_NOT_FOUND');
 h.send({command:'setParameter',keyPath:parameter.keyPath,value:parameter.maxValue+Math.max(1,Math.abs(parameter.maxValue))});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_AUDIO_UNIT_PARAMETER_VALUE');
 h.send({command:'setParameter',keyPath:parameter.keyPath,value:'bad'});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_REQUEST');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-au-parameters-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const left=Float32Array.from({length:4800},(_,i)=>.2*Math.sin(i*.05)),right=Float32Array.from({length:4800},(_,i)=>.1*Math.cos(i*.08)),file=path.join(directory,'input.wav');await fs.writeFile(file,encodeWav({sampleRate:48000,channels:[left,right]}));
 h.send({command:'render',path:file,offline:true});const baseline=await h.next(event=>['rendered','error'].includes(event.event));assert.equal(baseline.event,'rendered',JSON.stringify(baseline));
 h.send({command:'setParameter',keyPath:parameter.keyPath,value:target});const changed=await h.next(event=>['parameterSet','error'].includes(event.event));assert.equal(changed.event,'parameterSet',JSON.stringify(changed));assert.ok(Math.abs(changed.parameter.value-target)<1e-5);assert.equal(changed.parameter.defaultValue,parameter.defaultValue);
 h.send({command:'parameters'});const reread=await h.next(event=>event.event==='parameters'),current=reread.parameters.find(item=>item.keyPath===parameter.keyPath);assert.ok(Math.abs(current.value-target)<1e-5);
 const outputs=[];for(let i=0;i<2;i++){h.send({command:'render',path:file,offline:true});const rendered=await h.next(event=>['rendered','error'].includes(event.event));assert.equal(rendered.event,'rendered',JSON.stringify(rendered));outputs.push(rendered.pcmSha256);}
 assert.equal(outputs[0],outputs[1]);assert.notEqual(outputs[0],baseline.pcmSha256,'The changed parameter must affect the observed system-effect PCM');
 h.send({command:'status'});assert.equal((await h.next(event=>event.event==='status')).instantiated,true);h.send({command:'release'});await h.next(event=>event.event==='released');
});

test('Audio Unit real-time preview requires permission and owns silent Play Stop completion lifecycle',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list',limit:256});const list=await h.next(event=>event.event==='list'),effect=list.components.find(component=>component.type===1635083896);
 h.send({command:'play',path:'/missing.wav',allowDefaultOutput:false});assert.equal((await h.next(event=>event.event==='error')).code,'NO_INSTANCE');
 if(!effect){console.log(JSON.stringify({status:'environment-limited',reason:'No effect Audio Unit discovered'}));return;}
 h.send({command:'instantiate',id:effect.id,offline:true});const instantiated=await h.next(event=>['instantiated','error'].includes(event.event));assert.equal(instantiated.event,'instantiated',JSON.stringify(instantiated));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-au-preview-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const zeros=length=>Float32Array.from({length},()=>0),shortFile=path.join(directory,'silent-short.wav'),longFile=path.join(directory,'silent-long.wav');await fs.writeFile(shortFile,encodeWav({sampleRate:48000,channels:[zeros(4800),zeros(4800)]}));await fs.writeFile(longFile,encodeWav({sampleRate:48000,channels:[zeros(48000),zeros(48000)]}));
 h.send({command:'play',path:shortFile});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_REQUEST');
 h.send({command:'play',path:shortFile,allowDefaultOutput:false});assert.equal((await h.next(event=>event.event==='error')).code,'OUTPUT_REQUIRED');
 h.send({command:'play',path:shortFile,allowDefaultOutput:true});const playing=await h.next(event=>['playing','error'].includes(event.event));
 if(playing.event==='error'){assert.equal(playing.code,'AUDIO_UNIT_PLAYBACK_FAILED');console.log(JSON.stringify({status:'environment-limited',code:playing.code,message:playing.message}));return;}
 assert.equal(playing.offline,false);const completed=await h.next(event=>event.event==='completed'&&event.jobId===playing.jobId);assert.equal(completed.status,'completed');
 h.send({command:'status'});let status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.instantiated,true);
 h.send({command:'play',path:longFile,allowDefaultOutput:true});const active=await h.next(event=>['playing','error'].includes(event.event));assert.equal(active.event,'playing',JSON.stringify(active));
 h.send({command:'play',path:longFile,allowDefaultOutput:true});assert.equal((await h.next(event=>event.event==='error')).code,'ALREADY_PLAYING');
 h.send({command:'render',path:shortFile,offline:true});assert.equal((await h.next(event=>event.event==='error')).code,'PREVIEW_ACTIVE');
 h.send({command:'status'});status=await h.next(event=>event.event==='status');assert.equal(status.playing,true);assert.equal(status.previewJobId,active.jobId);
 h.send({command:'stop'});const stopped=await h.next(event=>event.event==='stopped'&&event.jobId===active.jobId);assert.equal(stopped.status,'stopped');h.send({command:'status'});status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.instantiated,true);
 h.send({command:'render',path:shortFile,offline:true});const recovered=await h.next(event=>['rendered','error'].includes(event.event));assert.equal(recovered.event,'rendered',JSON.stringify(recovered));
 h.send({command:'play',path:longFile,allowDefaultOutput:true});const releasing=await h.next(event=>event.event==='playing');h.send({command:'release'});const released=await h.next(event=>event.event==='released');assert.equal(released.instantiated,false);h.send({command:'status'});status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.instantiated,false);
});

test('Audio Unit instrument renders bounded scheduled MIDI notes to deterministic non-silent WAV',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list',limit:256});const list=await h.next(event=>event.event==='list'),instrumentType=[...'aumu'].reduce((value,char)=>(value*256+char.charCodeAt(0))>>>0,0),instrument=list.components.find(component=>component.type===instrumentType&&component.name.includes('AUDLSynth'))??list.components.find(component=>component.type===instrumentType);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-au-instrument-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const output=path.join(directory,'instrument.wav'),notes=[{pitch:60,velocity:100,channel:0,startFrame:0,durationFrames:12000},{pitch:64,velocity:90,channel:0,startFrame:2400,durationFrames:12000}];
 const request={command:'renderMidi',outputPath:output,sampleRate:48000,channels:2,durationFrames:48000,notes,offline:true};
 h.send(request);assert.equal((await h.next(event=>event.event==='error')).code,'NO_INSTANCE');
 if(!instrument){console.log(JSON.stringify({status:'environment-limited',reason:'No instrument Audio Unit discovered'}));return;}
 h.send({command:'instantiate',id:instrument.id,offline:true});const instantiated=await h.next(event=>['instantiated','error'].includes(event.event));assert.equal(instantiated.event,'instantiated',JSON.stringify(instantiated));
 h.send({...request,notes:[]});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_MIDI_RENDER');
 h.send({...request,notes:[{...notes[0],pitch:128}]});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_MIDI_NOTE');
 h.send({...request,notes:[{...notes[0],extra:1}]});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_MIDI_NOTE');
 const outputs=[];for(let i=0;i<2;i++){const file=path.join(directory,`instrument-${i}.wav`);h.send({...request,outputPath:file});const rendered=await h.next(event=>['renderedMidi','error'].includes(event.event));assert.equal(rendered.event,'renderedMidi',JSON.stringify(rendered));assert.equal(rendered.frames,48000);assert.equal(rendered.sampleRate,48000);assert.equal(rendered.channels,2);assert.equal(rendered.noteCount,2);assert.equal(rendered.freshInstance,true);const bytes=await fs.readFile(file),decoded=decodeWav(bytes);assert.equal(decoded.frames,48000);assert.equal(decoded.channels.length,2);assert.ok(decoded.channels[0].some(value=>Math.abs(value)>.001));outputs.push(createHash('sha256').update(bytes).digest('hex'));}
 assert.equal(outputs[0],outputs[1],'Equivalent scheduled MIDI renders must be byte-identical');
 h.send({command:'status'});const status=await h.next(event=>event.event==='status');assert.equal(status.instantiated,true);assert.equal(status.playing,false);assert.equal(status.renderingMidi,false);h.send({command:'release'});await h.next(event=>event.event==='released');
});

test('Audio Unit instrument real-time MIDI playback owns silent completion Stop and held-note cleanup',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list',limit:256});const list=await h.next(event=>event.event==='list'),instrumentType=[...'aumu'].reduce((value,char)=>(value*256+char.charCodeAt(0))>>>0,0),instrument=list.components.find(component=>component.type===instrumentType&&component.name.includes('AUDLSynth'))??list.components.find(component=>component.type===instrumentType);
 const short={pitch:60,velocity:90,channel:0,startFrame:0,durationFrames:2400},long={pitch:64,velocity:90,channel:0,startFrame:0,durationFrames:24000},base={sampleRate:48000,outputGain:0,allowDefaultOutput:true};
 h.send({command:'playMidi',...base,durationFrames:4800,notes:[short]});assert.equal((await h.next(event=>event.event==='error')).code,'NO_INSTANCE');
 if(!instrument){console.log(JSON.stringify({status:'environment-limited',reason:'No instrument Audio Unit discovered'}));return;}
 h.send({command:'instantiate',id:instrument.id,offline:true});const instantiated=await h.next(event=>['instantiated','error'].includes(event.event));assert.equal(instantiated.event,'instantiated',JSON.stringify(instantiated));
 h.send({command:'playMidi',...base,durationFrames:4800,notes:[short],allowDefaultOutput:false});assert.equal((await h.next(event=>event.event==='error')).code,'OUTPUT_REQUIRED');
 h.send({command:'playMidi',...base,durationFrames:4800,notes:[short],outputGain:2});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_MIDI_RENDER');
 h.send({command:'playMidi',...base,durationFrames:4800,notes:[{...short,pitch:128}]});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_MIDI_NOTE');
 h.send({command:'playMidi',...base,durationFrames:4800,notes:[short]});const playing=await h.next(event=>['playing','error'].includes(event.event));
 if(playing.event==='error'){assert.equal(playing.code,'AUDIO_UNIT_PLAYBACK_FAILED');console.log(JSON.stringify({status:'environment-limited',code:playing.code,message:playing.message}));return;}
 assert.equal(playing.instrument,true);assert.equal(playing.outputGain,0);assert.equal(playing.offline,false);const completed=await h.next(event=>event.event==='completed'&&event.jobId===playing.jobId);assert.equal(completed.instrument,true);
 h.send({command:'status'});let status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.instrumentPlaying,false);assert.equal(status.instantiated,true);
 h.send({command:'playMidi',...base,durationFrames:48000,notes:[long]});const active=await h.next(event=>['playing','error'].includes(event.event));assert.equal(active.event,'playing',JSON.stringify(active));
 h.send({command:'playMidi',...base,durationFrames:48000,notes:[long]});assert.equal((await h.next(event=>event.event==='error')).code,'ALREADY_PLAYING');h.send({command:'status'});status=await h.next(event=>event.event==='status');assert.equal(status.playing,true);assert.equal(status.instrumentPlaying,true);assert.equal(status.previewJobId,active.jobId);
 h.send({command:'stop'});const stopped=await h.next(event=>event.event==='stopped'&&event.jobId===active.jobId);assert.equal(stopped.instrument,true);h.send({command:'status'});status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.instantiated,true);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-au-instrument-live-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));h.send({command:'renderMidi',outputPath:path.join(directory,'after-stop.wav'),sampleRate:48000,channels:2,durationFrames:4800,notes:[short],offline:true});const recovered=await h.next(event=>['renderedMidi','error'].includes(event.event));assert.equal(recovered.event,'renderedMidi',JSON.stringify(recovered));
 h.send({command:'playMidi',...base,durationFrames:48000,notes:[long]});const releasing=await h.next(event=>event.event==='playing');h.send({command:'release'});const released=await h.next(event=>event.event==='released');assert.equal(released.instantiated,false);h.send({command:'status'});status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.instantiated,false);
});
