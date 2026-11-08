import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createProject} from '../src/core/engine.mjs';
import {startServer} from '../src/server.mjs';
import {saveProject} from '../src/storage.mjs';
import {canonicalProjectHash} from '../src/session-store.mjs';
import {encodeWav,decodeWav} from '../src/media/wav.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wav=(frequency=220)=>Buffer.from(encodeWav({sampleRate:8000,channels:[Float32Array.from({length:800},(_,i)=>.2*Math.sin(2*Math.PI*frequency*i/8000))]}));
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-document-http-'));
 let activePath=path.join(directory,'Session.newdaw.json'),server;
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});
 await fs.writeFile(activePath,JSON.stringify(createProject({name:'Saved A',sampleRate:8000}),null,2)+'\n');
 server=await startServer({projectPath:activePath,port:0,demo:false,quiet:true,...options});
 const close=async()=>{try{activePath=(await get(s,'/api/document')).projectPath;}catch{}await server.close();};
 const s={directory,get projectPath(){return activePath;},get url(){return server.url;},close,
  async reopen(extra={}){await close();server=await startServer({projectPath:activePath,port:0,demo:false,quiet:true,...extra});}};
 return s;
}
async function get(s,route='/api/state'){const response=await fetch(s.url+route);assert.equal(response.status,200,await response.clone().text());return response.json();}
async function post(s,route,input){const response=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};}
function ok(result,status=200){assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
function error(result,status,code){assert.equal(result.status,status,JSON.stringify(result.body));assert.equal(result.body.applied,false);assert.equal(result.body.errors[0].code,code,JSON.stringify(result.body));return result.body.errors[0];}
const guard=state=>({expectedRevision:state.project.revision,expectedDocumentId:state.session.document.id});
async function documentPost(s,route,input={}){return post(s,route,{...guard(await get(s)),...input});}
async function command(s,name,args={},extra={}){const state=await get(s);return ok(await post(s,'/api/command',{command:name,arguments:args,expectedRevision:state.project.revision,...extra}));}
const save=async(s,input={})=>ok(await documentPost(s,'/api/document/save',input));
const plan=async s=>ok(await documentPost(s,'/api/document/revert/plan'));
const revert=async(s,p,input={})=>documentPost(s,'/api/document/revert',{planId:p.id,confirm:true,mediaPolicy:'keep',...input});
async function cli(s,...args){return JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:15000})).stdout);}
async function absent(filename){await assert.rejects(fs.lstat(filename),{code:'ENOENT'});}
const content=project=>({...project,revision:0});
async function importWav(s,frequency=220,name='Imported.wav'){
 const bytes=wav(frequency),source=path.join(s.directory,`external-${frequency}.wav`);await fs.writeFile(source,bytes);
 const before=await get(s),response=await fetch(s.url+`/api/import/wav?name=${encodeURIComponent(name)}&expectedRevision=${before.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:bytes});
 assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 const asset=result.project.assets.find(a=>a.sha256===hash(bytes));assert.ok(asset);
 const filename=path.join(path.dirname((await get(s,'/api/document')).projectPath),asset.path);
 return {bytes,source,asset,filename,result};
}

test('explicit Save is distinct from durable working edits and automatic backup generations',async t=>{
 const s=await fixture(t),initial=await get(s),doc=await get(s,'/api/document');
 assert.deepEqual(initial.session.document,doc);assert.equal(doc.available,true);assert.equal(doc.dirty,false);assert.equal(doc.origin,'opened-project');
 const originalSaved=await fs.readFile(`${doc.projectPath}.saved.json`);
 await command(s,'project.rename',{name:'Unsaved B'});let state=await get(s);
 assert.equal(state.session.document.dirty,true);assert.equal(state.session.document.saveId,doc.saveId);
 assert.equal(JSON.parse(await fs.readFile(doc.projectPath,'utf8')).name,'Unsaved B');assert.deepEqual(await fs.readFile(`${doc.projectPath}.saved.json`),originalSaved);
 const backup=ok(await post(s,'/api/backups/create',{expectedRevision:state.project.revision}));assert.equal(backup.status,'created');
 state=await get(s);assert.equal(state.session.document.dirty,true);assert.equal(state.session.document.saveId,doc.saveId);
 const working=await fs.readFile(doc.projectPath),history=state.historyView;
 const result=await save(s);assert.equal(result.projectChanged,false);assert.equal(result.document.origin,'explicit');assert.equal(result.document.dirty,false);assert.notEqual(result.document.saveId,doc.saveId);
 const after=await get(s);assert.equal(after.project.revision,state.project.revision);assert.deepEqual(after.historyView,history);assert.deepEqual(await fs.readFile(doc.projectPath),working);
 assert.equal(JSON.parse(await fs.readFile(`${doc.projectPath}.saved.json`,'utf8')).project.name,'Unsaved B');
});

test('Save dry-run leaves the baseline untouched and explicit checkpoint persists across reopen',async t=>{
 const s=await fixture(t);await command(s,'project.rename',{name:'Saved B'});await save(s);
 const baseline=(await get(s)).session.document,bytes=await fs.readFile(`${s.projectPath}.saved.json`);
 await command(s,'project.rename',{name:'Working C'});const before=await get(s);
 assert.equal((await save(s,{dryRun:true})).status,'validated');assert.deepEqual(await fs.readFile(`${s.projectPath}.saved.json`),bytes);
 assert.deepEqual((await get(s)).project,before.project);await s.reopen();const after=await get(s);
 assert.equal(after.project.name,'Working C');assert.equal(after.session.document.saveId,baseline.saveId);assert.equal(after.session.document.dirty,true);
 assert.notEqual(after.session.document.id,before.session.document.id);
 const p=await plan(s);assert.equal(p.saveId,baseline.saveId);ok(await revert(s,p));assert.equal((await get(s)).project.name,'Saved B');
});

test('dirty compares musical content rather than revision-only history settings or an undo round trip',async t=>{
 const s=await fixture(t);await save(s);const before=await get(s);
 await command(s,'history.settings',{maxSteps:7});let state=await get(s);assert.ok(state.project.revision>before.project.revision);assert.equal(state.session.document.dirty,false);
 await command(s,'project.rename',{name:'Temporary B'});assert.equal((await get(s)).session.document.dirty,true);
 await command(s,'history.undo');state=await get(s);assert.equal(state.project.name,'Saved A');assert.equal(state.session.document.dirty,false);assert.ok(state.project.revision>before.project.revision);
});

test('Save New Version activates its new file, transfers the lock, keeps history and publishes identity over SSE',async t=>{
 const s=await fixture(t);await command(s,'project.rename',{name:'Version content'});const before=await get(s),oldPath=before.session.document.projectPath,oldBytes=await fs.readFile(oldPath);
 const stream=await fetch(s.url+'/api/events'),reader=stream.body.getReader();t.after(()=>reader.cancel().catch(()=>{}));await reader.read();
 const dry=ok(await documentPost(s,'/api/document/save-as',{mode:'version',dryRun:true}));assert.equal(dry.applied,false);await absent(path.join(s.directory,'Session-01.newdaw.json'));
 const result=ok(await documentPost(s,'/api/document/save-as',{mode:'version'}));assert.equal(result.activated,true);
 const current=await get(s),newPath=current.session.document.projectPath;
 assert.equal(path.basename(newPath),'Session-01.newdaw.json');assert.notEqual(current.session.document.id,before.session.document.id);assert.equal(current.project.id,before.project.id);assert.equal(current.project.revision,before.project.revision+1);
 assert.deepEqual(current.historyView.entries,before.historyView.entries);assert.equal(current.history.canUndo,true);assert.equal(current.session.document.dirty,false);
 assert.deepEqual(await fs.readFile(oldPath),oldBytes);await absent(`${oldPath}.lock`);assert.ok((await fs.stat(`${newPath}.lock`)).isFile());
 const event=new TextDecoder().decode((await reader.read()).value);assert.ok(event.includes(current.session.document.id),event);await reader.cancel();
 await assert.rejects(startServer({projectPath:newPath,port:0,quiet:true}),/already open/);
 await command(s,'project.rename',{name:'Only the new document'});assert.deepEqual(await fs.readFile(oldPath),oldBytes);assert.equal(JSON.parse(await fs.readFile(newPath,'utf8')).name,'Only the new document');
 await s.reopen();const reopened=await get(s);assert.equal(reopened.session.document.projectPath,newPath);assert.equal(reopened.project.name,'Only the new document');assert.equal(reopened.history.canUndo,true);assert.equal(reopened.session.document.dirty,true);
});

test('version numbering skips occupied project and sidecar names without overwriting previous files',async t=>{
 const s=await fixture(t),one=path.join(s.directory,'Session-01.newdaw.json'),two=path.join(s.directory,'Session-02.newdaw.json.saved.json');
 await fs.writeFile(one,'other project bytes');await fs.writeFile(two,'other saved checkpoint');
 const first=ok(await documentPost(s,'/api/document/save-as',{mode:'version'}));assert.equal(first.document.fileName,'Session-03.newdaw.json');
 const second=ok(await documentPost(s,'/api/document/save-as',{mode:'version'}));assert.equal(second.document.fileName,'Session-04.newdaw.json');
 assert.equal(await fs.readFile(one,'utf8'),'other project bytes');assert.equal(await fs.readFile(two,'utf8'),'other saved checkpoint');
 const current=await get(s),collision=await documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath:one});error(collision,409,'OUTPUT_EXISTS');assert.deepEqual((await get(s)).project,current.project);assert.deepEqual((await get(s)).session.document,current.session.document);
});

test('Save As into another folder collects verified WAV bytes and subsequent editing and rendering use the new directory',async t=>{
 const s=await fixture(t),media=await importWav(s);await save(s);const before=await get(s),oldPath=before.session.document.projectPath,oldBytes=await fs.readFile(oldPath);
 const directory=path.join(s.directory,'Elsewhere');await fs.mkdir(directory);const outputPath=path.join(directory,'Other.newdaw.json');
 ok(await documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath}));let state=await get(s);
 assert.equal(state.session.document.projectPath,outputPath);assert.deepEqual(await fs.readFile(path.join(directory,media.asset.path)),media.bytes);assert.deepEqual(await fs.readFile(media.source),media.bytes);
 assert.deepEqual(await fs.readFile(oldPath),oldBytes);await absent(`${oldPath}.lock`);
 await command(s,'project.rename',{name:'New folder working edit'});state=await get(s);assert.deepEqual(await fs.readFile(oldPath),oldBytes);assert.equal(JSON.parse(await fs.readFile(outputPath,'utf8')).name,'New folder working edit');
 const output=path.join(directory,'render.wav');const rendered=await cli(s,'offline-render',outputPath,output,'--duration','.1');assert.equal(rendered.status,'completed');
 const audio=decodeWav(new Uint8Array(await fs.readFile(output)));assert.ok(audio.channels[0].some(x=>Math.abs(x)>.01));
 ok(await post(s,'/api/backups/create',{expectedRevision:state.project.revision}));const backups=await get(s,'/api/backups');assert.equal(backups.files.length,1);assert.equal((await get(s)).session.document.dirty,true);
 await s.reopen();assert.equal((await get(s)).session.document.projectPath,outputPath);assert.equal((await get(s,'/api/assets')).assets[0].status,'ready');
});

test('document mutations require current project and document identity and reject invalid options atomically',async t=>{
 const s=await fixture(t),before=await get(s),base=guard(before);
 for(const route of ['/api/document/save','/api/document/save-as','/api/document/revert/plan']){
  const args=route.endsWith('save-as')?{mode:'version'}:{};
  error(await post(s,route,{...base,...args,expectedRevision:-1}),422,'EXPECTED_DOCUMENT_REQUIRED');
  error(await post(s,route,{...base,...args,expectedDocumentId:'other-session'}),409,'REVISION_CONFLICT');
 }
 error(await documentPost(s,'/api/document/save',{dryRun:'yes'}),422,'INVALID_DOCUMENT_OPTIONS');
 error(await documentPost(s,'/api/document/save-as',{mode:'saveAs'}),422,'OUTPUT_REQUIRED');
 error(await documentPost(s,'/api/document/save-as',{mode:'other'}),422,'INVALID_SAVE_MODE');
 error(await documentPost(s,'/api/document/save',{extra:true}),422,'INVALID_DOCUMENT_OPTIONS');
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).session.document,before.session.document);
 await command(s,'project.rename',{name:'Later edit'});error(await post(s,'/api/document/save',base),409,'REVISION_CONFLICT');
});

test('corrupt saved checkpoint remains unavailable and preserved until the user explicitly saves a new baseline',async t=>{
 const s=await fixture(t);await save(s);await s.close();const savedPath=`${s.projectPath}.saved.json`,bad=Buffer.from('{bad saved checkpoint');await fs.writeFile(savedPath,bad);
 await s.reopen();const state=await get(s);assert.equal(state.session.document.available,false);assert.equal(state.session.document.dirty,null);assert.equal(state.session.document.saveId,null);assert.ok(state.session.document.persistence.warnings.length);
 error(await documentPost(s,'/api/document/revert/plan'),422,'NO_SAVED_CHECKPOINT');assert.deepEqual(await fs.readFile(savedPath),bad);
 await save(s);assert.equal((await get(s)).session.document.available,true);assert.equal((await get(s)).session.document.dirty,false);
 const preserved=(await fs.readdir(path.dirname(savedPath))).filter(n=>n.startsWith(path.basename(savedPath)+'.quarantine-'));assert.equal(preserved.length,1);assert.deepEqual(await fs.readFile(path.join(s.directory,preserved[0])),bad);
});

test('Revert requires warning confirmation and an explicit media choice; dry-run preserves edits and history',async t=>{
 const s=await fixture(t);await save(s);await command(s,'project.rename',{name:'Working B'});const p=await plan(s),before=await get(s),disk=await fs.readFile(s.projectPath);
 error(await revert(s,p,{confirm:false}),409,'REVERT_CONFIRMATION_REQUIRED');
 error(await revert(s,p,{mediaPolicy:undefined}),422,'MEDIA_POLICY_REQUIRED');
 error(await revert(s,p,{mediaPolicy:'delete'}),422,'MEDIA_POLICY_REQUIRED');
 const dry=ok(await revert(s,p,{dryRun:true}));assert.equal(dry.status,'validated');assert.equal(dry.applied,false);assert.equal(p.historyWillReset,true);
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);
});

test('Revert restores the explicit baseline with a new revision, resets undo but preserves maximum steps and survives reopening',async t=>{
 const s=await fixture(t);await command(s,'history.settings',{maxSteps:7});await save(s);const saved=await get(s);
 await command(s,'track.add',{id:'new-track',type:'midi',name:'Discarded'});await command(s,'project.rename',{name:'Working B'});const before=await get(s);
 const result=ok(await revert(s,await plan(s)));assert.equal(result.projectCommitted,true);assert.equal(result.historyReset,true);
 const after=await get(s);assert.deepEqual(content(after.project),content(saved.project));assert.equal(after.project.revision,before.project.revision+1);assert.equal(after.history.canUndo,false);assert.equal(after.history.canRedo,false);assert.equal(after.historyView.entries.length,0);assert.equal(after.historyView.maxSteps,7);assert.equal(after.session.document.dirty,false);
 await s.reopen();const reopened=await get(s);assert.deepEqual(reopened.project,after.project);assert.equal(reopened.historyView.maxSteps,7);assert.equal(reopened.history.canUndo,false);assert.equal(reopened.session.document.dirty,false);
});

test('a new Save invalidates a preview even when no musical revision changes',async t=>{
 const s=await fixture(t);await command(s,'project.rename',{name:'Working B'});const p=await plan(s),before=await get(s);await save(s);
 const after=await get(s);assert.equal(after.project.revision,before.project.revision);assert.notEqual(after.session.document.saveId,p.saveId);
 error(await revert(s,p),404,'REVERT_PLAN_NOT_FOUND');assert.equal((await get(s)).project.name,'Working B');
});

test('failed Revert project commit preserves current project, baseline, history and newly owned media',async t=>{
 let failing=false;const s=await fixture(t,{persistProject:async(filename,project)=>{if(failing)throw Error('injected Revert commit failure');await saveProject(filename,project);}});
 await save(s);const media=await importWav(s,391);const p=await plan(s),before=await get(s),disk=await fs.readFile(s.projectPath),baseline=await fs.readFile(`${s.projectPath}.saved.json`);failing=true;
 error(await revert(s,p,{mediaPolicy:'trash'}),500,'SAVE_FAILED');const after=await get(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual(await fs.readFile(`${s.projectPath}.saved.json`),baseline);assert.deepEqual(await fs.readFile(media.filename),media.bytes);assert.deepEqual(await fs.readFile(media.source),media.bytes);
 await s.reopen();assert.deepEqual((await get(s)).project,before.project);assert.equal((await get(s)).session.document.dirty,true);
});

test('Revert Keep restores the saved project while preserving new physical media and its external source',async t=>{
 const s=await fixture(t);await save(s);const saved=await get(s),media=await importWav(s,433),p=await plan(s);
 assert.equal(p.media.totals.files,1);assert.equal(p.media.candidates[0].path,media.asset.path);
 const result=ok(await revert(s,p,{mediaPolicy:'keep'}));assert.equal(result.media.policy,'keep');assert.equal(result.media.kept.length,1);assert.equal(result.media.moved.length,0);
 assert.deepEqual(content((await get(s)).project),content(saved.project));assert.deepEqual(await fs.readFile(media.filename),media.bytes);assert.deepEqual(await fs.readFile(media.source),media.bytes);
 assert.equal((await get(s,'/api/document/trash')).operations.length,0);
});

test('Revert trash includes owned media removed from the Pool and restore is durable without clobbering occupied paths',async t=>{
 const s=await fixture(t);await save(s);const baseline=await get(s),a=await importWav(s,457),b=await importWav(s,503);
 await command(s,'history.undo');assert.equal((await get(s)).project.assets.length,1);await fs.access(b.filename);
 const p=await plan(s);assert.equal(p.media.totals.files,2);assert.deepEqual(p.media.candidates.find(c=>c.path===b.asset.path).currentAssetIds,[]);
 assert.ok(p.media.warnings.some(w=>w.code==='HISTORICAL_MEDIA_MAY_BE_TRASHED'));
 const dry=ok(await revert(s,p,{mediaPolicy:'trash',dryRun:true}));assert.equal(dry.media.status,'validated');assert.equal(dry.media.kept.length,2);assert.deepEqual(await fs.readFile(a.filename),a.bytes);assert.deepEqual(await fs.readFile(b.filename),b.bytes);
 const reverted=ok(await revert(s,p,{mediaPolicy:'trash'}));assert.equal(reverted.media.status,'trashed');assert.equal(reverted.media.moved.length,2);assert.ok(reverted.media.operationId);
 await absent(a.filename);await absent(b.filename);assert.deepEqual(await fs.readFile(a.source),a.bytes);assert.deepEqual(await fs.readFile(b.source),b.bytes);
 assert.deepEqual(content((await get(s)).project),content(baseline.project));
 await s.reopen();let trash=await get(s,'/api/document/trash');assert.equal(trash.operations.length,1);assert.equal(trash.operations[0].operationId,reverted.media.operationId);assert.ok(trash.operations[0].files.every(f=>f.state==='available'));
 const route=`/api/document/trash/${reverted.media.operationId}/restore`,before=await get(s);
 const restoreDry=ok(await documentPost(s,route,{dryRun:true}));assert.equal(restoreDry.restored.length,2);await absent(a.filename);await absent(b.filename);
 await fs.writeFile(a.filename,'user-created obstruction');
 const restored=ok(await documentPost(s,route));assert.equal(restored.restored.length,1);assert.ok(restored.skipped.some(x=>x.reason==='destination-exists'));assert.equal(await fs.readFile(a.filename,'utf8'),'user-created obstruction');assert.deepEqual(await fs.readFile(b.filename),b.bytes);
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);
 await fs.unlink(a.filename);const retried=ok(await documentPost(s,route));assert.equal(retried.restored.length,1);assert.deepEqual(await fs.readFile(a.filename),a.bytes);
 trash=await get(s,'/api/document/trash');assert.ok(trash.operations[0].files.every(f=>f.state==='active'));
 const again=ok(await documentPost(s,route));assert.equal(again.applied,false);assert.equal(again.restored.length,0);assert.equal(again.skipped.length,2);
});

test('saved ownership and sibling project references protect media while later unshared copies can be trashed',async t=>{
 const s=await fixture(t),savedMedia=await importWav(s,541);await save(s);const saved=await get(s);
 const shared=await importWav(s,577),sibling=path.join(s.directory,'Sibling-version.newdaw.json');
 const sharedBytes=Buffer.from(JSON.stringify((await get(s)).project,null,2)+'\n');await fs.writeFile(sibling,sharedBytes);
 const disposable=await importWav(s,613),p=await plan(s);
 assert.deepEqual(p.media.candidates.map(x=>x.path),[disposable.asset.path]);
 assert.equal(p.media.protected.find(x=>x.path===savedMedia.asset.path).reason,'saved-ownership');assert.equal(p.media.protected.find(x=>x.path===shared.asset.path).reason,'shared-project');
 const result=ok(await revert(s,p,{mediaPolicy:'trash'}));assert.equal(result.media.moved.length,1);await absent(disposable.filename);
 assert.deepEqual(await fs.readFile(savedMedia.filename),savedMedia.bytes);assert.deepEqual(await fs.readFile(shared.filename),shared.bytes);assert.deepEqual(await fs.readFile(sibling),sharedBytes);
 assert.deepEqual(content((await get(s)).project),content(saved.project));assert.equal((await get(s,'/api/assets')).assets[0].status,'ready');
});

test('changed owned bytes after preview refuse trash before committing the Revert',async t=>{
 const s=await fixture(t);await save(s);const media=await importWav(s,647),p=await plan(s),before=await get(s),disk=await fs.readFile(s.projectPath);
 await fs.writeFile(media.filename,'changed externally');error(await revert(s,p,{mediaPolicy:'trash'}),422,'STALE_REVERT_MEDIA_PLAN');
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.equal(await fs.readFile(media.filename,'utf8'),'changed externally');assert.deepEqual(await fs.readFile(media.source),media.bytes);
 assert.equal((await get(s,'/api/document/trash')).operations.length,0);
});

test('a WAV published before a failed import commit remains owned and reviewable even without a Pool registration',async t=>{
 let failing=false;const s=await fixture(t,{persistProject:async(filename,project)=>{if(failing)throw Error('injected import persistence failure');await saveProject(filename,project);}});await save(s);
 const before=await get(s),bytes=wav(683),filename=path.join(s.directory,`assets/${hash(bytes)}.wav`);failing=true;
 const response=await fetch(s.url+`/api/import/wav?name=Orphan.wav&expectedRevision=${before.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:bytes});assert.equal(response.status,500);assert.equal((await response.json()).errors[0].code,'SAVE_FAILED');
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(filename),bytes);
 const p=await plan(s);assert.equal(p.media.totals.files,1);assert.deepEqual(p.media.candidates[0].currentAssetIds,[]);failing=false;
 const result=ok(await revert(s,p,{mediaPolicy:'trash'}));assert.equal(result.media.moved.length,1);await absent(filename);
});

