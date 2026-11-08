import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
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
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-draft-http-'))),initialPath=path.join(directory,'A.newdaw.json'),recentPath=path.join(directory,'profile','recent.json');
 await fs.writeFile(initialPath,JSON.stringify(createProject({name:'Project A',sampleRate:8000}),null,2)+'\n');let server;
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});
 server=await startServer({projectPath:initialPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000,...options});
 return {directory,initialPath,recentPath,get url(){return server.url;},get server(){return server.server;},
  async reopen(){const projectPath=(await get(this)).session.document?.projectPath??initialPath;await server.close();server=await startServer({projectPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});}};
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

// Draft-specific API contracts are kept in these helpers so the tests compare
// behavior and durable state rather than requiring recovery paths in the UI.
const drafts=s=>get(s,'/api/workspace/drafts');
const planNew=(s,projectFolder,input={})=>planWorkspace(s,'new',{projectFolder,sampleRate:8000,mode:'active',...input});
async function createDraft(s,projectFolder,input={}){
 const old=await workspace(s),plan=await planNew(s,projectFolder,input);ok(await applyWorkspace(s,'new',plan));const current=await workspace(s),added=current.documents.filter(d=>!old.documents.some(o=>o.id===d.id));assert.equal(added.length,1);
 const registry=JSON.parse(await fs.readFile(`${s.recentPath}.drafts.json`)),entry=registry.entries.find(e=>e.projectId===added[0].projectId);assert.ok(entry);return {id:added[0].id,entry,workingPath:path.join(entry.projectFolder,`.newdaw-draft-${entry.id}.newdaw.json`),projectFolder:entry.projectFolder};
}
const firstSave=(s,outputPath,input={})=>documentPost(s,'/api/document/save',{outputPath,...input});
const recoverPlan=(s,draftId,input={})=>planWorkspace(s,'recover',{draftId,mode:'active',...input});

test('new-draft preview, dry run and Cancel leave folders, registry, current context and Recent untouched',async t=>{
 const s=await fixture(t),folder=path.join(s.directory,'not-created','Draft Session'),before=await get(s),disk=await files(s.directory);
 const plan=await planNew(s,folder);assert.equal(plan.kind,'new');
 assert.deepEqual(await files(s.directory),disk);await absent(folder);await absent(`${s.recentPath}.drafts.json`);
 const result=ok(await applyWorkspace(s,'new',plan,{dryRun:true}));assert.equal(result.applied,false);assert.deepEqual(await files(s.directory),disk);assert.deepEqual((await get(s)).project,before.project);assert.equal((await get(s)).session.document.id,before.session.document.id);
});

test('creating an empty Untitled document writes recovery state but no named checkpoint or Recent entry',async t=>{
 const s=await fixture(t),recent=await get(s,'/api/document/recent'),d=await createDraft(s,path.join(s.directory,'chosen-project-folder')),state=await get(s);
 assert.match(state.project.name,/^Untitled\d+$/);assert.equal(state.project.sampleRate,8000);assert.equal(state.project.revision,0);assert.deepEqual(state.project.tracks,[]);assert.deepEqual(state.project.clips,[]);assert.deepEqual(state.project.assets,[]);
 assert.equal(state.workspace.activeId,d.id);assert.equal(state.workspace.documents.length,2);assert.equal(state.session.document.neverSaved,true);assert.equal(state.session.document.available,false);assert.equal(state.session.document.dirty,true);assert.equal(state.session.document.saveId,null);assert.equal(state.session.document.projectPath,null);assert.equal(state.session.document.fileName,null);assert.equal(state.session.document.displayName,d.entry.name);
 assert.deepEqual(JSON.parse(await fs.readFile(d.workingPath)),state.project);await absent(`${d.workingPath}.saved.json`);assert.ok((await fs.stat(`${d.workingPath}.draft.json`)).isFile());assert.ok((await fs.stat(`${d.workingPath}.lock`)).isFile());assert.deepEqual((await get(s,'/api/document/recent')).entries,recent.entries);
 const registry=await drafts(s);assert.ok(registry.entries.some(e=>e.id===d.entry.id));
});

