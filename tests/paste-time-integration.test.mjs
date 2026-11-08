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

const args={clipId:'clip',atTick:480,lengthTicks:240,notes:[{pitch:72,velocity:85,startTick:0,durationTicks:120}]};
async function prepare(s){await seed(s,{notes:[{id:'cross',pitch:60,velocity:80,startTick:240,durationTicks:720}],events:[{id:'cc0',kind:'channel',status:176,data:[11,20],tick:0,curve:{type:'ramp'}},{id:'cc1',kind:'channel',status:176,data:[11,100],tick:960}]});ok(await command(s,'clip.add',{id:'untouched',trackId:'track',type:'midi',startTick:4000,lengthTicks:960,notes:[]}));}
test('Paste Time CLI persists curve fragments and source attributes through restart and one Undo Redo',async t=>{const s=await fixture(t);await prepare(s);const before=await get(s),unrelated=before.project.clips.find(c=>c.id==='untouched');const r=await cli(s,'command','midi.notes.pasteTime',JSON.stringify(args));assert.equal(r.applied,true);const after=await get(s);assert.equal(after.project.clips.length,4);assert.deepEqual(after.project.clips.find(c=>c.id==='untouched'),unrelated);assert.ok(after.project.clips.some(c=>c.events?.some(e=>e.curve?.window)));await s.reopen();assert.deepEqual((await get(s)).project,after.project);ok(await command(s,'history.undo'));assert.deepEqual((await get(s)).project.clips,before.project.clips);ok(await command(s,'history.redo'));assert.deepEqual((await get(s)).project.clips,after.project.clips);});
test('Paste Time stale requests dry run and invalid batch preserve source and files',async t=>{const s=await fixture(t);await prepare(s);const before=await get(s),disk=await fs.readFile(s.projectPath);const dry=ok(await command(s,'midi.notes.pasteTime',args,{dryRun:true}));assert.equal(dry.applied,false);rejected(await command(s,'midi.notes.pasteTime',args,{expectedRevision:0}),409);rejected(await command(s,'batch',{commands:[{command:'midi.notes.pasteTime',arguments:args},{command:'track.remove',arguments:{trackId:'missing'}}]}));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(s.projectPath),disk);});
test('Paste Time failed persistence restores original clip identities and curve data',async t=>{let fail=false;const s=await fixture(t,{persistProject:async(f,p)=>{if(fail)throw Error('injected persistence failure');return saveProject(f,p);}});await prepare(s);const before=await get(s),disk=await fs.readFile(s.projectPath);fail=true;assert.equal((await command(s,'midi.notes.pasteTime',args)).status,500);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);});