test('real CLI Save, version activation, Save As, confirmed Revert and media recovery share the document contract',async t=>{
 const s=await fixture(t);await command(s,'project.rename',{name:'CLI baseline'});const before=await get(s);
 assert.deepEqual(await cli(s,'document'),before.session.document);assert.equal((await cli(s,'save','--dry-run')).status,'validated');assert.equal((await get(s)).session.document.dirty,true);
 assert.equal((await cli(s,'save')).document.dirty,false);const version=await cli(s,'save-new-version');assert.equal(version.document.fileName,'Session-01.newdaw.json');
 const directory=path.join(s.directory,'CLI-SaveAs');await fs.mkdir(directory);const output=path.join(directory,'CLI.newdaw.json');
 assert.equal((await cli(s,'save-as',output,'--dry-run')).applied,false);await absent(output);assert.equal((await cli(s,'save-as',output)).document.projectPath,output);
 const media=await importWav(s,719),p=await cli(s,'revert-plan');assert.equal(p.media.totals.files,1);
 await assert.rejects(cli(s,'revert',p.id,'--media','keep'),e=>e.stderr.includes('--confirm'));
 await assert.rejects(cli(s,'revert',p.id,'--confirm'),e=>e.stderr.includes('--media'));
 assert.equal((await cli(s,'revert',p.id,'--confirm','--media','trash','--dry-run')).applied,false);await fs.access(media.filename);
 const applied=await cli(s,'revert',p.id,'--confirm','--media','trash');assert.equal(applied.projectCommitted,true);await absent(media.filename);
 const trash=await cli(s,'revert-trash');assert.equal(trash.operations[0].operationId,applied.media.operationId);
 assert.equal((await cli(s,'restore-revert-media',applied.media.operationId,'--dry-run')).applied,false);await absent(media.filename);
 const restored=await cli(s,'restore-revert-media',applied.media.operationId);assert.equal(restored.restored.length,1);assert.deepEqual(await fs.readFile(media.filename),media.bytes);
 assert.equal((await cli(s,'document')).dirty,false);assert.equal((await get(s)).project.assets.length,0);assert.deepEqual(await fs.readFile(media.source),media.bytes);
});