test('draft creation in a nonempty chosen folder preserves unrelated files and globally distinct Untitled numbers',async t=>{
 const s=await fixture(t),folder=path.join(s.directory,'existing');await fs.mkdir(folder);const foreign=path.join(folder,'unrelated.txt');await fs.writeFile(foreign,'leave this alone');
 const a=await createDraft(s,folder),aState=await get(s),b=await createDraft(s,folder,{mode:'inactive'});assert.notEqual(a.entry.id,b.entry.id);assert.notEqual(a.entry.projectId,b.entry.projectId);assert.ok(b.entry.number>a.entry.number);assert.notEqual(a.workingPath,b.workingPath);assert.equal(await fs.readFile(foreign,'utf8'),'leave this alone');assert.equal((await get(s)).session.document.id,aState.session.document.id);
 assert.equal((await workspace(s)).documents.length,3);await activate(s,b.id);await command(s,'project.rename',{name:'B working'});await activate(s,a.id);assert.equal((await get(s)).project.name,aState.project.name);assert.equal(JSON.parse(await fs.readFile(b.workingPath)).name,'B working');
});

test('draft Save without an output path and Revert before first Save never fabricate a saved baseline',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'draft')),before=await get(s),disk=await files(s.directory);
 const noPath=await documentPost(s,'/api/document/save');assert.equal(noPath.status,422,JSON.stringify(noPath.body));assert.equal(noPath.body.applied,false);
 const revert=await documentPost(s,'/api/document/revert/plan');assert.equal(revert.status,422,JSON.stringify(revert.body));assert.equal(revert.body.applied,false);assert.equal(revert.body.errors[0].code,'NO_SAVED_CHECKPOINT');
 assert.deepEqual(await files(s.directory),disk);assert.equal((await get(s)).session.document.neverSaved,true);assert.deepEqual((await get(s)).project,before.project);await absent(`${d.workingPath}.saved.json`);
});

test('first Save dry run and Cancel preserve the draft; apply keeps revision, history and stable workspace identity',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'draft'));await command(s,'project.rename',{name:'My first draft'});const before=await get(s),working=await fs.readFile(d.workingPath),output=path.join(d.projectFolder,'Named Song.newdaw.json'),disk=await files(s.directory);
 const dry=ok(await firstSave(s,output,{dryRun:true}));assert.equal(dry.applied,false);assert.deepEqual(await files(s.directory),disk);assert.equal((await get(s)).session.document.id,before.session.document.id);await absent(output);
 ok(await firstSave(s,output));const after=await get(s);assert.equal(after.session.document.neverSaved,false);assert.equal(after.session.document.projectPath,output);assert.equal(after.session.document.available,true);assert.equal(after.session.document.dirty,false);assert.ok(after.session.document.saveId);assert.notEqual(after.session.document.id,before.session.document.id);assert.equal(after.workspace.activeId,d.id);assert.equal(after.project.id,before.project.id);assert.equal(after.project.revision,before.project.revision);assert.deepEqual(after.historyView,before.historyView);
 assert.deepEqual(JSON.parse(await fs.readFile(output)),before.project);assert.deepEqual(await fs.readFile(d.workingPath),working);await absent(`${d.workingPath}.lock`);assert.ok((await fs.stat(`${output}.lock`)).isFile());assert.ok((await get(s,'/api/document/recent')).entries.some(e=>e.projectPath===output));
 await command(s,'project.rename',{name:'Only named file changes'});assert.equal(JSON.parse(await fs.readFile(output)).name,'Only named file changes');assert.deepEqual(await fs.readFile(d.workingPath),working);assert.equal((await drafts(s)).entries.find(e=>e.id===d.entry.id).resumable,false);
});

