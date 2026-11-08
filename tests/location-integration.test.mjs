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
import {encodeWav,decodeWav} from '../src/media/wav.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const wav=(frequency=220)=>Buffer.from(encodeWav({sampleRate:8000,channels:[Float32Array.from({length:800},(_,i)=>.2*Math.sin(2*Math.PI*frequency*i/8000))]}));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,options={}){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-location-http-'))),initialPath=path.join(directory,'A.newdaw.json'),recentPath=path.join(directory,'profile','recent.json');
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
async function absent(filename){await assert.rejects(fs.lstat(filename),{code:'ENOENT'});}
async function cli(s,...args){return JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:15000})).stdout);}
async function files(directory){const result={};async function visit(dir){for(const row of await fs.readdir(dir,{withFileTypes:true})){const filename=path.join(dir,row.name);if(row.isDirectory())await visit(filename);else if(row.isFile())result[path.relative(directory,filename)]=hash(await fs.readFile(filename));}}await visit(directory);return result;}
async function upload(s,bytes=wav(),name='Audio.wav'){
 const state=await get(s),response=await fetch(`${s.url}/api/import/wav?name=${encodeURIComponent(name)}&expectedRevision=${state.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/wav','X-Newdaw-Document':state.session.document.id},body:bytes});
 assert.equal(response.status,200,await response.clone().text());return response.json();
}
async function render(s){const before=await get(s),job=ok(await post(s,'/api/render',{expectedRevision:before.project.revision,durationSeconds:.1}),202);
 for(let i=0;i<200;i++){const current=await get(s,`/api/jobs/${job.id}`);if(current.status==='completed'){const response=await fetch(s.url+current.url);assert.equal(response.status,200);return decodeWav(new Uint8Array(await response.arrayBuffer()));}if(current.status==='failed')assert.fail(JSON.stringify(current.error));await pause(5);}assert.fail('render timed out');}

const workspace=s=>get(s,'/api/workspace');
const locations=s=>get(s,'/api/workspace/locations');
const locationFile=s=>`${s.recentPath}.locations.json`;
async function workspacePost(s,route,input={}){const w=await workspace(s);return post(s,'/api/workspace'+route,{expectedWorkspaceRevision:w.revision,...input});}
async function locationSettings(s,input={}){const current=await locations(s);return workspacePost(s,'/locations',{expectedRevision:current.settings?.revision,...input});}
async function locationPlan(s,location={},input={}){const current=await locations(s);return ok(await workspacePost(s,'/new/plan',{sampleRate:8000,mode:'active',expectedLocationRevision:current.settings?.revision,location,...input}));}
const applyNew=(s,plan,input={})=>workspacePost(s,'/new',{planId:plan.id,currentPolicy:'preserve',...input});
async function closeDocument(s,documentId){const plan=ok(await workspacePost(s,'/close/plan',{documentId}));return ok(await workspacePost(s,'/close',{planId:plan.id,currentPolicy:'preserve'}));}
async function activate(s,documentId){const plan=ok(await workspacePost(s,'/activate/plan',{documentId}));return ok(await workspacePost(s,'/activate',{planId:plan.id,currentPolicy:'preserve'}));}
async function directory(s,name){const p=path.join(s.directory,name);await fs.mkdir(p,{recursive:true});return p;}
async function readResponse(s,route){const response=await fetch(s.url+route);return {status:response.status,body:await response.json()};}
const folders=(s,p,cursor)=>get(s,'/api/workspace/folders'+(p!==undefined?'?path='+encodeURIComponent(p)+(cursor!==undefined?'&cursor='+cursor:''):cursor!==undefined?'?cursor='+cursor:''));

test('location preferences and folder listing start read-only without fabricating a saved profile or changing a document',async t=>{
 const s=await fixture(t),before=await get(s),disk=await files(s.directory),settings=await locations(s);
 assert.deepEqual(settings.settings,{schemaVersion:1,revision:0,defaultLocation:null,locationMode:'prompt'});assert.deepEqual((await get(s)).workspace.locationSettings,settings);
 const listing=await folders(s);assert.equal(listing.path,s.directory);assert.equal(listing.readOnly,true);assert.equal(listing.parentPath,path.dirname(s.directory));assert.deepEqual(await files(s.directory),disk);await absent(locationFile(s));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);
});

test('default-location settings dry run, explicit save, reload and restart preserve project revision, bytes and history',async t=>{
 const s=await fixture(t);await command(s,'project.rename',{name:'Working music stays'});const base=await directory(s,'Default Base'),before=await get(s),disk=await files(s.directory);
 assert.equal(ok(await locationSettings(s,{defaultLocation:base,locationMode:'default',dryRun:true})).applied,false);assert.deepEqual(await files(s.directory),disk);assert.equal((await locations(s)).settings.revision,0);
 ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const after=await get(s),prefs=await locations(s);assert.equal(prefs.settings.revision,1);assert.equal(prefs.settings.defaultLocation,base);assert.equal(prefs.settings.locationMode,'default');assert.deepEqual(after.workspace.locationSettings,prefs);assert.equal(after.workspace.revision,before.workspace.revision);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.equal(after.session.document.id,before.session.document.id);assert.equal(after.session.document.saveId,before.session.document.saveId);
 const projectBytes=await fs.readFile(s.initialPath);await s.reopen();assert.deepEqual(await locations(s),prefs);assert.deepEqual(await fs.readFile(s.initialPath),projectBytes);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);
});

test('default creation combines the base and project-folder name while blank names use a folder literally named Untitled',async t=>{
 const s=await fixture(t),base=await directory(s,'Default');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));
 let plan=await locationPlan(s,{folderName:'Song One'});assert.equal(plan.target.projectFolder,path.join(base,'Song One'));await absent(path.join(base,'Song One'));ok(await applyNew(s,plan));const first=await get(s);assert.equal(first.session.document.projectFolder,path.join(base,'Song One'));assert.equal(first.session.document.neverSaved,true);assert.match(first.project.name,/^Untitled\d+$/);assert.equal(first.session.document.projectPath,null);
 plan=await locationPlan(s,{folderName:''},{mode:'inactive'});assert.equal(plan.target.projectFolder,path.join(base,'Untitled'));ok(await applyNew(s,plan));const second=(await workspace(s)).documents.find(d=>d.projectFolder===path.join(base,'Untitled'));assert.ok(second);assert.notEqual(second.projectId,first.project.id);assert.equal(second.neverSaved,true);assert.equal((await get(s)).session.document.id,first.session.document.id);assert.equal((await locations(s)).settings.defaultLocation,base);
});

test('a default path change affects later creations without moving existing open project folders or files',async t=>{
 const s=await fixture(t),a=await directory(s,'A Base'),b=await directory(s,'B Base');ok(await locationSettings(s,{defaultLocation:a,locationMode:'default'}));ok(await applyNew(s,await locationPlan(s,{folderName:'Original'})));await command(s,'project.rename',{name:'Keep in A'});const first=await get(s),aFiles=await files(a),aId=first.workspace.activeId;
 ok(await locationSettings(s,{defaultLocation:b}));const next=await locationPlan(s,{folderName:'New'});assert.equal(next.target.projectFolder,path.join(b,'New'));ok(await applyNew(s,next));assert.deepEqual(await files(a),aFiles);assert.ok((await workspace(s)).documents.some(d=>d.id===aId&&d.projectFolder===path.join(a,'Original')));await activate(s,aId);assert.deepEqual((await get(s)).project,first.project);assert.equal((await locations(s)).settings.defaultLocation,b);
});

test('prompt creation uses the chosen final folder and does not append or overwrite the default location',async t=>{
 const s=await fixture(t),base=await directory(s,'Saved Default'),chosen=await directory(s,'Chosen Final');ok(await locationSettings(s,{defaultLocation:base,locationMode:'prompt'}));const settingsBefore=await locations(s),plan=await locationPlan(s,{chosenFolder:chosen,folderName:'Unused Default Name'});assert.equal(plan.target.projectFolder,chosen);ok(await applyNew(s,plan));assert.equal((await get(s)).session.document.projectFolder,chosen);assert.deepEqual(await locations(s),settingsBefore);await absent(path.join(chosen,'Untitled'));
 const noChoice=await workspacePost(s,'/new/plan',{mode:'active',location:{},expectedLocationRevision:settingsBefore.settings.revision});error(noChoice,422,'PROJECT_LOCATION_REQUIRED');
});

test('location inspection, generation dry run and Cancel do not create folders or consume Untitled numbers',async t=>{
 const s=await fixture(t),base=await directory(s,'Review Base');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const before=await get(s),disk=await files(s.directory),target=path.join(base,'Not Created');const plan=await locationPlan(s,{folderName:'Not Created'});const browser=await folders(s,base);assert.equal(browser.path,base);assert.equal(browser.readOnly,true);assert.equal(ok(await applyNew(s,plan,{dryRun:true})).applied,false);
 await absent(target);await absent(`${s.recentPath}.drafts.json`);assert.deepEqual(await files(s.directory),disk);assert.deepEqual((await get(s)).project,before.project);assert.equal((await get(s)).session.document.id,before.session.document.id);
});

test('folder chooser returns actual navigable directories and excludes ordinary files and symbolic links',async t=>{
 const s=await fixture(t),base=await directory(s,'Browse'),child=path.join(base,'Child Ω'),hidden=path.join(base,'.Hidden');await fs.mkdir(child);await fs.mkdir(hidden);await fs.writeFile(path.join(base,'file.txt'),'not a directory');await fs.symlink(child,path.join(base,'linked-directory'));await fs.symlink(path.join(base,'file.txt'),path.join(base,'linked-file'));
 const before=await files(s.directory),listing=await folders(s,base);assert.equal(listing.path,base);assert.equal(listing.parentPath,s.directory);assert.equal(listing.readOnly,true);assert.equal(listing.nextCursor,null);assert.ok(listing.entries.some(e=>e.path===child&&e.name==='Child Ω'));assert.ok(!listing.entries.some(e=>['file.txt','linked-directory','linked-file'].includes(e.name)));
 const nested=await folders(s,child);assert.equal(nested.parentPath,base);assert.deepEqual(nested.entries,[]);assert.deepEqual(await files(s.directory),before);
});

test('folder chooser pagination covers more than 500 directories without duplicate, omitted or file entries',async t=>{
 const s=await fixture(t),base=await directory(s,'Many Folders');await Promise.all(Array.from({length:503},(_,i)=>fs.mkdir(path.join(base,`Folder-${String(i).padStart(4,'0')}`))));await fs.writeFile(path.join(base,'ignore.txt'),'x');const before=await files(s.directory);
 const first=await folders(s,base);assert.equal(first.entries.length,500);assert.equal(first.total,503);assert.equal(first.nextCursor,500);const last=await folders(s,base,first.nextCursor);assert.equal(last.entries.length,3);assert.equal(last.total,503);assert.equal(last.nextCursor,null);assert.equal(new Set([...first.entries,...last.entries].map(e=>e.path)).size,503);assert.deepEqual(await files(s.directory),before);
});

test('folder chooser rejects missing, file and symlink paths and invalid cursors without writing or changing preferences',async t=>{
 const s=await fixture(t),base=await directory(s,'Safe'),ordinary=path.join(base,'file.txt');await fs.writeFile(ordinary,'keep');const link=path.join(s.directory,'Alias');await fs.symlink(base,link);const before=await files(s.directory),prefs=await locations(s);
 for(const value of [path.join(base,'Missing'),ordinary,link,'relative/path']){const result=await readResponse(s,'/api/workspace/folders?path='+encodeURIComponent(value));assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);}
 for(const cursor of ['-1','1.5','NaN']){const result=await readResponse(s,'/api/workspace/folders?path='+encodeURIComponent(base)+'&cursor='+cursor);assert.ok(result.status>=400,JSON.stringify(result.body));}
 assert.deepEqual(await files(s.directory),before);assert.deepEqual(await locations(s),prefs);
});

test('preference revision guards reject stale writes while unrelated document edits do not alter location settings',async t=>{
 const s=await fixture(t),a=await directory(s,'Default A'),b=await directory(s,'Default B'),old=await locations(s);ok(await locationSettings(s,{defaultLocation:a,locationMode:'default'}));const stale=await locationSettings(s,{expectedRevision:old.settings.revision,defaultLocation:b});assert.equal(stale.status,409,JSON.stringify(stale.body));assert.equal(stale.body.applied,false);assert.equal((await locations(s)).settings.defaultLocation,a);
 const prefs=await locations(s);await command(s,'project.rename',{name:'Unrelated edit'});assert.deepEqual(await locations(s),prefs);ok(await locationSettings(s,{defaultLocation:b}));assert.equal((await get(s)).project.name,'Unrelated edit');assert.equal((await locations(s)).settings.defaultLocation,b);
});

test('a location preference update invalidates an earlier new-project plan instead of silently using another base',async t=>{
 const s=await fixture(t),a=await directory(s,'Old Base'),b=await directory(s,'New Base');ok(await locationSettings(s,{defaultLocation:a,locationMode:'default'}));const plan=await locationPlan(s,{folderName:'Pending'});ok(await locationSettings(s,{defaultLocation:b}));const disk=await files(s.directory),failed=await applyNew(s,plan);assert.equal(failed.status,409,JSON.stringify(failed.body));assert.equal(failed.body.applied,false);await absent(path.join(a,'Pending'));await absent(path.join(b,'Pending'));assert.deepEqual(await files(s.directory),disk);await absent(`${s.recentPath}.drafts.json`);
});

test('external same-revision preference bytes changing after preview are rejected and preserved',async t=>{
 const s=await fixture(t),base=await directory(s,'Default');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const plan=await locationPlan(s,{folderName:'Pending'}),filename=locationFile(s),raw=await fs.readFile(filename,'utf8');await fs.writeFile(filename,raw+'\n');const external=await fs.readFile(filename),result=await applyNew(s,plan);error(result,409,'LOCATIONS_CONFLICT');assert.deepEqual(await fs.readFile(filename),external);await absent(path.join(base,'Pending'));await absent(`${s.recentPath}.drafts.json`);
});

test('invalid location combinations and project-folder names cannot escape a default base or allocate documents',async t=>{
 const s=await fixture(t),base=await directory(s,'Names');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const prefs=await locations(s),before=await files(s.directory),w=await workspace(s);
 for(const folderName of ['..','../escape','a/b','a\\b','/absolute','bad\0name']){const result=await workspacePost(s,'/new/plan',{mode:'active',expectedLocationRevision:prefs.settings.revision,location:{folderName}});assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);}
 error(await workspacePost(s,'/new/plan',{mode:'active',location:{folderName:'x'}}),422,'EXPECTED_LOCATION_REVISION_REQUIRED');
 const mixed=await workspacePost(s,'/new/plan',{mode:'active',projectFolder:path.join(base,'explicit'),location:{folderName:'extra'},expectedLocationRevision:prefs.settings.revision});assert.ok(mixed.status>=400,JSON.stringify(mixed.body));assert.deepEqual(await files(s.directory),before);assert.equal((await workspace(s)).documents.length,w.documents.length);await absent(`${s.recentPath}.drafts.json`);
});

test('existing nonempty default project folders retain unrelated bytes and each new draft has an independent identity',async t=>{
 const s=await fixture(t),base=await directory(s,'Existing'),folder=path.join(base,'Untitled');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'unrelated.txt'),'original');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));ok(await applyNew(s,await locationPlan(s,{})));const first=await get(s);ok(await applyNew(s,await locationPlan(s,{folderName:''},{mode:'inactive'})));const same=(await workspace(s)).documents.filter(d=>d.projectFolder===folder);assert.equal(same.length,2);assert.notEqual(same[0].projectId,same[1].projectId);assert.equal((await get(s)).session.document.id,first.session.document.id);assert.equal(await fs.readFile(path.join(folder,'unrelated.txt'),'utf8'),'original');
});

test('location settings and profile-based new creation work with no active document and retain deferred inactive contexts',async t=>{
 const s=await fixture(t),initial=(await workspace(s)).activeId;await closeDocument(s,initial);assert.equal((await get(s)).project,null);const base=await directory(s,'No Active');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const plan=await locationPlan(s,{folderName:'Inactive'},{mode:'inactive'});ok(await applyNew(s,plan));const state=await get(s);assert.equal(state.project,null);assert.equal(state.session.document,null);assert.equal(state.workspace.documents.length,1);assert.equal(state.workspace.documents[0].projectFolder,path.join(base,'Inactive'));assert.equal(state.workspace.documents[0].resources,'deferred');await activate(s,state.workspace.documents[0].id);assert.equal((await get(s)).session.document.neverSaved,true);
});

test('profile-created drafts keep chosen media folders through first Save, reopen and real rendering',async t=>{
 const s=await fixture(t),base=await directory(s,'Media Default');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));ok(await applyNew(s,await locationPlan(s,{folderName:'Working'})));const bytes=wav(367);await upload(s,bytes);const before=await get(s),workingFolder=before.session.document.projectFolder,asset=before.project.assets[0],namedFolder=await directory(s,'Named Elsewhere'),output=path.join(namedFolder,'Saved.json');ok(await documentPost(s,'/api/document/save',{outputPath:output}));assert.deepEqual(await fs.readFile(path.join(workingFolder,asset.path)),bytes);assert.deepEqual(await fs.readFile(path.join(namedFolder,asset.path)),bytes);assert.ok((await render(s)).channels[0].some(v=>Math.abs(v)>.01));await s.reopen();assert.equal((await get(s)).session.document.projectPath,output);assert.equal((await locations(s)).settings.defaultLocation,base);assert.ok((await render(s)).channels[0].some(v=>Math.abs(v)>.01));
});

test('corrupt location profiles remain unavailable and unchanged rather than resetting settings or creating a default project',async t=>{
 const s=await fixture(t),base=await directory(s,'Profile Corruption');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const filename=locationFile(s);await fs.writeFile(filename,'{invalid profile');const result=await locations(s);assert.equal(result.status,'unavailable');assert.equal(result.settings,null);const state=await get(s);assert.equal(state.workspace.locationSettings.status,'unavailable');const newPlan=await workspacePost(s,'/new/plan',{mode:'active',location:{folderName:'Wrong'},expectedLocationRevision:1});assert.ok(newPlan.status>=400);const update=await workspacePost(s,'/locations',{expectedRevision:1,locationMode:'prompt'});assert.ok(update.status>=400);assert.equal(await fs.readFile(filename,'utf8'),'{invalid profile');await absent(path.join(base,'Wrong'));assert.equal((await workspace(s)).documents.length,1);
});

test('real CLI shares location preferences, folder listing, default and prompt creation and explicit-path compatibility',async t=>{
 const s=await fixture(t),base=await directory(s,'CLI Default'),chosen=await directory(s,'CLI Chosen');assert.equal((await cli(s,'project-locations')).settings.locationMode,'prompt');const dry=await cli(s,'project-location-settings',JSON.stringify({defaultLocation:base,locationMode:'default'}),'--dry-run');assert.equal(dry.applied,false);await absent(locationFile(s));await cli(s,'project-location-settings',JSON.stringify({defaultLocation:base,locationMode:'default'}));
 const listed=await cli(s,'project-folders',s.directory);assert.ok(listed.entries.some(e=>e.path===base));const plan=await cli(s,'project-new-plan','--folder-name','From CLI','--sample-rate','8000');assert.equal(plan.target.projectFolder,path.join(base,'From CLI'));await cli(s,'project-new',plan.id);assert.equal((await cli(s,'status')).session.document.projectFolder,path.join(base,'From CLI'));
 await cli(s,'project-location-settings',JSON.stringify({locationMode:'prompt'}));const prompt=await cli(s,'project-new-plan','--chosen-folder',chosen,'--inactive');assert.equal(prompt.target.projectFolder,chosen);await cli(s,'project-new',prompt.id);assert.ok((await cli(s,'projects')).documents.some(d=>d.projectFolder===chosen&&!d.active));
 const explicitFolder=path.join(s.directory,'Explicit Legacy'),explicit=await cli(s,'project-new-plan',explicitFolder,'--inactive');assert.equal(explicit.target.projectFolder,explicitFolder);await cli(s,'project-new',explicit.id);assert.ok((await workspace(s)).documents.some(d=>d.projectFolder===explicitFolder));await assert.rejects(cli(s,'project-new-plan',path.join(s.directory,'Mixed'),'--folder-name','illegal'));await absent(path.join(s.directory,'Mixed'));
});

test('a default-base symlink substitution after preview is refused without creating a draft in the replacement target',async t=>{
 const s=await fixture(t),base=await directory(s,'Stable Base'),outside=await directory(s,'Replacement Target');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const plan=await locationPlan(s,{folderName:'Never Here'}),old=base+' original';await fs.rename(base,old);await fs.symlink(outside,base);const before=await get(s),raw=await fs.readFile(locationFile(s)),result=await applyNew(s,plan);assert.ok(result.status>=400,JSON.stringify(result.body));assert.equal(result.body.applied,false);await absent(path.join(outside,'Never Here'));await absent(path.join(old,'Never Here'));await absent(`${s.recentPath}.drafts.json`);assert.deepEqual(await fs.readFile(locationFile(s)),raw);assert.deepEqual((await get(s)).project,before.project);
});

test('two live servers sharing a location profile observe CAS winners and reject plans from the older location revision',async t=>{
 const a=await fixture(t),bPath=await target(a,{name:'Independent B'}),other=await startServer({projectPath:bPath,recentPath:a.recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});t.after(()=>other.close());const b={url:other.url,directory:path.dirname(bPath),recentPath:a.recentPath},baseA=await directory(a,'Profile A'),baseB=await directory(a,'Profile B'),originalB=await fs.readFile(bPath),first=await locations(b);
 ok(await locationSettings(a,{defaultLocation:baseA,locationMode:'default'}));const stale=await locationSettings(b,{expectedRevision:first.settings.revision,defaultLocation:baseB,locationMode:'default'});assert.equal(stale.status,409,JSON.stringify(stale.body));assert.equal((await locations(b)).settings.defaultLocation,baseA);
 const plan=await locationPlan(b,{folderName:'Cross Server'});ok(await locationSettings(a,{defaultLocation:baseB}));error(await applyNew(b,plan),409,'LOCATIONS_CONFLICT');await absent(path.join(baseA,'Cross Server'));await absent(path.join(baseB,'Cross Server'));
 const fresh=await locationPlan(b,{folderName:'Fresh'},{mode:'inactive'});ok(await applyNew(b,fresh));assert.equal((await get(b)).session.document.projectPath,bPath);assert.deepEqual(await fs.readFile(bPath),originalB);assert.ok((await workspace(b)).documents.some(d=>d.projectFolder===path.join(baseB,'Fresh')));assert.equal((await workspace(a)).documents.length,1);
});

test('a deleted default parent after preview is rejected by dry run and apply without recreating folders or consuming draft numbers',async t=>{
 const s=await fixture(t),base=await directory(s,'Deleted Default');ok(await locationSettings(s,{defaultLocation:base,locationMode:'default'}));const plan=await locationPlan(s,{folderName:'Uncreated Child'}),before=await get(s),profile=await fs.readFile(locationFile(s));await fs.rmdir(base);const disk=await files(s.directory);
 for(const dryRun of [true,false]){const result=await applyNew(s,plan,{dryRun});error(result,422,'ENOENT');await absent(base);await absent(`${s.recentPath}.drafts.json`);assert.deepEqual(await fs.readFile(locationFile(s)),profile);assert.deepEqual(await files(s.directory),disk);assert.deepEqual((await get(s)).project,before.project);assert.equal((await workspace(s)).documents.length,before.workspace.documents.length);}
});

test('a deleted prompt final folder after preview is rejected by dry run and apply while the remembered default stays unchanged',async t=>{
 const s=await fixture(t),base=await directory(s,'Remembered Default'),chosen=await directory(s,'Deleted Prompt');ok(await locationSettings(s,{defaultLocation:base,locationMode:'prompt'}));const plan=await locationPlan(s,{chosenFolder:chosen}),before=await get(s),profile=await fs.readFile(locationFile(s));await fs.rmdir(chosen);const disk=await files(s.directory);
 for(const dryRun of [true,false]){const result=await applyNew(s,plan,{dryRun});error(result,422,'ENOENT');await absent(chosen);await absent(`${s.recentPath}.drafts.json`);assert.deepEqual(await fs.readFile(locationFile(s)),profile);assert.deepEqual(await files(s.directory),disk);assert.deepEqual((await get(s)).project,before.project);assert.equal((await locations(s)).settings.defaultLocation,base);assert.equal((await workspace(s)).documents.length,before.workspace.documents.length);}
});
