import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../../src/server.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
before(async()=>{await exec(process.execPath,['scripts/build-native-audio.mjs'],{cwd:root,timeout:120000});});
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-native-preview-api-')),projectPath=path.join(directory,'Preview.newdaw.json');
 const session=await startServer({projectPath,port:0,demo:false,quiet:true,nativeAudioOffline:true,backupPollMs:600000});
 t.after(async()=>{await session.close();await fs.rm(directory,{recursive:true,force:true});});
 return {...session,directory};
}
const get=async(s,route='/api/state')=>{const response=await fetch(s.url+route);assert.equal(response.status,200);return response.json();};
const post=async(s,route,input)=>{const response=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};};
async function seed(s){
 const result=await post(s,'/api/command',{command:'batch',arguments:{commands:[{command:'track.add',arguments:{id:'track',type:'midi',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',startTick:0,lengthTicks:3840,notes:[{id:'note',pitch:60,velocity:80,startTick:0,durationTicks:960,channel:0}]}}]},expectedRevision:0});
 assert.equal(result.status,200,JSON.stringify(result.body));
 const render=await post(s,'/api/render',{expectedRevision:1,preview:true});assert.equal(render.status,202,JSON.stringify(render.body));
 for(let i=0;i<100;i++){const job=await get(s,`/api/jobs/${render.body.jobId}`);if(job.status==='completed')return job;if(job.status==='failed')throw new Error(JSON.stringify(job));await new Promise(resolve=>setTimeout(resolve,20));}
 throw new Error('Native preview render did not finish');
}
test('native audio API routes a completed WAV through offline helper and rejects stale jobs',async t=>{
 const s=await fixture(t),job=await seed(s),initial=await get(s);
 const play=await post(s,'/api/native/audio/play',{jobId:job.id,expectedRevision:1});assert.equal(play.status,200,JSON.stringify(play.body));
 assert.equal(play.body.offline,true);assert.equal(play.body.renderJobId,job.id);assert.ok(['playing','completed'].includes(play.body.status));
 let status;for(let i=0;i<100;i++){status=await get(s,'/api/native/audio');if(status.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(status.jobId,play.body.jobId);assert.equal(status.status,'completed');
 const stale=await post(s,'/api/native/audio/play',{jobId:job.id,expectedRevision:0});assert.equal(stale.status,409);assert.equal(stale.body.errors[0].code,'REVISION_CONFLICT');
 const missing=await post(s,'/api/native/audio/play',{jobId:'00000000-0000-0000-0000-000000000000',expectedRevision:1});assert.equal(missing.status,409);assert.equal(missing.body.errors[0].code,'RENDER_NOT_READY');
 assert.deepEqual((await get(s)).project,initial.project);await post(s,'/api/native/audio/stop',{jobId:play.body.jobId});
});

test('native audio Stop conflict and project edit preserve ownership and stop the current job',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-native-preview-stop-')),helperPath=path.join(directory,'slow-helper.mjs');
 const helper=`#!/usr/bin/env node\nlet input='';console.log(JSON.stringify({event:'ready'}));process.stdin.on('data',chunk=>{input+=chunk;while(input.includes('\\n')){const line=input.slice(0,input.indexOf('\\n'));input=input.slice(input.indexOf('\\n')+1);const value=JSON.parse(line);if(value.command==='play')console.log(JSON.stringify({event:'playing',jobId:'slow-native-job',status:'playing'}));if(value.command==='stop')console.log(JSON.stringify({event:'stopped',jobId:'slow-native-job',status:'stopped'}));if(value.command==='quit')process.exit(0);}});\n`;
 await fs.writeFile(helperPath,helper,{mode:0o755});
 const projectPath=path.join(directory,'Stop.newdaw.json'),session=await startServer({projectPath,port:0,demo:false,quiet:true,nativeAudioHelperPath:helperPath,backupPollMs:600000});
 t.after(async()=>{await session.close();await fs.rm(directory,{recursive:true,force:true});});
 const job=await seed(session),play=await post(session,'/api/native/audio/play',{jobId:job.id,expectedRevision:1});assert.equal(play.status,200,JSON.stringify(play.body));assert.equal(play.body.status,'playing');
 const conflict=await post(session,'/api/native/audio/stop',{jobId:'00000000-0000-0000-0000-000000000000'});assert.equal(conflict.status,409);assert.equal(conflict.body.errors[0].code,'NATIVE_AUDIO_JOB_CONFLICT');
 assert.equal((await get(session,'/api/native/audio')).status,'playing');
 const edited=await post(session,'/api/command',{command:'project.rename',arguments:{name:'Stop native preview'},expectedRevision:1});assert.equal(edited.status,200,JSON.stringify(edited.body));
 let status;for(let i=0;i<100;i++){status=await get(session,'/api/native/audio');if(status.status==='stopped')break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(status.status,'stopped');assert.equal(status.reason,'project-edited');assert.equal(status.jobId,play.body.jobId);
});
