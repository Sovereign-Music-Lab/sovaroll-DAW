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
import {encodeWav,decodeWav} from '../src/media/wav.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const wav=(frequency=220)=>Buffer.from(encodeWav({sampleRate:8000,channels:[Float32Array.from({length:800},(_,i)=>.2*Math.sin(2*Math.PI*frequency*i/8000))]}));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-open-http-'))),initialPath=path.join(directory,'A.newdaw.json'),recentPath=path.join(directory,'profile','recent.json');
 await fs.writeFile(initialPath,JSON.stringify(createProject({name:'Project A',sampleRate:8000}),null,2)+'\n');let server;
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});
 server=await startServer({projectPath:initialPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});
 return {directory,initialPath,recentPath,get url(){return server.url;},get server(){return server.server;},
  async reopen(){const projectPath=(await get(this)).session.document.projectPath;await server.close();server=await startServer({projectPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});}};
}
async function get(s,route='/api/state'){const response=await fetch(s.url+route);assert.equal(response.status,200,await response.clone().text());return response.json();}
async function post(s,route,input,{documentId,omitHeader=false,headers={}}={}){
 if(!omitHeader&&documentId===undefined)documentId=(await get(s)).session.document.id;
 const response=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(!omitHeader?{'X-Newdaw-Document':documentId}:{}),...headers},body:JSON.stringify(input)});
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

test('Open preview and dry run preserve current files, recent order and an uninitialized target',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Working A'});const before=await get(s),disk=await files(s.directory);
 const plan=await openPlan(s,b);assert.equal(plan.sameDocument,false);assert.equal(plan.requiresCurrentPolicy,true);assert.equal(plan.current.dirty,true);assert.equal(plan.target.name,'Project B');assert.equal(plan.target.willInitializeSavedCheckpoint,true);
 assert.deepEqual(await files(s.directory),disk);await absent(`${b}.lock`);await absent(`${b}.saved.json`);
 const dry=ok(await applyOpen(s,plan,{dryRun:true}));assert.equal(dry.status,'validated');assert.equal(dry.applied,false);
 assert.deepEqual(await files(s.directory),disk);assert.deepEqual((await get(s)).project,before.project);assert.equal((await get(s)).session.document.id,before.session.document.id);
});

test('Open preserve switches real project content and locks without rewriting either main project',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Working A'});const before=await get(s),aBytes=await fs.readFile(s.initialPath),savedBytes=await fs.readFile(`${s.initialPath}.saved.json`),bBytes=await fs.readFile(b);
 const result=await openTarget(s,b);assert.equal(result.activated,true);assert.equal(result.currentSaved,false);
 const after=await get(s);assert.equal(after.project.name,'Project B');assert.equal(after.project.revision,0);assert.notEqual(after.project.id,before.project.id);assert.notEqual(after.session.document.id,before.session.document.id);assert.equal(after.session.id,before.session.id);assert.ok(after.sequence>before.sequence);assert.equal(after.session.requiresDocumentId,true);
 assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),savedBytes);assert.deepEqual(await fs.readFile(b),bBytes);await absent(`${s.initialPath}.lock`);assert.ok((await fs.stat(`${b}.lock`)).isFile());
 await command(s,'project.rename',{name:'Only B changes'});assert.equal(JSON.parse(await fs.readFile(b)).name,'Only B changes');assert.deepEqual(await fs.readFile(s.initialPath),aBytes);
 await openTarget(s,s.initialPath);const restored=await get(s);assert.equal(restored.project.name,'Working A');assert.equal(restored.session.document.dirty,true);assert.equal(restored.history.canUndo,true);
});