test('first Save As into another folder collects audio and preserves source recovery, undo history, and independent open documents',async t=>{
 const s=await fixture(t),aBefore=await fs.readFile(s.initialPath),d=await createDraft(s,path.join(s.directory,'draft-audio')),bytes=wav(389);await upload(s,bytes,'Draft source.wav');await command(s,'project.rename',{name:'Draft with audio'});const before=await get(s),asset=before.project.assets[0],outputFolder=path.join(s.directory,'named-audio');await fs.mkdir(outputFolder);const output=path.join(outputFolder,'Saved Song.json');
 ok(await documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath:output}));const after=await get(s);assert.equal(after.project.revision,before.project.revision);assert.deepEqual(after.historyView,before.historyView);assert.equal(after.workspace.activeId,d.id);assert.deepEqual(await fs.readFile(path.join(outputFolder,asset.path)),bytes);assert.deepEqual(await fs.readFile(path.join(d.projectFolder,asset.path)),bytes);assert.deepEqual(await fs.readFile(s.initialPath),aBefore);assert.ok((await render(s)).channels[0].some(v=>Math.abs(v)>.01));
 await s.reopen();assert.equal((await get(s)).session.document.neverSaved,false);assert.equal((await get(s)).session.document.projectPath,output);assert.deepEqual((await get(s)).historyView,after.historyView);assert.ok((await render(s)).channels[0].some(v=>Math.abs(v)>.01));
});

test('occupied, unsafe and stale first-Save targets preserve draft state and unrelated bytes',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'draft'));await command(s,'project.rename',{name:'Unsaved content'});const state=await get(s),working=await fs.readFile(d.workingPath),occupied=path.join(d.projectFolder,'occupied.json');await fs.writeFile(occupied,'unrelated existing file');
 for(const dryRun of [true,false]){const r=await firstSave(s,occupied,{dryRun});assert.ok(r.status>=400,JSON.stringify(r.body));assert.equal(r.body.applied,false);assert.equal(await fs.readFile(occupied,'utf8'),'unrelated existing file');}
 const link=path.join(s.directory,'linked-folder');await fs.symlink(d.projectFolder,link);const unsafe=await firstSave(s,path.join(link,'Named.json'));assert.ok(unsafe.status>=400);assert.equal((await get(s)).session.document.neverSaved,true);assert.deepEqual(await fs.readFile(d.workingPath),working);
 await command(s,'project.rename',{name:'Changed after path choice'});error(await post(s,'/api/document/save',{...guard(state),outputPath:path.join(d.projectFolder,'Stale.json')},{documentId:state.session.document.id}),409,'REVISION_CONFLICT');await absent(path.join(d.projectFolder,'Stale.json'));assert.equal((await get(s)).project.name,'Changed after path choice');
});

test('closing an inactive draft with Save saves only that target and preserves the active named document',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'inactive-save'));await command(s,'project.rename',{name:'Inactive draft saved'});const w=await workspace(s),aId=w.documents.find(e=>e.projectPath===s.initialPath).id;await activate(s,aId);const active=await get(s),aBytes=await fs.readFile(s.initialPath),aSaved=await fs.readFile(`${s.initialPath}.saved.json`),output=path.join(d.projectFolder,'Closed Draft.json'),plan=await planWorkspace(s,'close',{documentId:d.id});
 assert.equal(plan.policyTarget,'target');assert.equal(plan.requiresCurrentPolicy,true);const missing=await applyWorkspace(s,'close',plan,{currentPolicy:'save'});assert.equal(missing.status,422,JSON.stringify(missing.body));await absent(output);
 ok(await applyWorkspace(s,'close',plan,{currentPolicy:'save',saveOutputPath:output}));assert.equal(JSON.parse(await fs.readFile(output)).name,'Inactive draft saved');assert.equal((await workspace(s)).documents.some(e=>e.id===d.id),false);assert.equal((await get(s)).session.document.id,active.session.document.id);assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),aSaved);await absent(`${output}.lock`);assert.equal((await drafts(s)).entries.find(e=>e.id===d.entry.id).resumable,false);
});