test('live saved-checkpoint corruption and valid external replacement invalidate preview and apply without overwriting edits',async t=>{
 const s=await fixture(t);await save(s);await command(s,'project.rename',{name:'Working B'});
 const savedPath=`${s.projectPath}.saved.json`,original=await fs.readFile(savedPath),before=await get(s),disk=await fs.readFile(s.projectPath);
 await fs.writeFile(savedPath,'invalid checkpoint');error(await documentPost(s,'/api/document/revert/plan'),422,'NO_SAVED_CHECKPOINT');assert.equal((await get(s)).session.document.available,false);
 assert.equal(await fs.readFile(savedPath,'utf8'),'invalid checkpoint');assert.deepEqual((await get(s)).project,before.project);
 const changes=[
  point=>{point.saveId=randomUUID();},
  point=>{point.project.name='Externally substituted baseline';point.projectHash=canonicalProjectHash(point.project);},
  point=>{point.mediaOwnershipIds=[randomUUID()];},
 ];
 for(const change of changes){
  await fs.writeFile(savedPath,original);const p=await plan(s),point=JSON.parse(original.toString());change(point);await fs.writeFile(savedPath,JSON.stringify(point));
  error(await revert(s,p),409,'REVISION_CONFLICT');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);
 }
 await fs.writeFile(savedPath,original);const p=await plan(s);await fs.unlink(savedPath);error(await revert(s,p),409,'REVISION_CONFLICT');await absent(savedPath);assert.deepEqual((await get(s)).project,before.project);
});