test('Open save updates the departing explicit checkpoint while preserving its working revision and history',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'A explicitly saved on departure'});const before=await get(s),bytes=await fs.readFile(s.initialPath),journal=await fs.readFile(`${s.initialPath}.history.json`);
 const result=await openTarget(s,b,{currentPolicy:'save'});assert.equal(result.currentSaved,true);assert.deepEqual(await fs.readFile(s.initialPath),bytes);assert.deepEqual(await fs.readFile(`${s.initialPath}.history.json`),journal);
 const saved=JSON.parse(await fs.readFile(`${s.initialPath}.saved.json`));assert.notEqual(saved.saveId,before.session.document.saveId);assert.equal(saved.project.name,before.project.name);
 await openTarget(s,s.initialPath);const restored=await get(s);assert.equal(restored.project.revision,before.project.revision);assert.equal(restored.session.document.dirty,false);assert.deepEqual(restored.historyView,before.historyView);
});

test('dirty or unavailable current save points require a deliberate policy and Cancel leaves files untouched',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Do not discard'});let plan=await openPlan(s,b);const disk=await files(s.directory),before=await get(s);
 error(await applyOpen(s,plan,{currentPolicy:undefined}),422,'CURRENT_POLICY_REQUIRED');error(await applyOpen(s,plan,{currentPolicy:'discard'}),422,'CURRENT_POLICY_REQUIRED');
 // Closing a preview sends no command; another read must still see the same state.
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await files(s.directory),disk);
 await fs.writeFile(`${s.initialPath}.saved.json`,'broken checkpoint');plan=await openPlan(s,b);assert.equal(plan.current.available,false);assert.equal(plan.current.dirty,null);assert.equal(plan.requiresCurrentPolicy,true);
 error(await applyOpen(s,plan,{currentPolicy:undefined}),422,'CURRENT_POLICY_REQUIRED');ok(await applyOpen(s,plan));assert.equal(await fs.readFile(`${s.initialPath}.saved.json`,'utf8'),'broken checkpoint');
});

test('reopening the same path is a no-op that preserves document identity, history and recent order',async t=>{
 const s=await fixture(t);await command(s,'project.rename',{name:'Unsaved current'});const before=await get(s),disk=await files(s.directory),plan=await openPlan(s,s.initialPath);
 assert.equal(plan.sameDocument,true);assert.equal(plan.requiresCurrentPolicy,false);const result=ok(await applyOpen(s,plan,{currentPolicy:undefined}));assert.equal(result.status,'unchanged');assert.equal(result.applied,false);
 const after=await get(s);assert.equal(after.session.document.id,before.session.document.id);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await files(s.directory),disk);
});

test('same project IDs and lower revisions still activate a different file and publish a complete SSE snapshot',async t=>{
 const s=await fixture(t),initial=await get(s),b=await target(s,{project:{...initial.project,name:'Older sibling version'}});await command(s,'project.rename',{name:'Newer A'});const before=await get(s);
 const response=await fetch(s.url+'/api/events'),reader=response.body.getReader();t.after(()=>reader.cancel().catch(()=>{}));await reader.read();
 await openTarget(s,b);const after=await get(s);assert.equal(after.project.id,before.project.id);assert.ok(after.project.revision<before.project.revision);assert.equal(after.project.name,'Older sibling version');assert.notEqual(after.session.document.id,before.session.document.id);assert.ok(after.sequence>before.sequence);
 const chunk=new TextDecoder().decode((await reader.read()).value),data=chunk.split('\n').find(line=>line.startsWith('data: '));assert.ok(data,chunk);const event=JSON.parse(data.slice(6));assert.equal(event.session.document.id,after.session.document.id);assert.deepEqual(event.project,after.project);assert.equal(event.session.id,before.session.id);await reader.cancel();
});