test('closing a draft with preserve keeps resumable content and recovery restores never-saved identity with full history',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'recover-draft'));await command(s,'history.settings',{maxSteps:8});await command(s,'project.rename',{name:'Recover this unsaved edit'});await upload(s,wav(411));const before=await get(s),bytes=await fs.readFile(d.workingPath);
 await closeDocument(s,d.id);assert.equal((await get(s)).project,null);assert.equal((await drafts(s)).entries.find(e=>e.id===d.entry.id).resumable,true);assert.deepEqual(await fs.readFile(d.workingPath),bytes);await absent(`${d.workingPath}.lock`);
 const plan=await recoverPlan(s,d.entry.id);ok(await applyWorkspace(s,'recover',plan,{dryRun:true}));await absent(`${d.workingPath}.lock`);ok(await applyWorkspace(s,'recover',plan));const restored=await get(s);assert.equal(restored.session.document.neverSaved,true);assert.equal(restored.session.document.available,false);assert.equal(restored.session.document.dirty,true);assert.deepEqual(restored.project,before.project);assert.deepEqual(restored.historyView,before.historyView);await absent(`${d.workingPath}.saved.json`);assert.ok((await render(s)).channels[0].some(v=>Math.abs(v)>.01));
});

test('generic file Open cannot turn a draft recovery JSON into an explicitly saved project',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'guarded-draft'));await closeDocument(s,d.id);const bytes=await fs.readFile(d.workingPath),result=await workspacePost(s,'/open/plan',{projectPath:d.workingPath,mode:'active'});
 assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);assert.equal((await get(s)).project,null);await absent(`${d.workingPath}.saved.json`);assert.deepEqual(await fs.readFile(d.workingPath),bytes);assert.ok(!(await get(s,'/api/document/recent')).entries.some(e=>e.projectPath===d.workingPath));
});

test('blank and edited never-saved documents both receive distinct conventional backups with no active project',async t=>{
 let now=0;const s=await fixture(t,{backupClock:()=>now,backupPollMs:15}),aId=(await workspace(s)).activeId,folder=path.join(s.directory,'shared-drafts'),first=await createDraft(s,folder);
 await settings(s,{enabled:true,intervalMinutes:1,maxCount:2});const firstInitial=await get(s),second=await createDraft(s,folder);await settings(s,{enabled:true,intervalMinutes:1,maxCount:2});await command(s,'project.rename',{name:'Edited second draft'});
 await activate(s,aId);await closeDocument(s,aId);assert.equal((await get(s)).project,null);assert.equal((await workspace(s)).documents.length,2);
 now=61000;await until(async()=>(await listBackups(first.workingPath)).files.length===1&&(await listBackups(second.workingPath)).files.length===1,'both never-saved documents must back up without an active project');
 const a=(await listBackups(first.workingPath)).files[0],b=(await listBackups(second.workingPath)).files[0];assert.match(a.file,new RegExp(`^Untitled${first.entry.number}-\\d+\\.bak$`));assert.match(b.file,new RegExp(`^Untitled${second.entry.number}-\\d+\\.bak$`));assert.notEqual(a.file,b.file);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder,a.file))),firstInitial.project);assert.equal(JSON.parse(await fs.readFile(path.join(folder,b.file))).name,'Edited second draft');for(const d of [first,second])await absent(`${d.workingPath}.saved.json`);
 now=122000;await pause(100);assert.equal((await listBackups(first.workingPath)).files.length,1);assert.equal((await listBackups(second.workingPath)).files.length,1);
});

test('conventional Untitled backups skip foreign filename collisions, rotate only owned generations, and keep media bytes',async t=>{
 let now=0;const s=await fixture(t,{backupClock:()=>now,backupPollMs:15}),d=await createDraft(s,path.join(s.directory,'draft-backup'));await settings(s,{enabled:true,intervalMinutes:1,maxCount:2});const audio=wav(331);await upload(s,audio);const asset=(await get(s)).project.assets[0],foreign=path.join(d.projectFolder,`Untitled${d.entry.number}-01.bak`);await fs.writeFile(foreign,'unregistered foreign backup');
 now=61000;await until(async()=>(await listBackups(d.workingPath)).files.length===1);const oldest=(await listBackups(d.workingPath)).files[0];assert.notEqual(oldest.file,path.basename(foreign));assert.match(oldest.file,new RegExp(`^Untitled${d.entry.number}-\\d+\\.bak$`));
 for(const [name,time]of [['second',122000],['third',183000]]){await command(s,'project.rename',{name});now=time;await until(async()=>(await listBackups(d.workingPath)).files[0]?.revision===(await get(s)).project.revision);}
 const list=await listBackups(d.workingPath);assert.equal(list.files.length,2);assert.ok(!list.files.some(f=>f.id===oldest.id));assert.equal(await fs.readFile(foreign,'utf8'),'unregistered foreign backup');assert.deepEqual(await fs.readFile(path.join(d.projectFolder,asset.path)),audio);const projectId=(await get(s)).project.id;assert.ok(list.files.every(f=>f.projectId===projectId));
});

