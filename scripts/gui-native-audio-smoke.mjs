// Explicit native-audio GUI path using the real helper in offline mode. No listening claim.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
await exec(process.execPath,['scripts/build-native-audio.mjs'],{cwd:root,timeout:120000});
const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/newdaw-native-audio-gui-')),projectPath=path.join(dir,'Native.newdaw.json');
let session=await startServer({projectPath,port:0,demo:false,quiet:true,nativeAudioOffline:true,backupPollMs:600000});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:1100}}),tests=[],pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
const check=id=>{tests.push(id);console.log(`PASS ${id}`);};
try{
 await exec(process.execPath,['src/cli.mjs','command','batch',JSON.stringify({commands:[{command:'track.add',arguments:{id:'track',type:'midi',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',startTick:0,lengthTicks:3840,notes:[{id:'note',pitch:60,velocity:80,startTick:0,durationTicks:960,channel:0}]}}]}),'--url',session.url],{cwd:root});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#native-audio-open').disabled);
 await page.locator('#native-audio-open').click();await page.locator('#native-audio-enabled').check();await page.locator('#native-audio-close').click();
 const revision=await page.evaluate(()=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,'')));
 await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent==='Native audio · completed',null,{timeout:30000});
 const status=await(await fetch(session.url+'/api/native/audio')).json();assert.equal(status.status,'completed');assert.equal(status.offline,true);
 assert.equal(await page.evaluate(()=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,''))),revision);
 assert.deepEqual(pageErrors,[]);check('nativeAudio.GUI-opt-in-offline-preview-preserves-project');
 const slowHelper=path.join(dir,'slow-helper.mjs');
 await fs.writeFile(slowHelper,`#!/usr/bin/env node\nlet input='';console.log(JSON.stringify({event:'ready'}));process.stdin.on('data',chunk=>{input+=chunk;while(input.includes('\\n')){const line=input.slice(0,input.indexOf('\\n'));input=input.slice(input.indexOf('\\n')+1);const value=JSON.parse(line);if(value.command==='play')console.log(JSON.stringify({event:'playing',jobId:'slow-native-job',status:'playing'}));if(value.command==='stop')console.log(JSON.stringify({event:'stopped',jobId:'slow-native-job',status:'stopped'}));if(value.command==='quit')process.exit(0);}});\n`,{mode:0o755});
 await session.close();session=await startServer({projectPath,port:0,demo:false,quiet:true,nativeAudioHelperPath:slowHelper,backupPollMs:600000});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#native-audio-open').disabled);
 await page.locator('#native-audio-open').click();await page.locator('#native-audio-enabled').check();await page.locator('#native-audio-close').click();
 await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent==='Native audio · playing',null,{timeout:30000});
 await page.locator('#stop').click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent==='Native audio · stopped');
 assert.deepEqual(pageErrors,[]);check('nativeAudio.GUI-stop-controls-active-preview');
 console.log(JSON.stringify({status:'passed',tests:tests.length}));
}catch(error){
 console.error('Native audio GUI failure state',await page.locator('#playback-status').textContent(),await page.locator('#native-audio-status').textContent(),await page.locator('#notice-text').textContent(),await page.locator('#job-text').textContent(),await page.locator('#job-bar').isVisible(),await(await fetch(session.url+'/api/native/audio')).json());
 await page.screenshot({path:path.join(root,'.test-output/native-audio-failure.png')}).catch(()=>{});throw error;
}finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
