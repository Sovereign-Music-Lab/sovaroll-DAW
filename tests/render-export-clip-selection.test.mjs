import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startServer} from '../src/server.mjs';
import {decodeWav} from '../src/media/wav.mjs';

const post=async(session,route,input)=>{const response=await fetch(session.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};};
async function completedRender(session,input){
 const started=await post(session,'/api/render',input);assert.equal(started.status,202,JSON.stringify(started.body));
 let job;for(let i=0;i<200;i++){const response=await fetch(`${session.url}/api/jobs/${started.body.jobId}`);job=await response.json();if(job.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(job.status,'completed',JSON.stringify(job));const response=await fetch(`${session.url}/api/jobs/${started.body.jobId}/audio.wav`);assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());
}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sovaroll-export-clips-')),session=await startServer({projectPath:path.join(directory,'Probe.newdaw.json'),port:0,demo:false,quiet:true,backupPollMs:600000});
 t.after(async()=>{await session.close();await fs.rm(directory,{recursive:true,force:true});});
 const seeded=await post(session,'/api/command',{command:'batch',arguments:{commands:[{command:'track.add',arguments:{id:'track',type:'midi',instrument:'sine'}},{command:'clip.add',arguments:{id:'selected',trackId:'track',type:'midi',startTick:0,lengthTicks:1920,notes:[{id:'a',pitch:60,velocity:90,startTick:0,durationTicks:960,channel:0}]}},{command:'clip.add',arguments:{id:'other',trackId:'track',type:'midi',startTick:0,lengthTicks:1920,notes:[{id:'b',pitch:72,velocity:90,startTick:0,durationTicks:960,channel:0}]}}]},expectedRevision:0});assert.equal(seeded.status,200,JSON.stringify(seeded.body));return session;
}

test('Export render accepts validated clipIds and preserves the project',async t=>{
 const session=await fixture(t),before=await(await fetch(session.url+'/api/state')).json();
 const all=await completedRender(session,{expectedRevision:1,durationSeconds:.5,tailSeconds:0}),selected=await completedRender(session,{expectedRevision:1,durationSeconds:.5,tailSeconds:0,clipIds:['selected']});
 const decoded=decodeWav(selected);assert.ok(decoded.channels[0].some(value=>Math.abs(value)>.01));assert.notEqual(createHash('sha256').update(selected).digest('hex'),createHash('sha256').update(all).digest('hex'));
 const after=await(await fetch(session.url+'/api/state')).json();assert.equal(after.project.revision,1);assert.deepEqual(after.project,before.project);
});

test('Export clip selection rejects empty unknown and stale requests without edits',async t=>{
 const session=await fixture(t),before=await(await fetch(session.url+'/api/state')).json();
 for(const input of [{expectedRevision:1,clipIds:[]},{expectedRevision:1,clipIds:['missing']}]){const result=await post(session,'/api/render',input);assert.equal(result.status,422);assert.equal(result.body.errors[0].code,'INVALID_RENDER_CLIPS');}
 const stale=await post(session,'/api/render',{expectedRevision:0,clipIds:['selected']});assert.equal(stale.status,409);assert.equal(stale.body.errors[0].code,'REVISION_CONFLICT');
 const after=await(await fetch(session.url+'/api/state')).json();assert.equal(after.project.revision,1);assert.deepEqual(after.project,before.project);
});