test('first Save preserves old Untitled generations and subsequent autosaves use the chosen named-file stem',async t=>{
 let now=0;const s=await fixture(t,{backupClock:()=>now,backupPollMs:15}),d=await createDraft(s,path.join(s.directory,'rename-backups'));await settings(s,{enabled:true,intervalMinutes:1,maxCount:2});await command(s,'project.rename',{name:'User display name'});now=61000;await until(async()=>(await listBackups(d.workingPath)).files.length===1);
 const old=(await listBackups(d.workingPath)).files[0],oldPath=path.join(d.projectFolder,old.file),oldBytes=await fs.readFile(oldPath),output=path.join(d.projectFolder,'Chosen Filename.newdaw.json');ok(await firstSave(s,output));
 assert.deepEqual(await fs.readFile(oldPath),oldBytes);await command(s,'project.rename',{name:'Different internal display name'});now=122000;await until(async()=>(await listBackups(output)).files.length===1);
 const named=(await listBackups(output)).files[0];assert.match(named.file,/^Chosen Filename-\d+\.bak$/);assert.deepEqual(await fs.readFile(oldPath),oldBytes);assert.equal(JSON.parse(await fs.readFile(path.join(d.projectFolder,named.file))).name,'Different internal display name');assert.equal((await listBackups(d.workingPath)).files[0].id,old.id);
});

async function launch(t,projectPath,recentPath){
 const child=spawn(process.execPath,['src/cli.mjs','serve','--project',projectPath,'--recent-store',recentPath,'--port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stderr.on('data',b=>errors+=b);const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const url=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timeout: '+output+errors)),10000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited during startup: '+errors));});});
 return {url,async kill(){child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');}};
}

test('a real process kill preserves acknowledged never-saved edits, redo history and audio for explicit recovery',async t=>{
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-draft-crash-'))),initialPath=path.join(directory,'Bootstrap.json'),recentPath=path.join(directory,'profile','recent.json');await fs.writeFile(initialPath,JSON.stringify(createProject({name:'Bootstrap',sampleRate:8000})));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const first=await launch(t,initialPath,recentPath),s={...first,directory,initialPath,recentPath};const d=await createDraft(s,path.join(directory,'Crash Draft'));await upload(s,wav(317));await command(s,'project.rename',{name:'One'});await command(s,'project.rename',{name:'Two'});await command(s,'history.undo');const before=await get(s),bytes=await fs.readFile(d.workingPath);
 await first.kill();assert.ok((await fs.stat(`${d.workingPath}.lock`)).isFile());const second=await launch(t,initialPath,recentPath),reopened={...second,directory,initialPath,recentPath};const list=await drafts(reopened);assert.equal(list.entries.find(e=>e.id===d.entry.id).resumable,true);
 ok(await applyWorkspace(reopened,'recover',await recoverPlan(reopened,d.entry.id)));const recovered=await get(reopened);assert.equal(recovered.session.document.neverSaved,true);assert.deepEqual(recovered.project,before.project);assert.deepEqual(recovered.historyView,before.historyView);assert.deepEqual(await fs.readFile(d.workingPath),bytes);await absent(`${d.workingPath}.saved.json`);assert.ok((await render(reopened)).channels[0].some(v=>Math.abs(v)>.01));await command(reopened,'history.redo');assert.equal((await get(reopened)).project.name,'Two');await second.kill();
});

test('corrupt draft descriptors and registry are preserved and cannot silently initialize a fresh saved project',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'corrupt-draft'));await closeDocument(s,d.id);const descriptor=`${d.workingPath}.draft.json`,original=await fs.readFile(descriptor);await fs.writeFile(descriptor,'{broken descriptor');
 let list=await drafts(s);assert.equal(list.entries.find(e=>e.id===d.entry.id).resumable,false);let result=await workspacePost(s,'/recover/plan',{draftId:d.entry.id,mode:'active'});assert.ok(result.status>=400);assert.equal(await fs.readFile(descriptor,'utf8'),'{broken descriptor');await absent(`${d.workingPath}.saved.json`);assert.equal((await get(s)).project,null);
 await fs.writeFile(descriptor,original);const registry=`${s.recentPath}.drafts.json`;await fs.writeFile(registry,'{broken registry');list=await drafts(s);assert.equal(list.status,'unavailable');assert.equal(list.revision,null);result=await workspacePost(s,'/new/plan',{projectFolder:path.join(s.directory,'should-not-exist'),mode:'active'});assert.ok(result.status>=400);assert.equal(await fs.readFile(registry,'utf8'),'{broken registry');await absent(path.join(s.directory,'should-not-exist'));
});

