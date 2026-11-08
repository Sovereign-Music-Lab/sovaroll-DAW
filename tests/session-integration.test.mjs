import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {startServer} from '../src/server.mjs';
import {saveProject} from '../src/storage.mjs';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t,{demo=false,...options}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-session-http-')),projectPath=path.join(directory,'session.newdaw.json');
 let server=await startServer({projectPath,port:0,demo,quiet:true,...options});
 const s={directory,projectPath,get url(){return server.url;},get server(){return server;},async reopen(opts={}){await server.close();server=await startServer({projectPath,port:0,demo:false,quiet:true,...opts});},close:()=>server.close()};
 t.after(async()=>{await server.close();await fs.rm(directory,{recursive:true,force:true});});return s;
}
const get=async(s,route='/api/state')=>{const r=await fetch(s.url+route);assert.equal(r.status,200);return r.json();};
const post=async(s,route,input)=>{const r=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,data:await r.json()};};
const cmd=async(s,command,args={},extra={})=>{const state=await get(s);return post(s,'/api/command',{command,arguments:args,expectedRevision:state.project.revision,...extra});};
const settings=async(s,value,extra={})=>{const state=await get(s);return post(s,'/api/backups/settings',{expectedRevision:state.project.revision,expectedSettingsRevision:state.session.settings.revision,autoBackup:value,...extra});};
async function until(fn){for(let i=0;i<100;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,15));}throw Error('Timed out waiting for condition');}

test('HTTP history descriptions, boundaries, redo and limits survive server reopen',async t=>{
 const s=await fixture(t);await cmd(s,'project.rename',{name:'One'});await cmd(s,'project.rename',{name:'Two'});
 let h=await get(s,'/api/history');assert.equal(h.history.entries.length,2);const id=h.history.entries[0].id;
 assert.equal((await cmd(s,'history.describe',{entryId:id,description:'First usable name'})).status,200);
 await cmd(s,'history.settings',{maxSteps:7});await cmd(s,'history.goTo',{index:1});const before=await get(s);
 assert.equal(before.project.name,'One');assert.equal(before.history.canRedo,true);
 await s.reopen();let state=await get(s);assert.deepEqual(state.project,before.project);assert.equal(state.historyView.entries[0].description,'First usable name');assert.equal(state.historyView.maxSteps,7);assert.equal(state.historyView.cursor,1);
 await cmd(s,'history.redo');state=await get(s);assert.equal(state.project.name,'Two');assert.equal(state.project.revision,before.project.revision+1);
});

test('failed project commit keeps old matching history after reopen',async t=>{
 let fail=false;const s=await fixture(t,{persistProject:async(file,p)=>{if(fail)throw Error('injected commit failure');await saveProject(file,p);}});
 await cmd(s,'project.rename',{name:'Committed'});const before=await get(s),bytes=await fs.readFile(s.projectPath);fail=true;
 const rejected=await cmd(s,'project.rename',{name:'Not committed'});assert.equal(rejected.status,500);assert.equal(rejected.data.errors[0].code,'SAVE_FAILED');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
 await s.reopen();const loaded=await get(s);assert.deepEqual(loaded.project,before.project);assert.equal(loaded.historyView.entries.length,1);await cmd(s,'history.undo');assert.equal((await get(s)).project.name,'Untitled');
});

test('mismatched history is preserved rather than applied to an externally edited project',async t=>{
 const s=await fixture(t);await cmd(s,'project.rename',{name:'Original'});await s.close();
 const oldJournal=await fs.readFile(`${s.projectPath}.history.json`),project=JSON.parse(await fs.readFile(s.projectPath,'utf8'));project.name='External edit';await fs.writeFile(s.projectPath,JSON.stringify(project));
 await s.reopen();const loaded=await get(s);assert.equal(loaded.project.name,'External edit');assert.equal(loaded.history.canUndo,false);assert.ok(loaded.session.persistence.warnings.length);
 const quarantines=(await fs.readdir(s.directory)).filter(n=>n.includes('.history.json.quarantine-'));assert.equal(quarantines.length,1);assert.deepEqual(await fs.readFile(path.join(s.directory,quarantines[0])),oldJournal);
 await cmd(s,'project.rename',{name:'Continued'});assert.equal((await get(s)).historyView.entries.length,1);
});