test('target history, saved baseline, backup settings and generations are restored without source state leaking',async t=>{
 const s=await fixture(t);await command(s,'history.settings',{maxSteps:2});let seeded;
 const b=await target(s,{seed:async peer=>{await command(peer,'history.settings',{maxSteps:7});await command(peer,'project.rename',{name:'B saved'});await save(peer);await command(peer,'project.rename',{name:'B working'});
  const state=await get(peer);ok(await post(peer,'/api/backups/settings',{expectedRevision:state.project.revision,expectedSettingsRevision:state.session.settings.revision,autoBackup:{enabled:false,intervalMinutes:17,maxCount:3}}));ok(await post(peer,'/api/backups/create',{expectedRevision:state.project.revision}));seeded=await get(peer);}});
 const bytes=await fs.readFile(b);await openTarget(s,b);const after=await get(s);assert.deepEqual(after.project,seeded.project);assert.deepEqual(after.historyView,seeded.historyView);assert.deepEqual(after.session.settings,seeded.session.settings);assert.equal(after.session.document.saveId,seeded.session.document.saveId);assert.equal(after.session.document.dirty,true);assert.deepEqual(await fs.readFile(b),bytes);
 const backups=await get(s,'/api/backups');assert.equal(backups.files.length,1);assert.equal(backups.files[0].projectId,after.project.id);assert.equal(after.session.autoBackup.lastId,backups.files[0].id);
 await s.reopen();const reopened=await get(s);assert.deepEqual(reopened.project,after.project);assert.deepEqual(reopened.historyView,after.historyView);assert.deepEqual(reopened.session.settings,after.session.settings);assert.equal(reopened.session.document.projectPath,b);
});

test('target relative WAV media uses its own directory and missing media remains an honest open warning',async t=>{
 const s=await fixture(t),bytes=wav(389);let asset;
 const b=await target(s,{seed:async peer=>{const result=await upload(peer,bytes);asset=result.project.assets[0];await save(peer);}});
 await fs.mkdir(path.join(s.directory,'assets'));await fs.writeFile(path.join(s.directory,asset.path),'wrong file in old active directory');
 const plan=await openPlan(s,b);assert.equal(plan.target.media[0].status,'ready');const bBytes=await fs.readFile(b);ok(await applyOpen(s,plan));assert.equal((await get(s,'/api/assets')).assets[0].status,'ready');
 const audio=await render(s);assert.ok(audio.channels[0].some(value=>Math.abs(value)>.01));assert.deepEqual(await fs.readFile(path.join(path.dirname(b),asset.path)),bytes);assert.deepEqual(await fs.readFile(b),bBytes);
 await openTarget(s,s.initialPath);await fs.unlink(path.join(path.dirname(b),asset.path));const missing=await openPlan(s,b);assert.equal(missing.target.media[0].status,'missing');assert.ok(missing.warnings.length);const result=ok(await applyOpen(s,missing));assert.ok(result.warnings.length);assert.equal((await get(s,'/api/assets')).assets[0].status,'missing');await absent(path.join(path.dirname(b),asset.path));
});

test('missing, malformed, schema-incompatible and symbolic-link targets fail without replacing the current context',async t=>{
 const s=await fixture(t),b=await target(s),before=await get(s),original=await fs.readFile(s.initialPath);const invalid=path.join(s.directory,'invalid.json'),unknown=path.join(s.directory,'unknown.json'),link=path.join(s.directory,'link.json');
 await fs.writeFile(invalid,'{broken');await fs.writeFile(unknown,JSON.stringify({...createProject(),schemaVersion:999}));await fs.symlink(b,link);
 for(const projectPath of [path.join(s.directory,'missing.json'),invalid,unknown,link]){const result=await documentPost(s,'/api/document/open/plan',{projectPath});assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);assert.equal((await get(s)).session.document.id,before.session.document.id);assert.deepEqual((await get(s)).project,before.project);}
 assert.deepEqual(await fs.readFile(s.initialPath),original);await absent(`${b}.saved.json`);await absent(`${b}.lock`);
});

test('a target held by another server cannot activate or save the departing project',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Keep dirty'});const peer=await startServer({projectPath:b,recentPath:path.join(path.dirname(b),'peer-recent.json'),port:0,demo:false,quiet:true});t.after(()=>peer.close());
 const before=await get(s),saved=await fs.readFile(`${s.initialPath}.saved.json`),plan=await openPlan(s,b),result=await applyOpen(s,plan,{currentPolicy:'save'});
 assert.ok(result.status>=400);assert.match(result.body.errors[0].message,/already open|lock/i);assert.equal((await get(s)).session.document.id,before.session.document.id);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),saved);assert.ok((await fs.stat(`${s.initialPath}.lock`)).isFile());
});

