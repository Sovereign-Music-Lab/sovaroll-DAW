import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createProject} from '../src/core/engine.mjs';
import {startServer} from '../src/server.mjs';
import {listBackups} from '../src/auto-backup.mjs';
import {encodeWav,decodeWav} from '../src/media/wav.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const wav=(frequency=220)=>Buffer.from(encodeWav({sampleRate:8000,channels:[Float32Array.from({length:800},(_,i)=>.2*Math.sin(2*Math.PI*frequency*i/8000))]}));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,options={}){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-workspace-http-'))),initialPath=path.join(directory,'A.newdaw.json'),recentPath=path.join(directory,'profile','recent.json');
 await fs.writeFile(initialPath,JSON.stringify(createProject({name:'Project A',sampleRate:8000}),null,2)+'\n');let server;
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});
 server=await startServer({projectPath:initialPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000,...options});
 return {directory,initialPath,recentPath,get url(){return server.url;},get server(){return server.server;},
  async reopen(){const projectPath=(await get(this)).session.document.projectPath;await server.close();server=await startServer({projectPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});}};
}
async function get(s,route='/api/state'){const response=await fetch(s.url+route);assert.equal(response.status,200,await response.clone().text());return response.json();}
async function post(s,route,input,{documentId,omitHeader=false,headers={}}={}){
 if(!omitHeader&&documentId===undefined)documentId=(await get(s)).session.document?.id??null;
 const response=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(!omitHeader&&documentId?{'X-Newdaw-Document':documentId}:{}),...headers},body:JSON.stringify(input)});
 return {status:response.status,body:await response.json()};
}
function ok(result,status=200){assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
function error(result,status,code){assert.equal(result.status,status,JSON.stringify(result.body));assert.equal(result.body.applied,false);assert.equal(result.body.errors[0].code,code,JSON.stringify(result.body));return result.body.errors[0];}
const guard=state=>({expectedRevision:state.project.revision,expectedDocumentId:state.session.document.id});
async function documentPost(s,route,input={},options={}){const state=await get(s);return post(s,route,{...guard(state),...input},{documentId:state.session.document.id,...options});}
async function command(s,name,args={},extra={}){const state=await get(s);return ok(await post(s,'/api/command',{command:name,arguments:args,expectedRevision:state.project.revision,...extra},{documentId:state.session.document.id}));}
async function target(s,{name='Project B',filename='B.newdaw.json',project,seed}={}){
 const folder=path.join(s.directory,`target-${randomUUID()}`);await fs.mkdir(folder);const projectPath=path.join(folder,filename);
 await fs.writeFile(projectPath,JSON.stringify(project??createProject({name,sampleRate:8000}),null,2)+'\n');
 if(seed){const server=await startServer({projectPath,recentPath:path.join(folder,'seed-recent.json'),port:0,demo:false,quiet:true,backupPollMs:60000});try{await seed({url:server.url,directory:folder});}finally{await server.close();}}
 return projectPath;
}
const openPlan=async(s,projectPath)=>ok(await documentPost(s,'/api/document/open/plan',{projectPath}));
const applyOpen=async(s,plan,input={})=>documentPost(s,'/api/document/open',{planId:plan.id,currentPolicy:'preserve',...input});
const openTarget=async(s,projectPath,input={})=>ok(await applyOpen(s,await openPlan(s,projectPath),input));
const save=async s=>ok(await documentPost(s,'/api/document/save'));
async function absent(filename){await assert.rejects(fs.lstat(filename),{code:'ENOENT'});}
async function cli(s,...args){return JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:15000})).stdout);}
async function files(directory){const result={};async function visit(dir){for(const row of await fs.readdir(dir,{withFileTypes:true})){const filename=path.join(dir,row.name);if(row.isDirectory())await visit(filename);else if(row.isFile())result[path.relative(directory,filename)]=hash(await fs.readFile(filename));}}await visit(directory);return result;}
async function upload(s,bytes=wav(),name='Audio.wav'){
 const state=await get(s),response=await fetch(`${s.url}/api/import/wav?name=${encodeURIComponent(name)}&expectedRevision=${state.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/wav','X-Newdaw-Document':state.session.document.id},body:bytes});
 assert.equal(response.status,200,await response.clone().text());return response.json();
}
async function render(s){const before=await get(s),job=ok(await post(s,'/api/render',{expectedRevision:before.project.revision,durationSeconds:.1}),202);
 for(let i=0;i<200;i++){const current=await get(s,`/api/jobs/${job.id}`);if(current.status==='completed'){const response=await fetch(s.url+current.url);assert.equal(response.status,200);return decodeWav(new Uint8Array(await response.arrayBuffer()));}if(current.status==='failed')assert.fail(JSON.stringify(current.error));await pause(5);}assert.fail('render timed out');}
// Observe actual server receipt of headers before allowing an intentionally
// incomplete HTTP body to finish. This makes crossing tests independent of sleeps.
async function slowPost(s,route,bytes,{documentId,omitHeader=false,mime='application/json'}={}){
 const token=randomUUID();let observed;const accepted=new Promise(resolve=>{observed=resolve;});
 const listener=req=>{if(req.headers['x-test-open-request']===token){s.server.off('request',listener);observed();}};s.server.on('request',listener);
 let client;
 const response=new Promise((resolve,reject)=>{client=http.request(s.url+route,{method:'POST',headers:{'Content-Type':mime,'Content-Length':bytes.length,'X-Test-Open-Request':token,...(!omitHeader?{'X-Newdaw-Document':documentId}:{})}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});});client.on('error',reject);});
 client.write(bytes.subarray(0,1));await accepted;
 return {finish:()=>client.end(bytes.subarray(1)),abort:()=>client.destroy(),response};
}

const workspace=s=>get(s,'/api/workspace');
async function workspacePost(s,route,input={},options={}){const w=await workspace(s);return post(s,'/api/workspace'+route,{expectedWorkspaceRevision:w.revision,...input},options);}
const planWorkspace=async(s,kind,input)=>ok(await workspacePost(s,`/${kind}/plan`,input));
const applyWorkspace=(s,kind,plan,input={})=>workspacePost(s,`/${kind}`,{planId:plan.id,currentPolicy:'preserve',...input});
async function openWorkspace(s,projectPath,mode='inactive',input={}){return ok(await applyWorkspace(s,'open',await planWorkspace(s,'open',{projectPath,mode}),input));}
async function activate(s,documentId,input={}){return ok(await applyWorkspace(s,'activate',await planWorkspace(s,'activate',{documentId}),input));}
async function closeDocument(s,documentId,input={}){return ok(await applyWorkspace(s,'close',await planWorkspace(s,'close',{documentId}),input));}
const docAt=(w,filename)=>{const found=w.documents.find(d=>d.projectPath===filename);assert.ok(found,JSON.stringify(w));return found;};
async function settings(s,value){const state=await get(s);return ok(await post(s,'/api/backups/settings',{expectedRevision:state.project.revision,expectedSettingsRevision:state.session.settings.revision,autoBackup:value}));}
async function until(predicate,message='condition timed out'){for(let i=0;i<250;i++){if(await predicate())return;await pause(10);}assert.fail(message);}

test('workspace preview and dry run do not initialize or lock inactive targets or change the current document',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Dirty A'});const before=await get(s),disk=await files(s.directory),w=await workspace(s);
 assert.equal(w.documents.length,1);assert.equal(w.activeId,w.documents[0].id);assert.deepEqual(before.workspace,w);
 const plan=await planWorkspace(s,'open',{projectPath:b,mode:'inactive'});assert.equal(plan.kind,'open');assert.equal(plan.mode,'inactive');assert.equal(plan.requiresCurrentPolicy,false);
 assert.equal(plan.target.name,'Project B');assert.deepEqual(await files(s.directory),disk);await absent(`${b}.saved.json`);await absent(`${b}.lock`);
 const dry=ok(await applyWorkspace(s,'open',plan,{dryRun:true,currentPolicy:undefined}));assert.equal(dry.applied,false);assert.deepEqual(await workspace(s),w);assert.deepEqual(await files(s.directory),disk);assert.deepEqual((await get(s)).project,before.project);
});

test('inactive Open retains two real open contexts and locks without saving or replacing active A',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Unsaved A'});const before=await get(s),aBytes=await fs.readFile(s.initialPath),aSaved=await fs.readFile(`${s.initialPath}.saved.json`),bBytes=await fs.readFile(b);
 await openWorkspace(s,b);const state=await get(s),w=await workspace(s),a=docAt(w,s.initialPath),inactive=docAt(w,b);
 assert.equal(w.documents.length,2);assert.equal(w.activeId,a.id);assert.equal(a.active,true);assert.equal(inactive.active,false);assert.equal(inactive.resources,'deferred');assert.equal(a.dirty,true);
 assert.equal(state.session.document.id,before.session.document.id);assert.deepEqual(state.project,before.project);assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),aSaved);assert.deepEqual(await fs.readFile(b),bBytes);
 for(const filename of [s.initialPath,b])assert.ok((await fs.stat(`${filename}.lock`)).isFile());
 await assert.rejects(startServer({projectPath:b,recentPath:path.join(s.directory,'other-recent.json'),port:0,demo:false,quiet:true}),/already open|lock/i);
 await activate(s,inactive.id);const after=await workspace(s);assert.equal(after.documents.length,2);assert.equal(after.activeId,inactive.id);assert.equal(docAt(after,s.initialPath).active,false);assert.equal((await get(s)).project.name,'Project B');
});

test('inactive Open performs no WAV reads while activation performs the deferred hash and media inspection',async t=>{
 const s=await fixture(t);let asset;const bytes=wav(333),b=await target(s,{seed:async peer=>{asset=(await upload(peer,bytes)).project.assets[0];await save(peer);}});
 const mediaPath=path.join(path.dirname(b),asset.path),originalOpen=fs.open;let reads=0;
 const mocked=t.mock.method(fs,'open',async(...args)=>{if(path.resolve(String(args[0]))===mediaPath)reads++;return originalOpen(...args);});
 try{
  const plan=await planWorkspace(s,'open',{projectPath:b,mode:'inactive'});assert.equal(reads,0);ok(await applyWorkspace(s,'open',plan));assert.equal(reads,0);
  const id=docAt(await workspace(s),b).id;assert.equal(docAt(await workspace(s),b).resources,'deferred');
  const activating=await planWorkspace(s,'activate',{documentId:id});assert.ok(reads>0,'activation preview must inspect real media');reads=0;
  ok(await applyWorkspace(s,'activate',activating));assert.ok(reads>0,'activation apply must revalidate deferred media');assert.equal(docAt(await workspace(s),b).resources,'initialized');
 }finally{mocked.mock.restore();}
 assert.equal((await get(s,'/api/assets')).assets[0].status,'ready');assert.ok((await render(s)).channels[0].some(value=>Math.abs(value)>.01));assert.deepEqual(await fs.readFile(mediaPath),bytes);
});

test('active Open keeps the departing project open and handles equal project IDs with lower target revisions',async t=>{
 const s=await fixture(t),initial=await get(s),b=await target(s,{project:{...initial.project,name:'Older version B'}});await command(s,'project.rename',{name:'Newer working A'});const before=await get(s),a=docAt(await workspace(s),s.initialPath);
 const plan=await planWorkspace(s,'open',{projectPath:b,mode:'active'});assert.equal(plan.requiresCurrentPolicy,true);assert.equal(plan.policyTarget,'current');ok(await applyWorkspace(s,'open',plan));
 const state=await get(s),w=await workspace(s);assert.equal(w.documents.length,2);assert.equal(state.project.id,before.project.id);assert.ok(state.project.revision<before.project.revision);assert.notEqual(state.session.document.id,before.session.document.id);assert.equal(docAt(w,s.initialPath).id,a.id);assert.equal(docAt(w,s.initialPath).dirty,true);
 await activate(s,a.id);const restored=await get(s);assert.deepEqual(restored.project,before.project);assert.equal(restored.session.document.saveId,before.session.document.saveId);assert.notEqual(restored.session.document.id,before.session.document.id);assert.equal(restored.session.document.dirty,true);
});

test('each open document preserves independent history, explicit checkpoint, settings, and relative audio across activation',async t=>{
 const s=await fixture(t);await command(s,'history.settings',{maxSteps:2});await command(s,'project.rename',{name:'A saved'});await save(s);await command(s,'project.rename',{name:'A work'});await settings(s,{enabled:false,intervalMinutes:13,maxCount:2});const aState=await get(s);let bSeed;
 const b=await target(s,{seed:async peer=>{await upload(peer,wav(487),'B only.wav');await command(peer,'history.settings',{maxSteps:9});await command(peer,'project.rename',{name:'B saved'});await save(peer);await command(peer,'project.rename',{name:'B work'});await settings(peer,{enabled:false,intervalMinutes:23,maxCount:4});bSeed=await get(peer);}});
 await openWorkspace(s,b);const w=await workspace(s),aId=docAt(w,s.initialPath).id,bId=docAt(w,b).id;
 await activate(s,bId);let state=await get(s);assert.deepEqual(state.project,bSeed.project);assert.deepEqual(state.historyView,bSeed.historyView);assert.deepEqual(state.session.settings,bSeed.session.settings);assert.equal(state.session.document.saveId,bSeed.session.document.saveId);assert.equal(state.session.document.dirty,true);assert.ok((await render(s)).channels[0].some(value=>Math.abs(value)>.01));
 await command(s,'history.undo');const bUndone=await get(s);assert.equal(bUndone.project.name,'B saved');
 await activate(s,aId);state=await get(s);assert.deepEqual(state.project,aState.project);assert.deepEqual(state.historyView,aState.historyView);assert.deepEqual(state.session.settings,aState.session.settings);assert.equal(state.session.document.saveId,aState.session.document.saveId);
 await activate(s,bId);state=await get(s);assert.deepEqual(state.project,bUndone.project);assert.deepEqual(state.historyView,bUndone.historyView);assert.equal(state.history.canRedo,true);await command(s,'history.redo');assert.equal((await get(s)).project.name,'B work');
});

test('closing active A leaves B open with no active document until explicit activation, and closing the last tab remains usable',async t=>{
 const s=await fixture(t),b=await target(s);await openWorkspace(s,b);const w=await workspace(s),a=docAt(w,s.initialPath),inactive=docAt(w,b);await closeDocument(s,a.id);
 let state=await get(s);assert.equal(state.project,null);assert.equal(state.session.document,null);assert.equal(state.workspace.activeId,null);assert.equal(state.workspace.documents.length,1);assert.equal(state.workspace.documents[0].id,inactive.id);assert.equal(state.workspace.documents[0].active,false);assert.equal(state.history.canUndo,false);await absent(`${s.initialPath}.lock`);assert.ok((await fs.stat(`${b}.lock`)).isFile());
 assert.equal(await get(s,'/api/document'),null);assert.ok(Array.isArray((await get(s,'/api/document/recent')).entries));assert.equal((await fetch(s.url+'/')).status,200);
 await activate(s,inactive.id);state=await get(s);assert.equal(state.project.name,'Project B');assert.equal(state.workspace.activeId,inactive.id);
 await closeDocument(s,inactive.id);state=await get(s);assert.equal(state.project,null);assert.equal(state.workspace.documents.length,0);assert.equal(state.workspace.activeId,null);await absent(`${b}.lock`);
 await openWorkspace(s,s.initialPath,'active');assert.equal((await get(s)).project.name,'Project A');
});

test('inactive Close save and preserve policies apply only to the closing document; Cancel and dry run preserve it',async t=>{
 const s=await fixture(t),b=await target(s,{seed:async peer=>{await command(peer,'project.rename',{name:'Dirty B'});}});await openWorkspace(s,b);let w=await workspace(s),bId=docAt(w,b).id;const active=await get(s),saved=await fs.readFile(`${b}.saved.json`),working=await fs.readFile(b);
 let plan=await planWorkspace(s,'close',{documentId:bId});assert.equal(plan.requiresCurrentPolicy,true);assert.equal(plan.policyTarget,'target');
 const disk=await files(s.directory);const rejected=await applyWorkspace(s,'close',plan,{currentPolicy:undefined});assert.equal(rejected.status,422);assert.equal(rejected.body.applied,false);assert.deepEqual(await files(s.directory),disk);assert.equal((await workspace(s)).documents.length,2);
 ok(await applyWorkspace(s,'close',plan,{currentPolicy:'save',dryRun:true}));assert.deepEqual(await files(s.directory),disk);assert.equal((await workspace(s)).documents.length,2);
 ok(await applyWorkspace(s,'close',plan,{currentPolicy:'preserve'}));assert.deepEqual(await fs.readFile(b),working);assert.deepEqual(await fs.readFile(`${b}.saved.json`),saved);assert.equal((await get(s)).session.document.id,active.session.document.id);await absent(`${b}.lock`);
 await openWorkspace(s,b);bId=docAt(await workspace(s),b).id;plan=await planWorkspace(s,'close',{documentId:bId});ok(await applyWorkspace(s,'close',plan,{currentPolicy:'save'}));
 assert.deepEqual(await fs.readFile(b),working);const checkpoint=JSON.parse(await fs.readFile(`${b}.saved.json`));assert.equal(checkpoint.project.name,'Dirty B');assert.notDeepEqual(await fs.readFile(`${b}.saved.json`),saved);assert.deepEqual((await get(s)).project,active.project);assert.equal((await get(s)).session.document.id,active.session.document.id);
});

test('activation save policy updates only departing saved checkpoint while preserve keeps a dirty baseline',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'A dirty'});await openWorkspace(s,b);const w=await workspace(s),aId=docAt(w,s.initialPath).id,bId=docAt(w,b).id,before=await get(s),aBytes=await fs.readFile(s.initialPath);
 const plan=await planWorkspace(s,'activate',{documentId:bId});assert.equal(plan.requiresCurrentPolicy,true);const result=await applyWorkspace(s,'activate',plan,{currentPolicy:undefined});assert.equal(result.status,422);assert.equal((await workspace(s)).activeId,aId);
 ok(await applyWorkspace(s,'activate',plan,{currentPolicy:'save'}));assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.notEqual(JSON.parse(await fs.readFile(`${s.initialPath}.saved.json`)).saveId,before.session.document.saveId);
 await activate(s,aId);assert.equal((await get(s)).session.document.dirty,false);await command(s,'project.rename',{name:'A preserved'});const point=await fs.readFile(`${s.initialPath}.saved.json`);await activate(s,bId);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),point);assert.equal(docAt(await workspace(s),s.initialPath).dirty,true);
});

test('no-active mutations fail explicitly while state, events, workspace and recent remain available',async t=>{
 const s=await fixture(t),b=await target(s);await openWorkspace(s,b);await closeDocument(s,(await workspace(s)).activeId);const disk=await files(s.directory),w=await workspace(s);
 const cases=[['/api/command',{command:'project.rename',arguments:{name:'WRONG'},expectedRevision:0}],['/api/command',{command:'batch',arguments:{commands:[]},expectedRevision:0}],['/api/render',{expectedRevision:0,durationSeconds:.1}],['/api/backups/create',{expectedRevision:0}],['/api/document/save',{expectedRevision:0,expectedDocumentId:randomUUID()}]];
 for(const [route,input]of cases)error(await post(s,route,input,{omitHeader:true}),409,'NO_ACTIVE_DOCUMENT');
 const uploaded=await fetch(s.url+'/api/import/wav?expectedRevision=0',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav()});error({status:uploaded.status,body:await uploaded.json()},409,'NO_ACTIVE_DOCUMENT');
 const response=await fetch(s.url+'/api/events'),reader=response.body.getReader();const raw=new TextDecoder().decode((await reader.read()).value);await reader.cancel();const data=JSON.parse(raw.split('\n').find(x=>x.startsWith('data: ')).slice(6));assert.equal(data.project,null);assert.equal(data.workspace.activeId,null);assert.equal(data.workspace.documents.length,1);
 assert.deepEqual(await workspace(s),w);assert.deepEqual(await files(s.directory),disk);assert.ok(Array.isArray(await get(s,'/api/commands')));assert.ok(Array.isArray((await get(s,'/api/document/recent')).entries));
});

test('workspace revision CAS and edited project guards invalidate stale plans without changing open documents',async t=>{
 const s=await fixture(t),b=await target(s),c=await target(s,{name:'C'});const old=await workspace(s),plan=await planWorkspace(s,'open',{projectPath:b,mode:'inactive'});await openWorkspace(s,c);
 error(await workspacePost(s,'/open',{planId:plan.id,expectedWorkspaceRevision:old.revision}),409,'WORKSPACE_CONFLICT');assert.equal((await workspace(s)).documents.length,2);await absent(`${b}.lock`);
 const cId=docAt(await workspace(s),c).id,activatePlan=await planWorkspace(s,'activate',{documentId:cId});await command(s,'project.rename',{name:'Edited since activation preview'});const stale=await applyWorkspace(s,'activate',activatePlan);assert.equal(stale.status,409,JSON.stringify(stale.body));assert.equal((await get(s)).project.name,'Edited since activation preview');
 const fresh=await planWorkspace(s,'activate',{documentId:cId});await save(s);const invalidated=await applyWorkspace(s,'activate',fresh);assert.ok([404,409].includes(invalidated.status),JSON.stringify(invalidated.body));assert.equal((await workspace(s)).activeId,docAt(await workspace(s),s.initialPath).id);
});

test('A to B to A rotates request identity so stale same-file mutations and slow bodies cannot cross activation',async t=>{
 const s=await fixture(t),initial=await get(s),b=await target(s,{project:{...initial.project,name:'B same identity'}});await openWorkspace(s,b);const w=await workspace(s),aId=docAt(w,s.initialPath).id,bId=docAt(w,b).id;
 const bytes=Buffer.from(JSON.stringify({command:'project.rename',arguments:{name:'WRONG late A'},expectedRevision:initial.project.revision})),pending=await slowPost(s,'/api/command',bytes,{documentId:initial.session.document.id});t.after(pending.abort);
 await activate(s,bId);await activate(s,aId);const state=await get(s);assert.equal(state.project.id,initial.project.id);assert.equal(state.project.revision,initial.project.revision);assert.equal(state.workspace.activeId,aId);assert.notEqual(state.session.document.id,initial.session.document.id);
 pending.finish();error(await pending.response,409,'DOCUMENT_CONFLICT');error(await post(s,'/api/command',{command:'project.rename',arguments:{name:'WRONG stale A'},expectedRevision:initial.project.revision},{documentId:initial.session.document.id}),409,'DOCUMENT_CONFLICT');
 assert.deepEqual((await get(s)).project,initial.project);await command(s,'project.rename',{name:'Current A'});assert.equal((await get(s)).project.name,'Current A');
});

test('invalid or externally locked workspace targets fail without releasing any existing document lock',async t=>{
 const s=await fixture(t),b=await target(s),locked=await target(s,{name:'Locked C'});await openWorkspace(s,b);const peer=await startServer({projectPath:locked,port:0,demo:false,quiet:true,recentPath:path.join(s.directory,'peer-recents.json')});t.after(()=>peer.close());
 const w=await workspace(s),state=await get(s),bad=path.join(s.directory,'invalid.json'),link=path.join(s.directory,'alias.json');await fs.writeFile(bad,'{not-json');await fs.symlink(b,link);
 for(const projectPath of [bad,link,path.join(s.directory,'missing.json')]){const result=await workspacePost(s,'/open/plan',{projectPath,mode:'inactive'});assert.ok(result.status>=400,JSON.stringify(result.body));assert.deepEqual(await workspace(s),w);}
 const plan=await planWorkspace(s,'open',{projectPath:locked,mode:'inactive'}),result=await applyWorkspace(s,'open',plan);assert.ok(result.status>=400,JSON.stringify(result.body));assert.match(result.body.errors[0].message,/already open|lock/i);assert.deepEqual(await workspace(s),w);assert.equal((await get(s)).session.document.id,state.session.document.id);
 for(const file of [s.initialPath,b])assert.ok((await fs.stat(`${file}.lock`)).isFile());
});

test('activation detects inactive disk content replacement and preserves both contexts without adopting external edits',async t=>{
 const s=await fixture(t),b=await target(s);await openWorkspace(s,b);const w=await workspace(s),bId=docAt(w,b).id,state=await get(s),plan=await planWorkspace(s,'activate',{documentId:bId});
 const external=Buffer.from(JSON.stringify({...JSON.parse(await fs.readFile(b)),name:'External B'}));await fs.writeFile(b,external);const result=await applyWorkspace(s,'activate',plan);assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.applied,false);assert.equal((await workspace(s)).activeId,w.activeId);assert.equal((await get(s)).session.document.id,state.session.document.id);assert.deepEqual(await fs.readFile(b),external);assert.equal(docAt(await workspace(s),b).name,'Project B');
});

test('same-path workspace Open and same active Activate do not duplicate slots or reset document identity',async t=>{
 const s=await fixture(t);await command(s,'project.rename',{name:'A with history'});let state=await get(s),w=await workspace(s);
 await openWorkspace(s,s.initialPath,'inactive');assert.equal((await workspace(s)).documents.length,1);assert.equal((await get(s)).session.document.id,state.session.document.id);assert.deepEqual((await get(s)).historyView,state.historyView);
 await activate(s,w.activeId);assert.equal((await get(s)).session.document.id,state.session.document.id);assert.equal((await workspace(s)).documents.length,1);
 const b=await target(s);await openWorkspace(s,b);w=await workspace(s);const bId=docAt(w,b).id;await openWorkspace(s,b);assert.equal((await workspace(s)).documents.length,2);assert.equal(docAt(await workspace(s),b).id,bId);await openWorkspace(s,b,'active');assert.equal((await workspace(s)).activeId,bId);assert.equal((await workspace(s)).documents.length,2);
});

test('one application backs up dirty active and inactive documents, including preexisting unsaved work, and skips clean documents',async t=>{
 let now=0;const options={backupClock:()=>now,backupPollMs:15},s=await fixture(t,options);await settings(s,{enabled:true,intervalMinutes:1,maxCount:2});await command(s,'project.rename',{name:'Dirty A'});
 const b=await target(s,{name:'B saved',seed:async peer=>{await settings(peer,{enabled:true,intervalMinutes:1,maxCount:2});await command(peer,'project.rename',{name:'Preexisting unsaved B'});}}),c=await target(s,{name:'Clean C'});
 await openWorkspace(s,b);await openWorkspace(s,c);const before=await workspace(s);assert.equal(docAt(before,b).dirty,true);assert.equal(docAt(before,c).dirty,false);const bytes=await Promise.all([s.initialPath,b,c].map(p=>fs.readFile(p)));
 now=61000;await until(async()=>(await listBackups(s.initialPath)).files.length===1&&(await listBackups(b)).files.length===1,'all changed open projects must be backed up, including initially inactive dirty B');
 assert.equal((await listBackups(c)).files.length,0);assert.equal(JSON.parse(await fs.readFile(path.join(path.dirname(b),(await listBackups(b)).files[0].file))).name,'Preexisting unsaved B');
 for(const [i,p]of [s.initialPath,b,c].entries())assert.deepEqual(await fs.readFile(p),bytes[i]);
 const first=(await listBackups(s.initialPath)).files[0].id;
 for(const [name,time]of [['A2',122000],['A3',183000]]){await command(s,'project.rename',{name});now=time;await until(async()=>(await listBackups(s.initialPath)).files[0]?.revision===(await get(s)).project.revision);}
 const backups=await listBackups(s.initialPath);assert.equal(backups.files.length,2);assert.ok(!backups.files.some(f=>f.id===first));assert.equal((await listBackups(b)).files.length,1);assert.equal((await workspace(s)).documents.length,3);
});

test('automatic backups continue for dirty inactive projects when no project is active, without copying audio bytes',async t=>{
 let now=0;const s=await fixture(t,{backupClock:()=>now,backupPollMs:15});let asset;const bytes=wav(277),b=await target(s,{seed:async peer=>{await upload(peer,bytes);await save(peer);await command(peer,'project.rename',{name:'Unsaved inactive audio project'});await settings(peer,{enabled:true,intervalMinutes:1,maxCount:2});asset=(await get(peer)).project.assets[0];}});
 await openWorkspace(s,b);const w=await workspace(s);await closeDocument(s,w.activeId);assert.equal((await get(s)).project,null);assert.equal(docAt(await workspace(s),b).dirty,true);
 const mediaPath=path.join(path.dirname(b),asset.path),mediaBefore=await fs.readFile(mediaPath);now=61000;await until(async()=>(await listBackups(b)).files.length===1,'inactive dirty B must back up even with no active document');
 const list=await listBackups(b),backup=JSON.parse(await fs.readFile(path.join(path.dirname(b),list.files[0].file)));assert.equal(backup.name,'Unsaved inactive audio project');assert.deepEqual(backup.assets[0],asset);assert.deepEqual(await fs.readFile(mediaPath),mediaBefore);assert.equal((await fs.readdir(path.join(path.dirname(b),'assets'))).length,1);
 await closeDocument(s,docAt(await workspace(s),b).id);const snapshot=await files(path.dirname(b));now=122000;await pause(80);assert.deepEqual(await files(path.dirname(b)),snapshot);assert.equal((await workspace(s)).documents.length,0);
});

test('a failed inactive backup is reported per document without preventing other open documents from backing up',async t=>{
 let now=0;const s=await fixture(t,{backupClock:()=>now,backupPollMs:15});await settings(s,{enabled:true,intervalMinutes:1,maxCount:2});await command(s,'project.rename',{name:'A must back up'});
 const b=await target(s,{seed:async peer=>{await settings(peer,{enabled:true,intervalMinutes:1,maxCount:2});await command(peer,'project.rename',{name:'B backup fails'});}});await openWorkspace(s,b);
 const registry=`${b}.autobackups.json`,originalOpen=fs.open;
 const mocked=t.mock.method(fs,'open',async(...args)=>{if(String(args[0]).startsWith(registry)&&args[1]==='wx')throw Object.assign(new Error('Injected inactive backup write failure'),{code:'EIO'});return originalOpen(...args);});
 try{now=61000;await until(async()=>(await listBackups(s.initialPath)).files.length===1&&docAt(await workspace(s),b).autoBackup.lastError,'one failing document must not block healthy backup');assert.equal((await listBackups(b)).files.length,0);assert.match(docAt(await workspace(s),b).autoBackup.lastError.message,/Injected/);}finally{mocked.mock.restore();}
 now=122000;await until(async()=>(await listBackups(b)).files.length===1,'failed backup must retry');assert.equal(docAt(await workspace(s),b).autoBackup.lastError,null);
});

test('legacy document replacement changes only the active workspace slot and keeps other inactive documents open',async t=>{
 const s=await fixture(t),b=await target(s),c=await target(s,{name:'Replacement C'});await openWorkspace(s,b);const bId=docAt(await workspace(s),b).id;
 await openTarget(s,c);const state=await get(s),w=await workspace(s);assert.equal(state.project.name,'Replacement C');assert.equal(w.documents.length,2);assert.equal(docAt(w,b).id,bId);assert.equal(docAt(w,b).active,false);assert.equal(docAt(w,c).active,true);assert.ok(!w.documents.some(d=>d.projectPath===s.initialPath));await absent(`${s.initialPath}.lock`);assert.ok((await fs.stat(`${b}.lock`)).isFile());
 await activate(s,bId);assert.equal((await get(s)).project.name,'Project B');
});

test('Save New Version updates the active workspace path and lock without overwriting another open document',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'A versioned'});await openWorkspace(s,b);const before=await workspace(s),bId=docAt(before,b).id,aBytes=await fs.readFile(s.initialPath),bBytes=await fs.readFile(b);
 ok(await documentPost(s,'/api/document/save-as',{mode:'version'}));const state=await get(s),w=await workspace(s);assert.equal(w.documents.length,2);assert.notEqual(state.session.document.projectPath,s.initialPath);assert.equal(docAt(w,state.session.document.projectPath).active,true);assert.equal(docAt(w,b).id,bId);assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.deepEqual(await fs.readFile(b),bBytes);assert.ok((await fs.stat(`${state.session.document.projectPath}.lock`)).isFile());await absent(`${s.initialPath}.lock`);
 await activate(s,bId);assert.equal((await get(s)).project.name,'Project B');await activate(s,w.activeId);assert.equal((await get(s)).session.document.projectPath,state.session.document.projectPath);
});

test('real CLI opens inactive projects, activates, closes to no-active, lists and explicitly reactivates',async t=>{
 const s=await fixture(t),b=await target(s),initial=await cli(s,'projects'),aId=initial.activeId;
 const plan=await cli(s,'project-open-plan',b,'--inactive');assert.equal(plan.mode,'inactive');const dry=await cli(s,'project-open',plan.id,'--dry-run');assert.equal(dry.applied,false);assert.equal((await cli(s,'projects')).documents.length,1);
 await cli(s,'project-open',plan.id);let w=await cli(s,'projects');assert.equal(w.documents.length,2);const bId=docAt(w,b).id;assert.equal(w.activeId,aId);
 const activating=await cli(s,'project-activate-plan',bId);await cli(s,'project-activate',activating.id,'--current','preserve');assert.equal((await cli(s,'status')).project.name,'Project B');
 const closing=await cli(s,'project-close-plan',bId);await cli(s,'project-close',closing.id,'--current','preserve');assert.equal((await cli(s,'status')).project,null);assert.equal((await cli(s,'projects')).activeId,null);assert.ok(Array.isArray((await cli(s,'recent')).entries));
 const recentBefore=await cli(s,'recent');await cli(s,'recent-clear','--confirm','--dry-run');assert.equal((await cli(s,'recent')).entries.length,recentBefore.entries.length);await cli(s,'recent-clear','--confirm');assert.equal((await cli(s,'recent')).entries.length,0);assert.equal((await cli(s,'projects')).documents.length,1);
 await assert.rejects(cli(s,'save'),error=>{assert.match(error.stderr??error.message,/NO_ACTIVE_DOCUMENT|No project is active/i);assert.doesNotMatch(error.stderr??error.message,/Cannot read properties/);return true;});
 const activateA=await cli(s,'project-activate-plan',aId);await cli(s,'project-activate',activateA.id);assert.equal((await cli(s,'status')).project.name,'Project A');
});

test('external current main-file changes after activation preview are rejected before preserve or save',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'A working state'});await openWorkspace(s,b);const bId=docAt(await workspace(s),b).id,plan=await planWorkspace(s,'activate',{documentId:bId}),state=await get(s),saved=await fs.readFile(`${s.initialPath}.saved.json`);
 const external=Buffer.from(JSON.stringify({...state.project,name:'External edit of A'}));await fs.writeFile(s.initialPath,external);
 for(const currentPolicy of ['preserve','save'])error(await applyWorkspace(s,'activate',plan,{currentPolicy}),409,'PROJECT_FILE_CHANGED');
 assert.deepEqual(await fs.readFile(s.initialPath),external);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),saved);assert.deepEqual((await get(s)).project,state.project);assert.equal((await get(s)).session.document.id,state.session.document.id);assert.equal((await workspace(s)).documents.length,2);
});

test('external saved-checkpoint replacement invalidates active transition and inactive Close before overwriting that checkpoint',async t=>{
 const s=await fixture(t),b=await target(s,{seed:async peer=>{await command(peer,'project.rename',{name:'B dirty'});}});await command(s,'project.rename',{name:'A dirty'});await openWorkspace(s,b);const w=await workspace(s),bId=docAt(w,b).id,state=await get(s);
 let plan=await planWorkspace(s,'activate',{documentId:bId});const aCheckpoint=`${s.initialPath}.saved.json`,aBefore=await fs.readFile(aCheckpoint),aPoint=JSON.parse(aBefore);aPoint.saveId=randomUUID();const aExternal=Buffer.from(JSON.stringify(aPoint));await fs.writeFile(aCheckpoint,aExternal);
 error(await applyWorkspace(s,'activate',plan,{currentPolicy:'save'}),409,'WORKSPACE_CONFLICT');assert.deepEqual(await fs.readFile(aCheckpoint),aExternal);assert.equal((await get(s)).session.document.id,state.session.document.id);
 // Restore only this temporary fixture's checkpoint so the independent target
 // conflict is evaluated without a second concurrent current-side conflict.
 await fs.writeFile(aCheckpoint,aBefore);plan=await planWorkspace(s,'close',{documentId:bId});const bCheckpoint=`${b}.saved.json`,bPoint=JSON.parse(await fs.readFile(bCheckpoint));bPoint.saveId=randomUUID();const bExternal=Buffer.from(JSON.stringify(bPoint));await fs.writeFile(bCheckpoint,bExternal);
 error(await applyWorkspace(s,'close',plan,{currentPolicy:'save'}),409,'WORKSPACE_CONFLICT');assert.deepEqual(await fs.readFile(bCheckpoint),bExternal);assert.equal((await workspace(s)).documents.length,2);assert.ok((await fs.stat(`${b}.lock`)).isFile());
});

test('a departing explicit Save publication failure preserves the old active context and both open locks',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'A unsaved'});await openWorkspace(s,b);const bId=docAt(await workspace(s),b).id,plan=await planWorkspace(s,'activate',{documentId:bId}),before=await get(s),saved=await fs.readFile(`${s.initialPath}.saved.json`),originalRename=fs.rename;
 const mocked=t.mock.method(fs,'rename',async(...args)=>{if(args[1]===`${s.initialPath}.saved.json`)throw Object.assign(new Error('Injected Save publication failure'),{code:'EIO'});return originalRename(...args);});
 try{const result=await applyWorkspace(s,'activate',plan,{currentPolicy:'save'});assert.equal(result.status,500,JSON.stringify(result.body));assert.equal(result.body.applied,false);assert.equal(result.body.errors[0].details.activated,false);assert.equal(result.body.errors[0].details.currentSaved,false);}finally{mocked.mock.restore();}
 assert.equal((await get(s)).session.document.id,before.session.document.id);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),saved);assert.equal((await workspace(s)).documents.length,2);for(const file of [s.initialPath,b])assert.ok((await fs.stat(`${file}.lock`)).isFile());
 await activate(s,bId,{currentPolicy:'save'});assert.equal((await get(s)).project.name,'Project B');
});

test('restart releases all open locks and restores the selected project history without claiming persistent workspace membership',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'A persisted history'});await openWorkspace(s,b);const before=await get(s),aBytes=await fs.readFile(s.initialPath),bBytes=await fs.readFile(b);
 await s.reopen();const after=await get(s);assert.equal(after.project.name,'A persisted history');assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.deepEqual(await fs.readFile(b),bBytes);assert.equal(after.workspace.documents.length,1);await absent(`${b}.lock`);
 const peer=await startServer({projectPath:b,port:0,demo:false,quiet:true,recentPath:path.join(s.directory,'restart-peer-recent.json')});await peer.close();assert.equal((await get(s)).session.document.projectPath,s.initialPath);
});