test('first-Save main publication failure keeps the draft recoverable and never reports a named-document commit',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'save-fault'));await command(s,'project.rename',{name:'Only draft is durable'});const before=await get(s),bytes=await fs.readFile(d.workingPath),output=path.join(d.projectFolder,'Failed Save.json'),originalLink=fs.link;
 const mocked=t.mock.method(fs,'link',async(...args)=>{if(args[1]===output)throw Object.assign(new Error('Injected first-Save project publication failure'),{code:'EIO'});return originalLink(...args);});
 try{const result=await firstSave(s,output);assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);}finally{mocked.mock.restore();}
 await absent(output);assert.equal((await get(s)).session.document.neverSaved,true);assert.equal((await get(s)).session.document.id,before.session.document.id);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(d.workingPath),bytes);assert.equal((await drafts(s)).entries.find(e=>e.id===d.entry.id).resumable,true);assert.ok((await fs.stat(`${d.workingPath}.lock`)).isFile());
});

test('named-project commit followed by draft-finalization failure remains published and cannot be resumed twice',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'retirement-fault'));await command(s,'project.rename',{name:'Committed first Save'});const output=path.join(d.projectFolder,'Published Song.json'),descriptor=`${d.workingPath}.draft.json`,originalRename=fs.rename;
 const mocked=t.mock.method(fs,'rename',async(...args)=>{if(args[1]===descriptor){const staged=JSON.parse(await fs.readFile(args[0]));if(staged.state==='published')throw Object.assign(new Error('Injected draft finalization failure'),{code:'EIO'});}return originalRename(...args);});
 let result;try{result=ok(await firstSave(s,output));}finally{mocked.mock.restore();}
 assert.equal(result.applied,true);assert.ok(result.warnings?.length,JSON.stringify(result));assert.equal((await get(s)).session.document.projectPath,output);assert.equal((await get(s)).session.document.neverSaved,false);assert.equal(JSON.parse(await fs.readFile(output)).name,'Committed first Save');
 let item=(await drafts(s)).entries.find(e=>e.id===d.entry.id);assert.equal(item.resumable,false);assert.equal(item.status,'published');assert.equal(item.targetPath,output);
 await s.reopen();item=(await drafts(s)).entries.find(e=>e.id===d.entry.id);assert.equal(item.resumable,false);assert.equal(item.status,'published');const recover=await workspacePost(s,'/recover/plan',{draftId:d.entry.id,mode:'active'});assert.ok(recover.status>=400);assert.equal((await get(s)).session.document.projectPath,output);
});

test('first Save rotates activation identity without increasing revision so delayed draft edits cannot reach the named file',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'save-identity')),before=await get(s),bytes=Buffer.from(JSON.stringify({command:'project.rename',arguments:{name:'WRONG old draft request'},expectedRevision:before.project.revision})),pending=await slowPost(s,'/api/command',bytes,{documentId:before.session.document.id});t.after(pending.abort);
 const output=path.join(d.projectFolder,'Named.json');ok(await firstSave(s,output));const state=await get(s);assert.equal(state.project.revision,before.project.revision);assert.notEqual(state.session.document.id,before.session.document.id);assert.equal(state.workspace.activeId,d.id);
 pending.finish();error(await pending.response,409,'DOCUMENT_CONFLICT');assert.deepEqual(JSON.parse(await fs.readFile(output)),before.project);assert.equal((await get(s)).project.name,before.project.name);
});

