// Recording assistance with fake microphone and instrumented Web Audio. No hardware/listening claim.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {decodeWav,encodeWav} from '../src/media/wav.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/newdaw-recording-assistance-')),projectPath=path.join(dir,'Assistance.newdaw.json');
const tone=Float32Array.from({length:48000*2},(_,i)=>0.4*Math.sin(2*Math.PI*220*i/48000));
const fakeMic=path.join(dir,'Fake microphone.wav');await fs.writeFile(fakeMic,encodeWav({sampleRate:48000,channels:[tone,tone]}));
const session=await startServer({projectPath,port:0,demo:false,quiet:true,backupPollMs:600000});
const cli=async(...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',session.url],{cwd:root,timeout:25000})).stdout);
await cli('command','batch',JSON.stringify({commands:[
 {command:'track.add',arguments:{id:'midi-backing',type:'midi',name:'Backing'}},
 {command:'clip.add',arguments:{id:'backing-clip',trackId:'midi-backing',type:'midi',startTick:0,lengthTicks:7680,notes:[{id:'backing-note',pitch:60,velocity:80,startTick:0,durationTicks:7680,channel:0}]}}
]}));
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fakeMic}`,'--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1580,height:1400},acceptDownloads:true});await context.grantPermissions(['microphone']);
const page=await context.newPage(),tests=[],pageErrors=[];page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
await page.addInitScript(()=>{
 window.recordingAssistance={gains:[],oscillators:[],buffers:[]};
 const gain=AudioContext.prototype.createGain;AudioContext.prototype.createGain=function(...args){const node=gain.apply(this,args);window.recordingAssistance.gains.push(node);return node;};
 const oscillator=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(...args){const node=oscillator.apply(this,args),start=node.start;node.start=function(...values){window.recordingAssistance.oscillators.push({frequency:node.frequency.value,when:values[0]??0});return start.apply(node,values);};return node;};
 const buffer=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(...args){const node=buffer.apply(this,args),start=node.start;node.start=function(...values){window.recordingAssistance.buffers.push({duration:node.buffer?.duration??0,when:values[0]??0});return start.apply(node,values);};return node;};
});
const check=id=>{tests.push(id);console.log(`PASS ${id}`);};
const openPanel=async()=>{const panel=page.locator('#recording-panel');if(!await panel.evaluate(element=>element.open))await panel.locator(':scope > summary').click();};
const record=async()=>{
 await openPanel();await page.locator('#audio-record').click();await page.waitForFunction(()=>document.querySelector('#audio-record-status').textContent.includes('녹음 중'));
 await page.waitForTimeout(1000);await page.locator('#audio-record-stop').click();await page.waitForFunction(()=>document.querySelector('#audio-record-status').textContent.includes('클립 저장 완료'));
};
const download=async name=>{const pending=page.waitForEvent('download');await page.locator('#audio-record-download').click();await (await pending).saveAs(path.join(dir,name));return decodeWav(await fs.readFile(path.join(dir,name)));};
const rms=wav=>{let sum=0,count=0;const start=Math.floor(wav.sampleRate*.2),end=Math.min(wav.frames,Math.floor(wav.sampleRate*.8));for(let i=start;i<end;i++){let sample=0;for(const channel of wav.channels)sample+=channel[i]/wav.channels.length;sum+=sample*sample;count++;}return Math.sqrt(sum/Math.max(1,count));};
try{
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#audio-record').disabled);
 await record();const baseline=await download('baseline.wav');assert.equal(baseline.channels.length,1);assert.ok(rms(baseline)>.01);check('recording.GUI-input-baseline-has-nonzero-PCM');

 await openPanel();await page.locator('#audio-record-refresh').click();
 await page.waitForFunction(()=>document.querySelector('#audio-record-device').options.length>1);
 await page.locator('#audio-record-device').selectOption({index:1});
 const selectedDevice=await page.locator('#audio-record-device').inputValue();assert.ok(selectedDevice);
 await page.locator('#audio-record-channels').selectOption('2');await page.locator('#audio-record-gain').fill('-6');
 await page.locator('#audio-record-monitor').check();await page.locator('#audio-record-backing').check();await page.locator('#audio-record-count-in').selectOption('1');
 const buffersBefore=(await page.evaluate(()=>window.recordingAssistance.buffers.length)),oscillatorsBefore=await page.evaluate(()=>window.recordingAssistance.oscillators.length);
 await record();const assisted=await download('assisted.wav');assert.equal(assisted.channels.length,2);assert.ok(rms(assisted)>.01);
 const evidence=await page.evaluate(()=>({gainValues:window.recordingAssistance.gains.map(node=>node.gain.value),oscillators:window.recordingAssistance.oscillators,buffers:window.recordingAssistance.buffers}));
 assert.ok(evidence.gainValues.some(value=>Math.abs(value-10**(-6/20))<.02),'input gain should be -6 dB');
 assert.ok(evidence.gainValues.some(value=>value>.9),'monitor path should be enabled');
 assert.ok(evidence.buffers.length>buffersBefore&&evidence.buffers.at(-1).duration>0,'backing buffer should start');
 const countIn=evidence.oscillators.slice(oscillatorsBefore);assert.ok(countIn.length>=4);assert.equal(countIn[0].frequency,1500);check('recording.GUI-input-countin-backing-monitor-and-stereo');

 const gainRatio=rms(assisted)/rms(baseline);assert.ok(Math.abs(gainRatio-10**(-6/20))<.12,`gain ratio ${gainRatio} should approximate -6 dB`);check('recording.GUI-input-gain-changes-captured-PCM');
 await page.locator('#metronome-enabled').check();
 const preference=await page.evaluate(()=>JSON.parse(localStorage.getItem('newdaw.metronome.v1')));assert.equal(preference.enabled,true);
 const beforeMetronome=await page.evaluate(()=>window.recordingAssistance.oscillators.length);
 await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent.includes('재생 중'));
 await page.waitForFunction(before=>window.recordingAssistance.oscillators.length>before,beforeMetronome);
 await page.locator('#stop').click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent==='정지');check('recording.GUI-metronome-schedules-preview-clicks');
 assert.deepEqual(pageErrors,[]);
 await fs.writeFile(path.join(root,'.test-output/recording-assistance.json'),JSON.stringify({status:'passed',tests,gainRatio,selectedDevice,countInOscillators:countIn.length,backingBufferDuration:evidence.buffers.at(-1).duration,pageErrors,hardwareVerified:false},null,2));
 console.log(JSON.stringify({status:'passed',tests:tests.length}));
}finally{await browser.close();await session.close();if(!process.env.KEEP)await fs.rm(dir,{recursive:true,force:true});}