test('current edits, explicit Save and external same-revision checkpoints invalidate Open previews',async t=>{
 const s=await fixture(t),b=await target(s);let plan=await openPlan(s,b);await command(s,'project.rename',{name:'Changed after preview'});error(await applyOpen(s,plan),409,'REVISION_CONFLICT');
 plan=await openPlan(s,b);const revision=(await get(s)).project.revision;await save(s);assert.equal((await get(s)).project.revision,revision);error(await applyOpen(s,plan),404,'OPEN_PLAN_NOT_FOUND');assert.equal((await get(s)).session.document.projectPath,s.initialPath);
 plan=await openPlan(s,b);const pointPath=`${s.initialPath}.saved.json`,point=JSON.parse(await fs.readFile(pointPath));point.saveId=randomUUID();await fs.writeFile(pointPath,JSON.stringify(point));error(await applyOpen(s,plan),409,'REVISION_CONFLICT');assert.equal((await get(s)).project.revision,revision);
});

test('external replacement of the current project after preview refuses Open before Save or active transfer',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Engine working A'});const plan=await openPlan(s,b),before=await get(s),saved=await fs.readFile(`${s.initialPath}.saved.json`);
 const external=Buffer.from(JSON.stringify({...before.project,name:'Externally changed A'}));await fs.writeFile(s.initialPath,external);
 for(const currentPolicy of ['preserve','save'])error(await applyOpen(s,plan,{currentPolicy}),409,'PROJECT_FILE_CHANGED');
 assert.deepEqual(await fs.readFile(s.initialPath),external);assert.deepEqual(await fs.readFile(`${s.initialPath}.saved.json`),saved);assert.deepEqual((await get(s)).project,before.project);assert.equal((await get(s)).session.document.id,before.session.document.id);await absent(`${b}.lock`);
});

test('changed target content and same-byte target inode replacement invalidate inspected Open plans',async t=>{
 const s=await fixture(t),b=await target(s);const original=await fs.readFile(b);let plan=await openPlan(s,b);await fs.writeFile(b,JSON.stringify({...JSON.parse(original),name:'Changed B'}));error(await applyOpen(s,plan),409,'PROJECT_FILE_CHANGED');
 plan=await openPlan(s,b);const bytes=await fs.readFile(b),replacement=b+'.replacement';await fs.writeFile(replacement,bytes);await fs.rename(replacement,b);error(await applyOpen(s,plan),409,'PROJECT_FILE_CHANGED');assert.equal((await get(s)).session.document.projectPath,s.initialPath);await absent(`${b}.lock`);
});

test('target-only checkpoint and settings changes load fresh validated state with an explicit preview-change warning',async t=>{
 const s=await fixture(t),b=await target(s,{seed:async peer=>{await command(peer,'project.rename',{name:'Target with history'});await save(peer);}}),plan=await openPlan(s,b),bytes=await fs.readFile(b);
 const peer=await startServer({projectPath:b,recentPath:path.join(path.dirname(b),'seed-recent.json'),port:0,demo:false,quiet:true});let expected;
 try{const state=await get(peer);ok(await post(peer,'/api/backups/settings',{expectedRevision:state.project.revision,expectedSettingsRevision:state.session.settings.revision,autoBackup:{enabled:false,intervalMinutes:29,maxCount:4}}));await save(peer);expected=await get(peer);}finally{await peer.close();}
 const journalPath=`${b}.history.json`,journal=JSON.parse(await fs.readFile(journalPath));journal.current.history.entries[0].description='Latest target-only metadata';await fs.writeFile(journalPath,JSON.stringify(journal));assert.deepEqual(await fs.readFile(b),bytes);
 const result=ok(await applyOpen(s,plan));assert.ok(result.warnings.some(w=>w.code==='TARGET_SESSION_UPDATED'),JSON.stringify(result.warnings));const after=await get(s);assert.equal(after.session.document.saveId,expected.session.document.saveId);assert.deepEqual(after.session.settings,expected.session.settings);assert.equal(after.historyView.entries[0].description,'Latest target-only metadata');assert.deepEqual(await fs.readFile(b),bytes);
});