test('creating a new active draft can explicitly first-save the departing draft using the reviewed save output path',async t=>{
 const s=await fixture(t),first=await createDraft(s,path.join(s.directory,'departing-draft'));await command(s,'project.rename',{name:'First to name'});const before=await get(s),output=path.join(first.projectFolder,'First Named.json'),secondFolder=path.join(s.directory,'second-draft'),plan=await planNew(s,secondFolder);
 assert.equal(plan.requiresCurrentPolicy,true);assert.equal(plan.requiresSavePath,true);const noPath=await applyWorkspace(s,'new',plan,{currentPolicy:'save'});assert.equal(noPath.status,422,JSON.stringify(noPath.body));assert.equal((await get(s)).session.document.id,before.session.document.id);
 ok(await applyWorkspace(s,'new',plan,{currentPolicy:'save',saveOutputPath:output}));const state=await get(s);assert.equal(state.session.document.neverSaved,true);assert.notEqual(state.project.id,before.project.id);assert.equal(JSON.parse(await fs.readFile(output)).name,'First to name');const firstNamed=state.workspace.documents.find(e=>e.id===first.id);assert.ok(firstNamed);assert.equal(firstNamed.neverSaved,false);assert.equal(firstNamed.projectPath,output);assert.equal(firstNamed.active,false);
});

test('real CLI creates, lists, preserves, recovers and first-saves a draft through the shared API',async t=>{
 const s=await fixture(t),folder=path.join(s.directory,'cli-draft'),plan=await cli(s,'project-new-plan',folder,'--sample-rate','8000');const dry=await cli(s,'project-new',plan.id,'--dry-run');assert.equal(dry.applied,false);await absent(folder);
 await cli(s,'project-new',plan.id);let state=await cli(s,'status');assert.equal(state.project.sampleRate,8000);assert.equal(state.session.document.neverSaved,true);const list=await cli(s,'drafts'),draftId=list.entries[0].id,openId=state.workspace.activeId;
 const closePlan=await cli(s,'project-close-plan',openId);await cli(s,'project-close',closePlan.id,'--current','preserve');assert.equal((await cli(s,'status')).project,null);
 const recover=await cli(s,'project-recover-plan',draftId,'--inactive');await cli(s,'project-recover',recover.id);state=await cli(s,'status');assert.equal(state.project,null);const draftOpen=state.workspace.documents.find(e=>e.draftId===draftId);assert.ok(draftOpen);
 const activatePlan=await cli(s,'project-activate-plan',draftOpen.id);await cli(s,'project-activate',activatePlan.id);const output=path.join(folder,'CLI Saved.json');const saveDry=await cli(s,'save','--output',output,'--dry-run');assert.equal(saveDry.applied,false);await absent(output);await cli(s,'save','--output',output);state=await cli(s,'status');assert.equal(state.session.document.neverSaved,false);assert.equal(state.session.document.projectPath,output);assert.equal((await cli(s,'drafts')).entries.find(e=>e.id===draftId).resumable,false);
});


test('recovering an already-open draft deduplicates its workspace slot and keeps the original lock',async t=>{
 const s=await fixture(t),aId=(await workspace(s)).activeId,d=await createDraft(s,path.join(s.directory,'existing-draft'));await command(s,'project.rename',{name:'Still the same open draft'});const before=await get(s),lock=await fs.readFile(`${d.workingPath}.lock`),registry=await fs.readFile(`${s.recentPath}.drafts.json`);
 const unchanged=ok(await applyWorkspace(s,'recover',await recoverPlan(s,d.entry.id)));assert.equal(unchanged.applied,false);assert.deepEqual((await get(s)).workspace,before.workspace);assert.equal((await get(s)).session.document.id,before.session.document.id);assert.deepEqual(await fs.readFile(`${d.workingPath}.lock`),lock);
 await activate(s,aId);const inactiveState=await get(s),inactive=ok(await applyWorkspace(s,'recover',await recoverPlan(s,d.entry.id,{mode:'inactive'})));assert.equal(inactive.applied,false);assert.deepEqual((await get(s)).workspace,inactiveState.workspace);assert.equal((await get(s)).session.document.id,inactiveState.session.document.id);
 ok(await applyWorkspace(s,'recover',await recoverPlan(s,d.entry.id)));const active=await get(s);assert.equal(active.workspace.activeId,d.id);assert.equal(active.workspace.documents.length,2);assert.deepEqual(active.project,before.project);assert.deepEqual(active.historyView,before.historyView);assert.notEqual(active.session.document.id,before.session.document.id);assert.deepEqual(await fs.readFile(`${d.workingPath}.lock`),lock);assert.deepEqual(await fs.readFile(`${s.recentPath}.drafts.json`),registry);
});

