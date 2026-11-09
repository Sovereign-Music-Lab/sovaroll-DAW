import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {decodeWav} from '../src/media/wav.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..'),rate=48000;
async function session(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-long-project-')),projectPath=path.join(dir,'Long.newdaw.json');
 const server=await startServer({projectPath,port:0,demo:false,quiet:true});
 t.after(async()=>{await server.close();await fs.rm(dir,{recursive:true,force:true});});
 return {...server,dir};
}
async function seed(s,lengthSeconds){
 const lengthTicks=Math.round(lengthSeconds*2*960),noteStart=140*2*960;
 const args={commands:[
  {command:'track.add',arguments:{id:'long-track',type:'midi',name:'Long MIDI',instrument:'sine'}},
  {command:'clip.add',arguments:{id:'long-clip',trackId:'long-track',type:'midi',name:'150 second part',startTick:0,lengthTicks,notes:[{id:'note-at-140',pitch:69,startTick:noteStart,durationTicks:1920,velocity:100,channel:0}]}}
 ]};
 const {stdout}=await exec(process.execPath,['src/cli.mjs','command','batch',JSON.stringify(args),'--url',s.url],{cwd:root,timeout:25000});
 assert.equal(JSON.parse(stdout).status,'applied');
}
const render=(s,output)=>exec(process.execPath,['src/cli.mjs','render',output,'--url',s.url],{cwd:root,timeout:120000});

test('CLI renders a MIDI note at 140 seconds in a 150-second project',async t=>{
 const s=await session(t);await seed(s,150);const output=path.join(s.dir,'long-mix.wav');
 await render(s,output);const wav=decodeWav(await fs.readFile(output));
 assert.equal(wav.sampleRate,rate);assert.ok(wav.frames>=140*rate,`expected at least 140 seconds, got ${wav.frames/rate}`);
 assert.ok(wav.frames>=150*rate,`expected the full clip length, got ${wav.frames/rate}`);
 const window=wav.channels[0].subarray(Math.round(140.25*rate),Math.round(140.35*rate));
 const rms=Math.sqrt(window.reduce((sum,value)=>sum+value*value,0)/window.length);
 assert.ok(rms>0.001,`expected nonzero PCM at the 140-second note, got RMS ${rms}`);
});

test('render beyond 600 seconds is rejected without project mutation or output',async t=>{
 const s=await session(t);await seed(s,601);const output=path.join(s.dir,'too-long.wav'),before=await fs.readFile(s.projectPath,'utf8');
 await assert.rejects(render(s,output),error=>{assert.match(String(error.stderr),/CLI_ERROR.*RENDER_FAILED.*600 seconds/);return true;});
 assert.equal(await fs.readFile(s.projectPath,'utf8'),before);await assert.rejects(fs.stat(output),{code:'ENOENT'});
});
