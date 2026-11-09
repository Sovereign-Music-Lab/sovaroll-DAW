// On-demand Audio Unit offline GUI probe using the actual helper. No playback/listening claim.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {decodeWav} from '../src/media/wav.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
await exec(process.execPath,['scripts/build-native-audio-units.mjs'],{cwd:root,timeout:120000});
const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/newdaw-audio-units-gui-')),projectPath=path.join(dir,'Probe.newdaw.json');
const session=await startServer({projectPath,port:0,demo:false,quiet:true,backupPollMs:600000});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:1100}}),tests=[],pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
const check=id=>{tests.push(id);console.log(`PASS ${id}`);};
try{
 await exec(process.execPath,['src/cli.mjs','command','batch',JSON.stringify({commands:[{command:'track.add',arguments:{id:'track',type:'midi',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',startTick:0,lengthTicks:3840,notes:[{id:'note',pitch:60,velocity:80,startTick:0,durationTicks:960,channel:0}]}}]}),'--url',session.url],{cwd:root});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#audio-units-open').disabled);
 await page.locator('#audio-units-open').click();await page.locator('#audio-units-list').click();
 await page.waitForFunction(()=>document.querySelector('#audio-units-component').options.length>0);
 const selected=await page.locator('#audio-units-component').evaluate(select=>{const option=[...select.options].find(option=>option.dataset.audioUnitType==='1635083896');if(!option)return false;select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));return true;});
 assert.ok(selected,'Expected a system effect option in the offline probe');
 await page.locator('#audio-units-instantiate').click();await page.waitForFunction(()=>!document.querySelector('#audio-units-render').disabled);
 check('audioUnits.GUI-discovery-selection-and-explicit-instantiation');
 const revision=await page.evaluate(()=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,'')));
 await page.locator('#audio-units-render').click();await page.waitForFunction(()=>document.querySelector('#audio-units-result').textContent.includes('완료'),null,{timeout:30000});
 const result=await page.locator('#audio-units-result').textContent();assert.match(result,/frames/);assert.match(result,/출력 [a-f0-9]{64}/);
 assert.equal(await page.evaluate(()=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,''))),revision);
 assert.deepEqual(pageErrors,[]);check('audioUnits.GUI-offline-render-preserves-project-and-default-playback');
 const downloadEvent=page.waitForEvent('download');await page.locator('#audio-units-download').click();const download=await downloadEvent,output=path.join(dir,'processed.wav');await download.saveAs(output);
 const wav=decodeWav(await fs.readFile(output));assert.ok(wav.frames>0);assert.equal(wav.sampleRate,48000);assert.equal(wav.channels.length,2);check('audioUnits.GUI-processed-WAV-download');
 console.log(JSON.stringify({status:'passed',tests:tests.length}));
}finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