test('Save As preflights every source so a changed later asset creates no earlier destination copy',async t=>{
 const s=await fixture(t),a=await importWav(s,751),b=await importWav(s,787);await save(s);
 const before=await get(s),oldPath=before.session.document.projectPath,oldBytes=await fs.readFile(oldPath);
 await fs.writeFile(b.filename,'changed source');const destination=path.join(s.directory,'Preflight');await fs.mkdir(destination);const outputPath=path.join(destination,'Copy.newdaw.json');
 const failed=error(await documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath}),422,'ASSET_CHANGED');assert.deepEqual(failed.details.retainedCopies,[]);
 assert.deepEqual(await fs.readdir(destination),[]);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).session.document,before.session.document);assert.deepEqual(await fs.readFile(oldPath),oldBytes);assert.deepEqual(await fs.readFile(a.filename),a.bytes);assert.equal(await fs.readFile(b.filename,'utf8'),'changed source');
 assert.ok((await fs.stat(`${oldPath}.lock`)).isFile());
});

test('Save As reports already copied media after a later destination conflict without publishing or activating the project',async t=>{
 const s=await fixture(t),a=await importWav(s,823),b=await importWav(s,859);await save(s);const before=await get(s),oldPath=before.session.document.projectPath,oldBytes=await fs.readFile(oldPath);
 const directory=path.join(s.directory,'PartialCopies');await fs.mkdir(path.join(directory,'assets'),{recursive:true});const outputPath=path.join(directory,'Copy.newdaw.json'),aCopy=path.join(directory,a.asset.path),bCopy=path.join(directory,b.asset.path);
 await fs.writeFile(bCopy,'existing different destination');
 const failure=error(await documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath}),422,'ASSET_CHANGED');
 assert.deepEqual(failure.details.retainedCopies,[aCopy]);assert.deepEqual(await fs.readFile(aCopy),a.bytes);assert.equal(await fs.readFile(bCopy,'utf8'),'existing different destination');
 for(const suffix of ['','.saved.json','.history.json','.lock','.save-prepare.lock'])await absent(outputPath+suffix);
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).session.document,before.session.document);assert.deepEqual(await fs.readFile(oldPath),oldBytes);
 assert.deepEqual(await fs.readFile(a.filename),a.bytes);assert.deepEqual(await fs.readFile(b.filename),b.bytes);assert.deepEqual(await fs.readFile(a.source),a.bytes);assert.deepEqual(await fs.readFile(b.source),b.bytes);
});

