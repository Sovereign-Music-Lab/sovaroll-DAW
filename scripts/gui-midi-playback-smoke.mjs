// Real Chrome and real render workers; isolated files and pass-through Web Audio observation.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const dir=await fs.mkdtemp('/private/tmp/newdaw-midi-playback-gui-'),projectPath=path.join(dir,'Playback.newdaw.json');
let session=await startServer({projectPath,port:0,demo:false,quiet:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:1180}}),tests=[],pageErrors=[];
page.setDefaultTimeout(25000);page.on('pageerror',e=>pageErrors.push(e.message));
await page.addInitScript(()=>{
  window.audioObservations=[];
  const original=AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource=function(...args){
    const source=original.apply(this,args),start=source.start,stop=source.stop,context=this;
    source.start=function(...params){const item={contextState:context.state,contextSampleRate:context.sampleRate,sampleRate:source.buffer.sampleRate,duration:source.buffer.duration,offset:params[1]??0,stopped:false,channels:[0,1].map(i=>Array.from(source.buffer.getChannelData(i).slice(4800,5760)))};window.audioObservations.push(item);source.stop=function(...values){item.stopped=true;return stop.apply(source,values);};return start.apply(source,params);};
    return source;
  };
});
const get=async()=>(await fetch(session.url+'/api/state')).json();
const cli=async(...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',session.url],{cwd:root,timeout:25000})).stdout);
const cmd=(name,args={})=>cli('command',name,JSON.stringify(args));
const check=id=>{tests.push(id);console.log('PASS '+id);};
const field=name=>page.locator(`#midi-events-fields [name="${name}"]`);
const edit=async(id,value)=>{
 await page.locator('#midi-events-button').click();await page.locator(`[data-midi-event-id="${id}"]`).click();await field('value').fill(String(value));
 const revision=(await get()).project.revision+1;await page.locator('#midi-events-apply').click();await page.waitForFunction(r=>document.querySelector('#midi-events-context').textContent.includes(`REV ${r}`),revision);await page.locator('#midi-events-close').click();
};
function decode(bytes){
 assert.equal(bytes.toString('ascii',0,4),'RIFF');let format,data;
 for(let p=12;p+8<=bytes.length;){const name=bytes.toString('ascii',p,p+4),n=bytes.readUInt32LE(p+4);if(name==='fmt ')format=bytes.subarray(p+8,p+8+n);if(name==='data')data=bytes.subarray(p+8,p+8+n);p+=8+n+(n%2);}
 assert.ok(format&&data);assert.equal(format.readUInt16LE(0),1);assert.equal(format.readUInt16LE(2),2);assert.equal(format.readUInt16LE(14),16);const sr=format.readUInt32LE(4),channels=[[],[]];
 for(let i=0;i<data.length;i+=4){channels[0].push(data.readInt16LE(i)/32768);channels[1].push(data.readInt16LE(i+2)/32768);}return{sampleRate:sr,channels,bytes};
}
const rms=(wav,ch,start,end)=>{let sum=0;const a=Math.ceil(start*wav.sampleRate),b=Math.ceil(end*wav.sampleRate);for(let i=a;i<b;i++)sum+=wav.channels[ch][i]**2;return Math.sqrt(sum/(b-a));};
const frequency=(wav,ch,start,end)=>{const a=Math.ceil(start*wav.sampleRate),b=Math.ceil(end*wav.sampleRate),cross=[];for(let i=a+1;i<b;i++)if(wav.channels[ch][i-1]<0&&wav.channels[ch][i]>=0)cross.push(i);assert.ok(cross.length>10);return (cross.length-1)*wav.sampleRate/(cross.at(-1)-cross[0]);};
const render=async()=>{
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/render'&&r.request().method()==='POST');await page.locator('#render-button').click();const res=await pending;assert.equal(res.status(),202);const job=await res.json(),id=job.jobId??job.id;
 await page.waitForFunction(id=>document.querySelector('.render-result a')?.getAttribute('href').includes(id),id);
 const href=await page.locator('.render-result a').getAttribute('href');const bytes=Buffer.from(await(await fetch(new URL(href,session.url))).arrayBuffer());return decode(bytes);
};
try{
 const cc=(id,controller,value,order,tick=0)=>({id,tick,order,kind:'channel',status:0xb2,data:[controller,value]});
 await cmd('batch',{commands:[{command:'track.add',arguments:{id:'track',type:'midi',name:'Controller playback',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',name:'Sustain and controls',lengthTicks:11520,notes:[{id:'note',channel:2,pitch:69,velocity:80,startTick:0,durationTicks:960,onOrder:10,offOrder:11}],events:[cc('volume',7,127,0),cc('pan',10,64,1),cc('expression',11,127,2),cc('sustain',64,127,3),{id:'bend',tick:0,order:4,kind:'channel',status:0xe2,data:[0,64]},cc('pedal-up',64,0,12,3840)]}}]});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#midi-events-button')?.disabled);assert.equal((await get()).capabilities.midiStatePlayback,true);
 await page.locator('#midi-events-button').click();assert.match(await page.locator('#midi-events-dialog').innerText(),/페달\(CC64\).*볼륨\(CC7\).*피치벤드/);assert.match(await page.locator('#midi-events-dialog').innerText(),/프로그램·프레셔·SysEx와 미지원 CC/);await page.locator('#midi-events-close').click();
 check('gui.midi-playback-supported-and-preserved-only-capabilities-visible');
 const baseline=await render();assert.ok(rms(baseline,0,.7,1)>.03);assert.equal(rms(baseline,0,2.06,2.2),0);assert.ok(Math.abs(frequency(baseline,0,.1,.4)-440)<1);
 check('gui.midi-playback-wav-sustain-renders-after-keyup-and-releases-on-pedalup');
 await edit('volume',32);const quiet=await render();assert.ok(Math.abs(rms(quiet,0,.1,.4)/rms(baseline,0,.1,.4)-32/127)<.001);
 check('gui.midi-playback-volume-edit-changes-real-rendered-pcm');
 const rev=(await get()).project.revision+1;await page.locator('#undo').click();await page.waitForFunction(r=>document.querySelector('#revision-label').textContent.includes(String(r)),rev);const undone=await render();assert.deepEqual(undone.bytes,baseline.bytes);
 check('gui.midi-playback-undo-restores-exact-wav-bytes');
 await edit('pan',0);const left=await render();assert.ok(rms(left,0,.1,.4)>.03);assert.equal(rms(left,1,.1,.4),0);
 check('gui.midi-playback-pan-editor-produces-left-only-output');
 await edit('bend',0);const bent=await render();assert.ok(Math.abs(frequency(bent,0,.1,.4)-440*2**(-2/12))<1);
 check('gui.midi-playback-14-bit-bend-edit-changes-measured-frequency');
 await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent.includes('재생 중'));
 let observed=await page.evaluate(()=>window.audioObservations.at(-1));assert.equal(observed.contextState,'running');assert.equal(observed.sampleRate,observed.contextSampleRate);assert.equal(observed.stopped,false);
 // decodeAudioData resamples to the hardware/context rate; compare the independent
 // exported WAV after the same browser decoding at that rate, not raw 48k indices.
 const expected=await page.evaluate(async({encoded,rate})=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),context=new OfflineAudioContext(2,1,rate),buffer=await context.decodeAudioData(bytes.buffer);return {sampleRate:buffer.sampleRate,duration:buffer.duration,channels:[0,1].map(i=>Array.from(buffer.getChannelData(i).slice(4800,5760)))};},{encoded:bent.bytes.toString('base64'),rate:observed.sampleRate});
 assert.equal(observed.offset,0);assert.equal(observed.duration,expected.duration);assert.equal(observed.sampleRate,expected.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<observed.channels[ch].length;i++)assert.ok(Math.abs(observed.channels[ch][i]-expected.channels[ch][i])<1/32768, `WebAudio PCM mismatch ch=${ch} i=${i} actual=${observed.channels[ch][i]} wav=${expected.channels[ch][i]}`);
 check('gui.midi-playback-preview-decodes-and-starts-the-same-controller-wav');
 await cmd('midi.events.update',{clipId:'clip',eventId:'expression',data:[11,0]});await page.waitForFunction(()=>window.audioObservations.at(-1).stopped);assert.equal(await page.locator('#stop').isEnabled(),false);
 check('gui.midi-playback-cli-edit-stops-old-web-audio-snapshot');
 await page.locator('#play').click();await page.waitForFunction(()=>window.audioObservations.length===2&&!window.audioObservations.at(-1).stopped);observed=await page.evaluate(()=>window.audioObservations.at(-1));assert.ok(observed.channels.every(c=>c.every(v=>v===0)));assert.match(await page.locator('#playback-status').innerText(),new RegExp(`REV ${(await get()).project.revision}`));
 check('gui.midi-playback-replay-uses-new-controller-state-and-revision');
 await page.locator('#stop').click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent==='정지');assert.equal(await page.evaluate(()=>window.audioObservations.at(-1).stopped),true);
 check('gui.midi-playback-stop-stops-actual-buffer-source');
 const before=(await get()).project;await session.close();session=await startServer({projectPath,port:0,demo:false,quiet:true});await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#midi-events-button')?.disabled);assert.deepEqual((await get()).project,before);const resumed=await render();assert.ok(resumed.channels.every(c=>c.every(v=>v===0)));
 check('gui.midi-playback-restart-preserves-controller-edits-and-silent-result');
 await page.locator('#midi-events-button').click();await page.locator('[data-midi-event-id="bend"]').click();await fs.mkdir(path.join(root,'docs/screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'docs/screenshots/v78-midi-playback.png'),fullPage:true});assert.deepEqual(pageErrors,[]);
 const paths=[];for(const base of ['src','public'])for(const entry of await fs.readdir(path.join(root,base),{recursive:true,withFileTypes:true}))if(entry.isFile()&&/\.(mjs|html|css)$/.test(entry.name))paths.push(path.relative(root,path.join(entry.parentPath,entry.name)));paths.push('scripts/gui-midi-playback-smoke.mjs');
 for(const file of ['public/native-midi.mjs', 'src/native-midi-settings.mjs', 'src/native-transport.mjs', 'native/macos/client.mjs', 'native/macos/project-plan.mjs', 'native/macos/midi-bridge.swift', 'scripts/build-native-midi.mjs','src/reset-settings.mjs','public/reset-settings.mjs','native/macos/reset-policy.mjs','src/media/midi-display-time.mjs','src/media/midi-length-adjustment.mjs','src/timing-settings.mjs','public/timing-settings.mjs','src/media/musical-time.mjs','public/musical-time-display.mjs','src/media/display-time-edit.mjs','public/inspector-time.mjs','src/media/elapsed-time.mjs','src/media/timecode.mjs','src/media/timeline-projection.mjs','src/media/time-display.mjs','public/time-display-settings.mjs','src/media/editor-geometry.mjs','src/media/ruler-intervals.mjs'])if(!paths.includes(file))paths.push(file);
 for(const file of ['src/media/note-paint.mjs','src/media/note-shapes.mjs','src/media/exact-tempo.mjs','src/media/time-edit-resolver.mjs','src/media/formatted-time-command.mjs','src/core/controller-paint.mjs','src/media/controller-shape-gesture.mjs','src/media/controller-shapes.mjs','src/media/controller-paint.mjs','src/media/controller-time-gesture.mjs','src/media/pointer-time-grid.mjs','src/media/snap-grid.mjs','public/snap-grid-settings.mjs'])if(!paths.includes(file))paths.push(file);
 const sourceHashes=Object.fromEntries(await Promise.all(paths.sort().map(async name=>[name,hash(await fs.readFile(path.join(root,name)))])));
 const receipt={status:'passed',executedAt:new Date().toISOString(),command:'NEWDAW_PLAYWRIGHT_MODULE=<installed playwright> node scripts/gui-midi-playback-smoke.mjs',browser:'headless Chrome',isolatedFixture:true,tests,pageErrors,audioValidation:'Decoded PCM and real Web Audio nodes observed; no human listening claim.',screenshots:['docs/screenshots/v78-midi-playback.png'],sourceHashes};await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/gui-midi-playback.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}catch(error){await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await page.screenshot({path:path.join(root,'.test-output/gui-midi-playback-failure.png'),fullPage:true}).catch(()=>{});console.error(`FAILED after ${tests.length} checks; pageErrors=${JSON.stringify(pageErrors)}:`,error);throw error;}
finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