test('corrupt target session sidecars are left untouched by preview and disclosed rather than falsely restored',async t=>{
 const s=await fixture(t),b=await target(s),badSaved=Buffer.from('{bad save'),badHistory=Buffer.from('{bad history');await fs.writeFile(`${b}.saved.json`,badSaved);await fs.writeFile(`${b}.history.json`,badHistory);
 const filesBefore=await files(path.dirname(b)),plan=await openPlan(s,b);assert.equal(plan.target.savedAvailable,false);assert.ok(plan.warnings.length);assert.deepEqual(await files(path.dirname(b)),filesBefore);
 const result=ok(await applyOpen(s,plan));assert.ok(result.warnings.length);const after=await get(s);assert.equal(after.project.name,'Project B');assert.equal(after.session.document.available,false);assert.equal(after.history.canUndo,false);assert.deepEqual(await fs.readFile(`${b}.saved.json`),badSaved);
 const preserved=(await fs.readdir(path.dirname(b))).filter(name=>name.startsWith(path.basename(b)+'.history.json.quarantine-'));assert.equal(preserved.length,1);assert.deepEqual(await fs.readFile(path.join(path.dirname(b),preserved[0])),badHistory);
});

test('Recent actually reopens documents, deduplicates paths, preserves separate versions and survives restart',async t=>{
 const s=await fixture(t),a=(await get(s)).project,b=await target(s,{project:{...a,name:'Same ID version B'}});await openTarget(s,b);await openTarget(s,s.initialPath);
 let recent=await get(s,'/api/document/recent');assert.equal(recent.entries.length,2);assert.equal(recent.entries[0].projectPath,s.initialPath);assert.equal(new Set(recent.entries.map(e=>e.id)).size,2);assert.equal(new Set(recent.entries.map(e=>e.projectId)).size,1);
 const entry=recent.entries.find(e=>e.projectPath===b),plan=ok(await documentPost(s,'/api/document/open/plan',{recentId:entry.id}));ok(await applyOpen(s,plan));assert.equal((await get(s)).project.name,'Same ID version B');recent=await get(s,'/api/document/recent');assert.equal(recent.entries[0].id,entry.id);assert.equal(recent.entries.length,2);
 await s.reopen();recent=await get(s,'/api/document/recent');assert.equal(recent.entries[0].id,entry.id);assert.equal(recent.entries.length,2);assert.equal((await get(s)).session.document.projectPath,b);
});

test('Recent remove and clear use registry CAS and change only the list, including their dry runs',async t=>{
 const s=await fixture(t),b=await target(s);await openTarget(s,b);const state=await get(s),aBytes=await fs.readFile(s.initialPath),bBytes=await fs.readFile(b),list=await get(s,'/api/document/recent'),entry=list.entries.find(e=>e.projectPath===s.initialPath);
 const dry=ok(await documentPost(s,'/api/document/recent/remove',{expectedRegistryRevision:list.revision,entryId:entry.id,dryRun:true}));assert.equal(dry.applied,false);assert.equal((await get(s,'/api/document/recent')).entries.length,2);
 ok(await documentPost(s,'/api/document/recent/remove',{expectedRegistryRevision:list.revision,entryId:entry.id}));error(await documentPost(s,'/api/document/recent/remove',{expectedRegistryRevision:list.revision,clear:true}),409,'RECENT_REVISION_CONFLICT');
 const updated=await get(s,'/api/document/recent');ok(await documentPost(s,'/api/document/recent/remove',{expectedRegistryRevision:updated.revision,clear:true}));assert.equal((await get(s,'/api/document/recent')).entries.length,0);assert.deepEqual((await get(s)).project,state.project);assert.equal((await get(s)).session.document.id,state.session.document.id);assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.deepEqual(await fs.readFile(b),bBytes);
});