test('Save As dry-run validates destination conflicts and unsafe or missing parents without reserving or writing files',async t=>{
 const s=await fixture(t),before=await get(s),occupied=path.join(s.directory,'Existing.newdaw.json'),alias=path.join(s.directory,'Alias');
 await fs.writeFile(occupied,'existing target');await fs.symlink(s.directory,alias);
 const cases=[
  [occupied,'OUTPUT_EXISTS'],
  [path.join(s.directory,'Absent','New.newdaw.json'),'ENOENT'],
  [path.join(alias,'New.newdaw.json'),'UNSAFE_PATH'],
  [path.join(s.directory,'Bad\0.newdaw.json'),'INVALID_PROJECT_SAVE'],
 ];
 const files=(await fs.readdir(s.directory)).sort();
 for(const [outputPath,code] of cases){
  const response=await documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath,dryRun:true});assert.ok(response.status>=400,JSON.stringify(response.body));assert.equal(response.body.applied,false);assert.equal(response.body.errors[0].code,code);
 }
 const outputPath=path.join(s.directory,'Preview.newdaw.json');assert.equal(ok(await documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath,dryRun:true})).status,'validated');
 assert.deepEqual((await fs.readdir(s.directory)).sort(),files);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).session.document,before.session.document);assert.equal(await fs.readFile(occupied,'utf8'),'existing target');
});

