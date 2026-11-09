// Controlled Audio Unit preview GUI/server lifecycle. The fake helper never opens an audio device.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/sovaroll-au-preview-gui-')),helperPath=path.join(dir,'helper.mjs');
const helper=`#!/usr/bin/env node
let input='',active=false,playing=false,job=0;
const emit=value=>console.log(JSON.stringify(value));
const component={id:'fake-effect',name:'Controlled silent effect',manufacturer:'SovaRoll test',type:1635083896,subtype:0,manufacturerCode:0,version:'1',sandboxSafe:true,midiInput:false,midiOutput:false,instantiated:false};
const stop=()=>{if(playing){playing=false;emit({event:'stopped',jobId:'preview-'+job,status:'stopped'});}};
emit({event:'ready'});
process.stdin.on('data',bytes=>{input+=bytes;while(input.includes('\\n')){const at=input.indexOf('\\n'),line=input.slice(0,at);input=input.slice(at+1);const value=JSON.parse(line);
 if(value.command==='list')emit({event:'list',components:[component],count:1,availableCount:1,instantiated:active});
 if(value.command==='instantiate'){active=true;emit({event:'instantiated',component,offline:true,inputChannels:2,outputChannels:2,sampleRate:48000});}
 if(value.command==='parameters')emit({event:'parameters',componentId:component.id,parameters:[],count:0,offline:true});
 if(value.command==='play'){if(!active)emit({event:'error',code:'NO_INSTANCE',message:'No instance'});else if(playing)emit({event:'error',code:'ALREADY_PLAYING',message:'Playing'});else if(value.allowDefaultOutput!==true)emit({event:'error',code:'OUTPUT_REQUIRED',message:'Permission required'});else{playing=true;job++;emit({event:'playing',jobId:'preview-'+job,status:'playing',offline:false});}}
 if(value.command==='stop')stop();
 if(value.command==='release'){stop();active=false;emit({event:'released',instantiated:false});}
 if(value.command==='quit'){stop();process.exit(0);}
}});
`;
await fs.writeFile(helperPath,helper,{mode:0o755});
const session=await startServer({projectPath:path.join(dir,'Preview.newdaw.json'),port:0,demo:false,quiet:true,audioUnitsHelperPath:helperPath,backupPollMs:600000});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1400,height:1000}}),tests=[],pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
const check=id=>{tests.push(id);console.log(`PASS ${id}`);};
const state=async()=>await(await fetch(session.url+'/api/state')).json();
const post=async(route,input)=>{const response=await fetch(session.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};};
try{
 await exec(process.execPath,['src/cli.mjs','command','batch',JSON.stringify({commands:[{command:'track.add',arguments:{id:'track',type:'midi',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',startTick:0,lengthTicks:3840,notes:[{id:'note',pitch:60,velocity:80,startTick:0,durationTicks:960,channel:0}]}},{command:'project.locators',arguments:{range:{startTick:0,endTick:1920}}}]}),'--url',session.url],{cwd:root});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#audio-units-open').disabled);await page.locator('.timeline-clip[data-clip-id="clip"]').click();await page.locator('#audio-units-open').click();await page.locator('#audio-units-list').click();await page.waitForFunction(()=>!document.querySelector('#audio-units-instantiate').disabled);await page.locator('#audio-units-instantiate').click();await page.waitForFunction(()=>!document.querySelector('#audio-units-play').disabled);await page.locator('#audio-units-scope').selectOption('locators');await page.locator('#audio-units-tracks').selectOption('selected');await page.locator('#audio-units-clips').selectOption('selected');
 const before=await state(),defaultPlayback=await page.locator('#playback-status').textContent();await page.locator('#audio-units-play').click();await page.waitForFunction(()=>!document.querySelector('#audio-units-stop').disabled);
 let current=await state();assert.equal(current.audioUnits.playing,true);assert.equal(current.audioUnits.previewJobId,'preview-1');assert.ok(current.audioUnits.previewRenderJobId);assert.equal(current.project.revision,before.project.revision);assert.equal(current.nativeAudio.status,'idle');assert.equal(await page.locator('#playback-status').textContent(),defaultPlayback);
 const scopedJob=await(await fetch(`${session.url}/api/jobs/${current.audioUnits.previewRenderJobId}`)).json();assert.equal(scopedJob.stats.startTick,0);assert.equal(scopedJob.stats.frames,48000);
 const permission=await post('/api/audio-units/play',{expectedRevision:1,jobId:current.audioUnits.previewRenderJobId,allowDefaultOutput:false});assert.equal(permission.status,422);assert.equal(permission.body.errors[0].code,'INVALID_AUDIO_UNIT_PLAY');
 const arbitraryPath=await post('/api/audio-units/play',{expectedRevision:1,jobId:current.audioUnits.previewRenderJobId,allowDefaultOutput:true,path:'/tmp/not-allowed.wav'});assert.equal(arbitraryPath.status,422);assert.equal(arbitraryPath.body.errors[0].code,'INVALID_AUDIO_UNIT_PLAY');
 const conflict=await post('/api/audio-units/stop',{expectedRevision:1,jobId:'wrong-job'});assert.equal(conflict.status,409);assert.equal(conflict.body.errors[0].code,'AUDIO_UNIT_PREVIEW_CONFLICT');
 const stale=await post('/api/audio-units/play',{expectedRevision:0,jobId:current.audioUnits.previewRenderJobId,allowDefaultOutput:true});assert.equal(stale.status,409);assert.equal(stale.body.errors[0].code,'REVISION_CONFLICT');assert.equal((await state()).audioUnits.playing,true);check('audioUnits.GUI-preview-Play-scope-job-and-conflict-guards');
 await page.locator('#audio-units-stop').click();await page.waitForFunction(()=>document.querySelector('#audio-units-result').textContent.startsWith('미리 듣기 정지'));current=await state();assert.equal(current.audioUnits.playing,false);assert.equal(current.audioUnits.status,'stopped');assert.equal(current.audioUnits.instantiated,true);assert.equal(current.project.revision,1);check('audioUnits.GUI-preview-Stop-preserves-instance-and-project');
 await page.locator('#audio-units-play').click();await page.waitForFunction(()=>!document.querySelector('#audio-units-stop').disabled);assert.equal((await state()).audioUnits.previewJobId,'preview-2');
 const edited=await post('/api/command',{command:'project.rename',arguments:{name:'Preview cleanup'},expectedRevision:1});assert.equal(edited.status,200,JSON.stringify(edited.body));
 await page.waitForFunction(()=>document.querySelector('#audio-units-status').textContent.startsWith('idle'));current=await state();assert.equal(current.project.revision,2);assert.equal(current.audioUnits.playing,false);assert.equal(current.audioUnits.instantiated,false);assert.equal(current.nativeAudio.status,'idle');assert.equal(await page.locator('#playback-status').textContent(),defaultPlayback);assert.deepEqual(pageErrors,[]);check('audioUnits.GUI-project-edit-stops-preview-and-releases-instance');
 console.log(JSON.stringify({status:'passed',tests:tests.length}));
}finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