test('missing Recent targets remain listed and a corrupt registry cannot undo an otherwise successful Open',async t=>{
 const s=await fixture(t),b=await target(s);await openTarget(s,b);await openTarget(s,s.initialPath);await fs.unlink(b);let recent=await get(s,'/api/document/recent'),entry=recent.entries.find(e=>e.projectPath===b);assert.equal(entry.status,'missing');
 const result=await documentPost(s,'/api/document/open/plan',{recentId:entry.id});assert.ok(result.status>=400);assert.equal((await get(s)).session.document.projectPath,s.initialPath);assert.ok((await get(s,'/api/document/recent')).entries.some(e=>e.id===entry.id));
 const c=await target(s,{name:'Valid C'}),bad=Buffer.from('{corrupt recent');await fs.writeFile(s.recentPath,bad);recent=await get(s,'/api/document/recent');assert.equal(recent.status,'unavailable');assert.equal(recent.revision,null);
 const opened=await openTarget(s,c);assert.equal(opened.activated,true);assert.ok(opened.warnings.some(w=>w.code==='RECENT_NOT_UPDATED'));assert.equal((await get(s)).project.name,'Valid C');assert.deepEqual(await fs.readFile(s.recentPath),bad);
});

test('after switching, old document headers reject same-revision edits, batches, imports, renders and backups',async t=>{
 const s=await fixture(t),old=await get(s),b=await target(s,{project:{...old.project,name:'Same revision B'}});await openTarget(s,b);const state=await get(s);assert.equal(state.project.revision,old.project.revision);
 const mutations=[['/api/command',{command:'project.rename',arguments:{name:'WRONG'},expectedRevision:0}],['/api/command',{command:'batch',arguments:{commands:[{command:'project.rename',arguments:{name:'WRONG'}}]},expectedRevision:0}],['/api/render',{expectedRevision:0,durationSeconds:.1}],['/api/backups/create',{expectedRevision:0}],['/api/backups/settings',{expectedRevision:0,expectedSettingsRevision:0,autoBackup:{enabled:false,intervalMinutes:3,maxCount:2}}]];
 for(const [route,input]of mutations){error(await post(s,route,input,{documentId:old.session.document.id}),409,'DOCUMENT_CONFLICT');error(await post(s,route,input,{omitHeader:true}),428,'EXPECTED_DOCUMENT_REQUIRED');}
 const response=await fetch(s.url+'/api/import/wav?expectedRevision=0',{method:'POST',headers:{'Content-Type':'audio/wav','X-Newdaw-Document':old.session.document.id},body:wav()});error({status:response.status,body:await response.json()},409,'DOCUMENT_CONFLICT');
 assert.deepEqual((await get(s)).project,state.project);assert.equal((await get(s,'/api/backups')).files.length,0);assert.equal((await get(s,'/api/log')).entries.length,0);
 ok(await documentPost(s,'/api/document/save',{}, {omitHeader:true}));await command(s,'project.rename',{name:'Correct B'});assert.equal((await get(s)).project.name,'Correct B');
});

