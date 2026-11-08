import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createProject} from '../src/core/engine.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function launch(t,projectPath,{stallBeforeProject=false}={}){
 const args=stallBeforeProject?['--input-type=module','-e',`import {promises as fs} from 'node:fs';import {startServer} from './src/server.mjs';await startServer({projectPath:process.argv[1],port:0,demo:false,persistProject:async()=>{await fs.writeFile(process.argv[1]+'.waiting','journal prepared');await new Promise(()=>{});}});`,projectPath]:['src/cli.mjs','serve','--project',projectPath,'--port','0'];
 const child=spawn(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stderr.on('data',b=>errors+=b);const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const url=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timeout: '+output+errors)),10000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited during startup: '+errors));});});
 return {url,async kill(){child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');}};
}
const get=async(s,route='/api/state')=>(await(await fetch(s.url+route)).json());
async function cmd(s,command,args={}){const state=await get(s),r=await fetch(s.url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,arguments:args,expectedRevision:state.project.revision})});assert.equal(r.status,200);return r.json();}
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-crash-')),projectPath=path.join(directory,'project.json');await fs.writeFile(projectPath,JSON.stringify(createProject()));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,projectPath};}

test('acknowledged undo/redo history survives a real process kill and stale lock recovery',async t=>{
 const {projectPath}=await fixture(t);const first=await launch(t,projectPath);
 await cmd(first,'project.rename',{name:'One'});await cmd(first,'project.rename',{name:'Two'});await cmd(first,'history.undo');const before=await get(first),bytes=await fs.readFile(projectPath);
 await first.kill();await fs.access(`${projectPath}.lock`);
 const reopened=await launch(t,projectPath);assert.deepEqual(await fs.readFile(projectPath),bytes);const after=await get(reopened);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);
 assert.equal((await cmd(reopened,'history.redo')).project.name,'Two');await reopened.kill();
});

test('kill after prepared journal but before project commit restores only the previous committed history',async t=>{
 const {projectPath}=await fixture(t);const first=await launch(t,projectPath,{stallBeforeProject:true}),before=await get(first);
 const pending=cmd(first,'project.rename',{name:'Never committed'}).then(()=>{throw Error('Unexpected commit');},()=>{});
 let prepared=false;for(let i=0;i<100;i++){try{await fs.access(`${projectPath}.waiting`);prepared=true;break;}catch{}await new Promise(r=>setTimeout(r,20));}assert.ok(prepared,'writer reached the commit barrier');
 await first.kill();await pending;
 const reopened=await launch(t,projectPath);const after=await get(reopened);assert.deepEqual(after.project,before.project);assert.equal(after.history.canUndo,false);assert.equal(after.session.persistence.status,'restored-previous');assert.equal(after.historyView.entries.length,0);await reopened.kill();
});
