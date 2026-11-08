import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {Engine,createProject} from '../src/core/engine.mjs';import {startServer} from '../src/server.mjs';
const exec=promisify(execFile);
test('CLI grouped trim dry run preserves files, commit shares one Undo, stale revision rejects',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-trim-cli-')),file=path.join(dir,'Trim.json'),e=new Engine(createProject({sampleRate:8000}));let server;
 t.after(async()=>{await server?.close();await fs.rm(dir,{recursive:true,force:true});});
 const commands=[{command:'track.add',arguments:{id:'t',type:'audio'}},{command:'asset.add',arguments:{asset:{id:'a',name:'Source.wav',path:`assets/${'b'.repeat(64)}.wav`,sha256:'b'.repeat(64),sampleRate:8000,channels:1,frames:8000}}},...['x','y'].map((id,i)=>({command:'clip.add',arguments:{id,type:'audio',trackId:'t',assetId:'a',startSample:i*2000,offsetFrames:1000,lengthFrames:1000}}))];
 assert.equal(e.execute({command:'batch',arguments:{commands}}).status,'applied');await fs.writeFile(file,JSON.stringify(e.project));server=await startServer({projectPath:file,recentPath:path.join(dir,'recent.json'),port:0,demo:false,quiet:true});
 const cli=async(...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',server.url],{cwd:process.cwd(),timeout:20000})).stdout),state=async()=> (await fetch(server.url+'/api/state')).json(),before=await state(),bytes=await fs.readFile(file,'utf8'),options=JSON.stringify({clipIds:['x','y'],edge:'left',seconds:.05});
 const dry=await cli('trim-clips',options,'--dry-run');assert.equal(dry.plan.commands.length,2);assert.deepEqual((await state()).project,before.project);assert.equal(await fs.readFile(file,'utf8'),bytes);
 await cli('trim-clips',options);const after=await state();assert.deepEqual(after.project.clips.map(c=>c.offsetFrames),[1400,1400]);assert.deepEqual(after.project.clips.map(c=>c.startSample),[400,2400]);
 await assert.rejects(cli('trim-clips',options,'--revision',String(before.project.revision)));assert.deepEqual((await state()).project,after.project);
 await cli('command','history.undo','{}');assert.deepEqual((await state()).project.clips,before.project.clips);
});