test('slow request bodies captured before Open cannot mutate the newly active same-revision document',async t=>{
 const scenarios=[['/api/command',Buffer.from(JSON.stringify({command:'project.rename',arguments:{name:'WRONG'},expectedRevision:0})),'application/json'],['/api/command',Buffer.from(JSON.stringify({command:'batch',arguments:{commands:[{command:'track.add',arguments:{type:'midi'}}]},expectedRevision:0})),'application/json'],['/api/import/wav?expectedRevision=0',wav(),'audio/wav'],['/api/render',Buffer.from(JSON.stringify({expectedRevision:0,durationSeconds:.1})),'application/json'],['/api/backups/create',Buffer.from(JSON.stringify({expectedRevision:0})),'application/json'],['/api/backups/settings',Buffer.from(JSON.stringify({expectedRevision:0,expectedSettingsRevision:0,autoBackup:{enabled:false,intervalMinutes:3,maxCount:2}})),'application/json']];
 for(const [route,bytes,mime]of scenarios){const s=await fixture(t),before=await get(s),b=await target(s,{project:{...before.project,name:'Unchanged B'}}),pending=await slowPost(s,route,bytes,{documentId:before.session.document.id,mime,omitHeader:route==='/api/command'});t.after(pending.abort);
  await openTarget(s,b);pending.finish();error(await pending.response,409,'DOCUMENT_CONFLICT');assert.equal((await get(s)).project.name,'Unchanged B');assert.equal((await get(s)).project.revision,0);assert.equal((await get(s,'/api/backups')).files.length,0);assert.equal((await get(s)).project.assets.length,0);
 }
});

test('requests already queued behind a file transition recheck document identity before executing',async t=>{
 const s=await fixture(t),b=await target(s),before=await get(s),plan=await openPlan(s,b),originalOpen=fs.open;let unlock,arrived;const gate=new Promise(resolve=>{unlock=resolve;}),entered=new Promise(resolve=>{arrived=resolve;});
 const mocked=t.mock.method(fs,'open',async(...args)=>{if(args[0]===`${b}.lock`&&args[1]==='wx'){arrived();await gate;}return originalOpen(...args);});
 const opening=applyOpen(s,plan);await entered;const token=randomUUID();let observed;const received=new Promise(resolve=>{observed=resolve;});const listener=req=>{if(req.headers['x-test-queued-open']===token){s.server.off('request',listener);observed();}};s.server.on('request',listener);
 const queued=post(s,'/api/command',{command:'batch',arguments:{commands:[{command:'project.rename',arguments:{name:'WRONG queued edit'}}]},expectedRevision:0},{documentId:before.session.document.id,headers:{'X-Test-Queued-Open':token}});
 try{await received;unlock();ok(await opening);error(await queued,409,'DOCUMENT_CONFLICT');assert.equal((await get(s)).project.name,'Project B');assert.equal((await get(s)).project.revision,0);}finally{unlock();mocked.mock.restore();}
});

test('Open strict options, stale document identity and unknown plans are rejected without changing files',async t=>{
 const s=await fixture(t),b=await target(s),before=await get(s),disk=await files(s.directory);
 error(await documentPost(s,'/api/document/open/plan',{}),422,'OPEN_TARGET_REQUIRED');error(await documentPost(s,'/api/document/open/plan',{projectPath:b,recentId:randomUUID()}),422,'OPEN_TARGET_REQUIRED');
 error(await documentPost(s,'/api/document/open/plan',{projectPath:b,extra:true}),422,'INVALID_DOCUMENT_OPTIONS');error(await documentPost(s,'/api/document/open/plan',{recentId:randomUUID()}),404,'RECENT_ENTRY_NOT_FOUND');
 error(await documentPost(s,'/api/document/open/plan',{projectPath:b,expectedDocumentId:'stale'}),409,'REVISION_CONFLICT');error(await documentPost(s,'/api/document/open',{planId:randomUUID(),currentPolicy:'preserve'}),404,'OPEN_PLAN_NOT_FOUND');
 const plan=await openPlan(s,b);error(await applyOpen(s,plan,{dryRun:'true'}),422,'INVALID_DOCUMENT_OPTIONS');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await files(s.directory),disk);
});