test('new-draft default rate is 48000 and invalid rates or stale workspace plans do not allocate files or numbers',async t=>{
 const s=await fixture(t),folder=path.join(s.directory,'default-rate'),initial=await get(s);const plan=await planWorkspace(s,'new',{projectFolder:folder,mode:'active'});ok(await applyWorkspace(s,'new',plan));assert.equal((await get(s)).project.sampleRate,48000);
 const badFolder=path.join(s.directory,'invalid-rate'),disk=await files(s.directory);for(const sampleRate of [0,-1,48000.5,'48000']){const result=await workspacePost(s,'/new/plan',{projectFolder:badFolder,sampleRate,mode:'active'});assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);}assert.deepEqual(await files(s.directory),disk);await absent(badFolder);
 const staleFolder=path.join(s.directory,'stale-create'),stale=await planNew(s,staleFolder),oldWorkspace=await workspace(s);await command(s,'project.rename',{name:'Changed after new-draft preview'});const afterEdit=await files(s.directory),rejected=await post(s,'/api/workspace/new',{expectedWorkspaceRevision:oldWorkspace.revision,planId:stale.id,currentPolicy:'preserve'});error(rejected,409,'WORKSPACE_CONFLICT');await absent(staleFolder);assert.deepEqual(await files(s.directory),afterEdit);assert.equal((await workspace(s)).documents.length,2);assert.notEqual((await get(s)).project.id,initial.project.id);
});


test('failure while publishing the first-Save intent restores draft rendering and media-search resources',async t=>{
 const s=await fixture(t),d=await createDraft(s,path.join(s.directory,'intent-fault'));await upload(s,wav(277));const before=await get(s),working=await fs.readFile(d.workingPath),descriptor=`${d.workingPath}.draft.json`,descriptorBytes=await fs.readFile(descriptor),output=path.join(d.projectFolder,'Unpublished.json'),originalRename=fs.rename;
 const mocked=t.mock.method(fs,'rename',async(...args)=>{if(args[1]===descriptor){const staged=JSON.parse(await fs.readFile(args[0]));if(staged.state==='publishing')throw Object.assign(new Error('Injected draft publication-intent failure'),{code:'EIO'});}return originalRename(...args);});
 let failed;try{failed=await firstSave(s,output);}finally{mocked.mock.restore();}
 assert.ok(failed.status>=400,JSON.stringify(failed.body));assert.equal(failed.body.applied,false);await absent(output);assert.deepEqual(await fs.readFile(d.workingPath),working);assert.deepEqual(await fs.readFile(descriptor),descriptorBytes);assert.equal((await get(s)).session.document.id,before.session.document.id);assert.deepEqual((await get(s)).historyView,before.historyView);assert.ok((await render(s)).channels[0].some(v=>Math.abs(v)>.01));
 const state=await get(s),asset=state.project.assets[0],assetPath=path.join(d.projectFolder,asset.path),candidate=path.join(s.directory,'Intent Fault Source.wav');await fs.rename(assetPath,candidate);const job=ok(await post(s,'/api/media/search',{expectedRevision:state.project.revision,expectedMediaRevision:state.mediaRevision,assetId:asset.id,mode:'file',location:candidate}),202);let result;await until(async()=>{result=await get(s,`/api/media/search/${job.id}`);return result.status!=='running';},'media search must work after first-Save intent failure');assert.equal(result.status,'completed');assert.ok(result.candidates.some(c=>c.sha256===asset.sha256));await fs.rename(candidate,assetPath);
 ok(await firstSave(s,output));assert.equal((await get(s)).session.document.projectPath,output);
});