test('backup settings have independent revision guards, dry run and durable persistence',async t=>{
 const s=await fixture(t),before=await get(s),bytes=await fs.readFile(s.projectPath),value={enabled:false,intervalMinutes:1,maxCount:2};
 const dry=await settings(s,value,{dryRun:true});assert.equal(dry.data.applied,false);assert.deepEqual((await get(s)).session.settings,before.session.settings);
 assert.equal((await settings(s,value)).status,200);let state=await get(s);assert.equal(state.project.revision,before.project.revision);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
 assert.equal((await settings(s,{...value,maxCount:0})).status,422);
 assert.equal((await post(s,'/api/backups/settings',{expectedRevision:state.project.revision,expectedSettingsRevision:0,autoBackup:value})).status,409);
 await s.reopen();state=await get(s);assert.deepEqual(state.session.settings.autoBackup,value);assert.equal(state.session.settings.revision,1);
});

test('timers skip unchanged sessions, back up every changed open session and rotate oldest copies',async t=>{
 let now=0;const options={backupClock:()=>now,backupPollMs:15},a=await fixture(t,options),b=await fixture(t,options);
 await settings(a,{enabled:true,intervalMinutes:1,maxCount:2});await settings(b,{enabled:true,intervalMinutes:1,maxCount:2});
 now=61000;await new Promise(r=>setTimeout(r,60));assert.equal((await get(a,'/api/backups')).files.length,0);
 await cmd(a,'project.rename',{name:'A1'});await cmd(b,'project.rename',{name:'B1'});now=122000;
 await until(async()=>((await get(a,'/api/backups')).files.length===1&&(await get(b,'/api/backups')).files.length===1));
 const first=(await get(a,'/api/backups')).files[0].id;
 for(const [name,time] of [['A2',183000],['A3',244000]]){await cmd(a,'project.rename',{name});now=time;await until(async()=>!(await get(a)).session.autoBackup.dirty);}
 const list=await get(a,'/api/backups');assert.equal(list.files.length,2);assert.ok(!list.files.some(f=>f.id===first));assert.equal((await get(b,'/api/backups')).files.length,1);
 now=305000;await new Promise(r=>setTimeout(r,70));assert.equal((await get(a,'/api/backups')).files.length,2);
});

test('backup endpoints reject stale and foreign requests, downloads preserve exact backup generation',async t=>{
 const s=await fixture(t);await cmd(s,'project.rename',{name:'First backup'});const state=await get(s),created=await post(s,'/api/backups/create',{expectedRevision:state.project.revision});assert.equal(created.status,200);assert.equal(created.data.status,'created');
 await cmd(s,'project.rename',{name:'Later state'});const download=await fetch(s.url+`/api/backups/${created.data.id}/file`);assert.equal(download.status,200);assert.equal((await download.json()).name,'First backup');
 assert.equal((await post(s,'/api/backups/create',{expectedRevision:state.project.revision})).status,409);
 const foreign=await fetch(s.url+'/api/backups',{headers:{Origin:'https://example.com'}});assert.equal(foreign.status,403);
 assert.equal((await fetch(s.url+'/api/backups/%2e%2e%2fsecret/file')).status,422);
});

test('CLI config, backup and recovery create an independent usable project with collected audio',async t=>{
 const s=await fixture(t,{demo:true});
 const run=async args=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args],{cwd:root})).stdout);
 const before=await fs.readFile(s.projectPath);
 assert.equal((await run(['backup-settings','{"enabled":false,"intervalMinutes":2,"maxCount":3}','--dry-run','--url',s.url])).status,'validated');
 const created=await run(['backup-now','--url',s.url]);assert.equal(created.status,'created');
 const history=await run(['history','--url',s.url]);assert.equal(history.history.cursor,0);
 const output=path.join(s.directory,'recovered','session.json');
 const preview=await run(['recover-backup',s.projectPath,created.id,'--output',output,'--dry-run']);assert.equal(preview.dryRun,true);await assert.rejects(fs.stat(output),{code:'ENOENT'});
 const restored=await run(['recover-backup',s.projectPath,created.id,'--output',output]);assert.equal(restored.assetsCollected,true);assert.deepEqual(await fs.readFile(s.projectPath),before);
 const rendered=await run(['offline-render',output,path.join(s.directory,'recovered','mix.wav'),'--duration','0.1']);assert.equal(rendered.status,'completed');assert.ok((await fs.stat(path.join(s.directory,'recovered','mix.wav'))).size>44);
 await assert.rejects(run(['recover-backup',s.projectPath,created.id,'--output',output]));
});