test('real CLI Recent, path and recent plans, Open choices and registry removal use the shared document session',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'CLI departure saved'});const plan=await cli(s,'open-plan',b);assert.equal(plan.target.projectPath,b);
 const dry=await cli(s,'open',plan.id,'--current','save','--dry-run');assert.equal(dry.applied,false);assert.equal((await get(s)).session.document.projectPath,s.initialPath);
 const opened=await cli(s,'open',plan.id,'--current','save');assert.equal(opened.activated,true);assert.equal((await get(s)).session.document.projectPath,b);
 await cli(s,'command','project.rename',JSON.stringify({name:'CLI B'}));const recent=await cli(s,'recent'),a=recent.entries.find(e=>e.projectPath===s.initialPath);const back=await cli(s,'open-recent-plan',a.id);await cli(s,'open',back.id,'--current','preserve');assert.equal((await get(s)).project.name,'CLI departure saved');assert.equal((await get(s)).session.document.dirty,false);
 const bEntry=(await cli(s,'recent')).entries.find(e=>e.projectPath===b);await cli(s,'recent-remove',bEntry.id,'--dry-run');assert.equal((await cli(s,'recent')).entries.length,2);await cli(s,'recent-remove',bEntry.id);assert.equal((await cli(s,'recent')).entries.length,1);
 await assert.rejects(cli(s,'recent-clear'),/confirm/);await cli(s,'recent-clear','--confirm');assert.equal((await cli(s,'recent')).entries.length,0);assert.equal(JSON.parse(await fs.readFile(b)).name,'CLI B');
});


test('failed departing Save preserves the active project and releases the prepared target lock',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Do not lose A'});const plan=await openPlan(s,b),before=await get(s),savedPath=`${s.initialPath}.saved.json`,savedBytes=await fs.readFile(savedPath),aBytes=await fs.readFile(s.initialPath),bBytes=await fs.readFile(b),originalRename=fs.rename;
 const mocked=t.mock.method(fs,'rename',async(...args)=>{if(args[1]===savedPath)throw Object.assign(new Error('Injected checkpoint publication failure'),{code:'EIO'});return originalRename(...args);});let result;
 try{result=await applyOpen(s,plan,{currentPolicy:'save'});}finally{mocked.mock.restore();}
 assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);assert.equal(result.body.errors[0].details.activated,false);assert.equal(result.body.errors[0].details.currentSaved,false);assert.equal(result.body.errors[0].details.targetPrepared,true);
 const after=await get(s);assert.equal(after.session.document.id,before.session.document.id);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(savedPath),savedBytes);assert.deepEqual(await fs.readFile(s.initialPath),aBytes);assert.deepEqual(await fs.readFile(b),bBytes);assert.ok((await fs.stat(`${s.initialPath}.lock`)).isFile());await absent(`${b}.lock`);
 await openTarget(s,b);assert.equal((await get(s)).session.document.projectPath,b);
});

test('newly adopted document snapshots advance sequence before asynchronous old-lock finalization',async t=>{
 const s=await fixture(t),b=await target(s);await command(s,'project.rename',{name:'Old A snapshot'});const before=await get(s),plan=await openPlan(s,b),originalRm=fs.rm;let unlock,arrived;const gate=new Promise(resolve=>{unlock=resolve;}),entered=new Promise(resolve=>{arrived=resolve;});
 const mocked=t.mock.method(fs,'rm',async(...args)=>{if(args[0]===`${s.initialPath}.lock`){arrived();await gate;}return originalRm(...args);});
 const opening=applyOpen(s,plan);await entered;
 try{const during=await get(s);assert.equal(during.session.document.projectPath,b);assert.equal(during.project.name,'Project B');assert.equal(during.project.revision,0);assert.notEqual(during.session.document.id,before.session.document.id);assert.ok(during.sequence>before.sequence,JSON.stringify({old:before.sequence,new:during.sequence}));assert.equal(during.session.id,before.session.id);
  const saved=JSON.parse(await fs.readFile(`${b}.saved.json`));assert.equal(during.session.document.saveId,saved.saveId);assert.equal(during.session.document.dirty,false);assert.deepEqual(during.project,saved.project);unlock();ok(await opening);assert.ok((await get(s)).sequence>=during.sequence);
 }finally{unlock();mocked.mock.restore();}
});