test('queries during version activation observe either complete old or complete new document metadata',async t=>{
 const s=await fixture(t);await importWav(s,883);await importWav(s,929);const before=await get(s),snapshots=[];
 const directory=path.join(s.directory,'AtomicActivation');await fs.mkdir(directory);const outputPath=path.join(directory,'Activated.newdaw.json');
 let complete=false;const saving=documentPost(s,'/api/document/save-as',{mode:'saveAs',outputPath}).finally(()=>{complete=true;});
 try{while(!complete&&snapshots.length<100)snapshots.push(await get(s));}finally{ok(await saving);}
 const after=await get(s);snapshots.push(after);assert.ok(snapshots.length>=2);assert.equal(after.session.document.projectPath,outputPath);
 const identity=state=>({revision:state.project.revision,projectId:state.project.id,documentId:state.session.document.id,path:state.session.document.projectPath,fileName:state.session.document.fileName,saveId:state.session.document.saveId,dirty:state.session.document.dirty,available:state.session.document.available});
 const old=identity(before),current=identity(after);assert.notEqual(old.documentId,current.documentId);assert.notEqual(old.saveId,current.saveId);
 for(const snapshot of snapshots)assert.deepEqual(identity(snapshot),snapshot.project.revision===before.project.revision?old:current);
});
