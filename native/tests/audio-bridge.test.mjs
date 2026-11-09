import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {encodeWav} from '../../src/media/wav.mjs';
const root=path.resolve(import.meta.dirname,'../..'),binary=path.join(root,'.native-build/newdaw-audio'),exec=promisify(execFile);
before(async()=>{await exec(process.execPath,['scripts/build-native-audio.mjs'],{cwd:root,timeout:120000});});
const sha=data=>createHash('sha256').update(data).digest('hex');
function sourcePcm(bytes){
 bytes=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength); for(let at=12;at+8<=bytes.length;){const name=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4);if(name==='data')return bytes.subarray(at+8,at+8+size);at+=8+size+(size%2);}
 throw new Error('Missing test WAV data');
}
async function helper(t){
 const process=spawn(binary,[],{stdio:['pipe','pipe','pipe']});let buffered='',events=[],waiters=[];
 const fail=error=>{for(const waiter of waiters.splice(0))waiter.reject(error);};
 process.on('error',fail);process.on('exit',code=>{if(code!==0)fail(new Error('Audio helper exited '+code));});
 process.stdout.on('data',bytes=>{
  buffered+=bytes.toString();
  while(buffered.includes('\n')){const index=buffered.indexOf('\n'),line=buffered.slice(0,index);buffered=buffered.slice(index+1);const event=JSON.parse(line);events.push(event);for(const waiter of [...waiters])if(waiter.predicate(event)){events.splice(events.indexOf(event),1);waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(event);}}
 });
 const next=(predicate,timeout=5000)=>{
  const found=events.findIndex(predicate);if(found>=0)return Promise.resolve(events.splice(found,1)[0]);
  return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Timed out waiting for native audio event'));},timeout)};waiters.push(waiter);});
 };
 const send=value=>process.stdin.write(JSON.stringify(value)+'\n');
 t.after(async()=>{if(process.exitCode===null){send({command:'quit'});await new Promise(resolve=>process.once('exit',resolve));}await fs.rm(directory,{recursive:true,force:true});});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-native-audio-'));
 return {send,next,directory,process};
}
async function renderAndRead(t,wave){
 const h=await helper(t),file=path.join(h.directory,'source.wav');await fs.writeFile(file,wave);
 await h.next(event=>event.event==='ready');h.send({command:'play',path:file,offline:true});
 const playing=await h.next(event=>event.event==='playing');assert.equal(playing.offline,true);
 const completed=await h.next(event=>event.event==='completed');assert.equal(completed.offline,true);assert.equal(completed.pcmSha256,sha(sourcePcm(wave)));
 h.send({command:'status'});const status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.status,'completed');assert.equal(status.jobId,playing.jobId);
 h.send({command:'stop'});const stopped=await h.next(event=>event.event==='stopped');assert.equal(stopped.status,'unchanged');
 return h;
}
test('native audio offline AVAudioEngine render preserves mono PCM and lifecycle',async t=>{
 const rate=48000,channel=Float32Array.from({length:4800},(_,i)=>.2*Math.sin(2*Math.PI*220*i/rate)),wave=encodeWav({sampleRate:rate,channels:[channel]});
 const h=await renderAndRead(t,wave);h.send({command:'play',path:path.join(h.directory,'missing.wav'),offline:true});
 const missing=await h.next(event=>event.event==='error');assert.equal(missing.code,'WAV_NOT_READABLE');
 const invalid=path.join(h.directory,'invalid.wav');await fs.writeFile(invalid,'not wav');h.send({command:'play',path:invalid,offline:true});
 const rejected=await h.next(event=>event.event==='error'&&event.message.includes('RIFF'));assert.equal(rejected.code,'INVALID_WAV');
 h.send({command:'play',path:path.join(h.directory,'source.wav')});
 const output=await h.next(event=>event.event==='error');assert.equal(output.code,'OUTPUT_REQUIRED');
});

test('native audio offline render preserves stereo PCM bytes',async t=>{
 const rate=44100,left=Float32Array.from({length:441},(_,i)=>.3*Math.sin(i*.07)),right=Float32Array.from({length:441},(_,i)=>-.15*Math.cos(i*.11));
 await renderAndRead(t,encodeWav({sampleRate:rate,channels:[left,right]}));
});

test('native audio device preview honors explicit future host-time start with silent PCM',async t=>{
 const h=await helper(t),rate=48000,channel=Float32Array.from({length:4800},()=>0),file=path.join(h.directory,'silent.wav');await fs.writeFile(file,encodeWav({sampleRate:rate,channels:[channel]}));await h.next(event=>event.event==='ready');
 h.send({command:'clock.now'});const clock=await h.next(event=>event.event==='clock'),now=BigInt(clock.uptimeNs),target=now+200000000n;
 h.send({command:'play',path:file,allowDefaultOutput:true,startAtUptimeNs:0});assert.equal((await h.next(event=>event.event==='error')).code,'INVALID_START_TIME');
 h.send({command:'play',path:file,offline:true,startAtUptimeNs:Number(target)});assert.equal((await h.next(event=>event.event==='error')).code,'START_AT_OFFLINE');
 h.send({command:'play',path:file,allowDefaultOutput:true,startAtUptimeNs:Number(target)});const playing=await h.next(event=>['playing','error'].includes(event.event));assert.equal(playing.event,'playing',JSON.stringify(playing));assert.equal(playing.startedUptimeNs,target.toString());
 const started=await h.next(event=>event.event==='started'&&event.jobId===playing.jobId);assert.ok(BigInt(started.actualStartUptimeNs)>=target);
 const completed=await h.next(event=>event.event==='completed'&&event.jobId===playing.jobId);assert.equal(completed.status,'completed');h.send({command:'status'});const status=await h.next(event=>event.event==='status');assert.equal(status.playing,false);assert.equal(status.status,'completed');
 h.send({command:'clock.now'});const secondClock=await h.next(event=>event.event==='clock'),secondTarget=BigInt(secondClock.uptimeNs)+200000000n;h.send({command:'play',path:file,allowDefaultOutput:true,startAtUptimeNs:Number(secondTarget)});const scheduled=await h.next(event=>event.event==='playing');h.send({command:'stop'});const stopped=await h.next(event=>event.event==='stopped'&&event.jobId===scheduled.jobId);assert.equal(stopped.status,'stopped');await new Promise(resolve=>setTimeout(resolve,350));h.send({command:'status'});const cancelled=await h.next(event=>event.event==='status');assert.equal(cancelled.playing,false);assert.equal(cancelled.status,'stopped');
});
