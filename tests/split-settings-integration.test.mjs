import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createProject} from '../src/core/engine.mjs';
import {startServer} from '../src/server.mjs';
import {saveProject} from '../src/storage.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t,options={}) {
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-lanes-http-'))),projectPath=path.join(directory,'Controllers.json');
 await fs.writeFile(projectPath,JSON.stringify(createProject({name:'Controller command integration',sampleRate:8000}),null,2)+'\n');let server;
 const open=()=>startServer({projectPath,recentPath:path.join(directory,'recent.json'),port:0,demo:false,quiet:true,backupPollMs:60000,...options});
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});server=await open();
 return {directory,projectPath,get url(){return server.url;},async reopen(){await server.close();server=await open();}};
}
async function get(s,route='/api/state'){const r=await fetch(s.url+route);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function post(s,route,body,documentId){documentId??=(await get(s)).session.document.id;const r=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':documentId},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify({status:r.body.status,errors:r.body.errors}));return r.body;}
function rejected(r,status){if(status)assert.equal(r.status,status,JSON.stringify(r.body.errors));else assert.ok([409,422].includes(r.status),JSON.stringify(r.body.errors));assert.equal(r.body.applied,false);return r.body;}
async function command(s,name,args={},extra={},documentId){const st=await get(s);return post(s,'/api/command',{command:name,arguments:args,expectedRevision:st.project.revision,...extra},documentId);}
async function cli(s,...args){return JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:20000})).stdout);}
async function seed(s,{events=[],notes=[{id:'note',startTick:0,durationTicks:1920,pitch:69,velocity:100,channel:0}],lengthTicks=2880}={}){
 ok(await command(s,'batch',{commands:[{command:'track.add',arguments:{id:'track',type:'midi',name:'Controller synth',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',startTick:0,lengthTicks,notes,events:events.map((event,index)=>({order:index,...event}))}}]}));
}

test('Split preferences CLI persists independently and controls omitted split arguments with explicit override',async t=>{const s=await fixture(t);await seed(s,{notes:[{id:'n',pitch:60,velocity:80,startTick:240,durationTicks:1200}],events:[{id:'cc',kind:'channel',status:176,data:[11,80],tick:0}]});const before=await get(s),disk=await fs.readFile(s.projectPath),profile=await cli(s,'split-settings');await cli(s,'split-settings',JSON.stringify({expectedRevision:profile.settings.revision,expectedFingerprint:profile.fingerprint,options:{splitNotes:false,chaseControllers:true}}));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(s.projectPath),disk);await cli(s,'command','clip.split',JSON.stringify({clipId:'clip',atTick:960}));let clips=(await get(s)).project.clips;assert.equal(clips[0].notes[0].durationTicks,1200);assert.equal(clips[0].allowNoteTails,true);assert.equal(clips[1].notes.length,0);assert.ok(clips[1].events.some(e=>e.tick===0&&e.data[1]===80));ok(await command(s,'history.undo'));ok(await command(s,'clip.split',{clipId:'clip',atTick:960,splitNotes:true,chaseControllers:false}));assert.equal((await get(s)).project.clips[1].notes.length,1);await s.reopen();assert.deepEqual((await cli(s,'split-settings')).settings.options,{splitNotes:false,chaseControllers:true});});
