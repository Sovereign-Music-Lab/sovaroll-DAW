// First-delivery integrated workflow check (real Chrome + shared server + CLI).
// NEWDAW_PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/gui-first-delivery-smoke.mjs
// Covers: new project → MIDI track/notes edit → WAV import + fake-microphone recording → audio edit →
// MIDI+audio playback, mixer → WAV/MIDI/bundle export → explicit Save → server restart → reopen, play, re-export.
// Uses an isolated temporary project; never touches sessions/ or the user's running server.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {decodeWav, encodeWav} from '../src/media/wav.mjs';
import {parseMidi} from '../src/media/midi.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/newdaw-first-delivery-')),projectPath=path.join(dir,'Delivery.newdaw.json'),downloads=path.join(dir,'downloads');
await fs.mkdir(downloads);
const tests=[],pageErrors=[],consoleErrors=[],httpErrors=[],timings={};const t0=Date.now();
const check=id=>{tests.push(id);timings[id]=Date.now()-t0;console.log('PASS '+id);};
const cliRaw=async(...args)=>(await exec(process.execPath,['src/cli.mjs',...args],{cwd:root,timeout:60000})).stdout;
function sine(seconds,freq,rate=48000){const frames=Math.round(seconds*rate),c=new Float32Array(frames);for(let i=0;i<frames;i++)c[i]=.4*Math.sin(2*Math.PI*freq*i/rate);return encodeWav({sampleRate:rate,channels:[c,c]});}
const fakeMicPath=path.join(dir,'Fake microphone.wav');await fs.writeFile(fakeMicPath,sine(2,440));
await cliRaw('init',projectPath);
const start=()=>startServer({projectPath,port:0,demo:false,quiet:true,backupPollMs:600000});let session=await start();
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fakeMicPath}`,'--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1580,height:2000},acceptDownloads:true});let page;
const state=async()=>(await fetch(session.url+'/api/state')).json(),proj=async()=>(await state()).project;
const cli=async(...args)=>JSON.parse(await cliRaw(...args,'--url',session.url)),cmd=(c,a={})=>cli('command',c,JSON.stringify(a));
const revision=()=>page.evaluate(()=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,'')));
const synced=()=>page.waitForFunction(()=>document.getElementById('connection-status')?.textContent.includes('동기화'));
async function after(rev){await page.waitForFunction(r=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,''))>r,rev);await page.waitForFunction(()=>!document.querySelector('#undo')?.closest('[aria-busy="true"]'));}
async function act(fn){const rev=(await proj()).revision;await fn();await after(rev);return proj();}
async function openPage(){page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('response',r=>{if(r.status()>=400)httpErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);});await page.goto(session.url);await synced();}
async function download(trigger,name){const [d]=await Promise.all([page.waitForEvent('download',{timeout:60000}),trigger()]);const file=path.join(downloads,name);await d.saveAs(file);return file;}
const openMenu=async id=>{const d=page.locator('#'+id);if(!(await d.evaluate(e=>e.open)))await d.locator('summary').click();};
const zoom=async()=>Number(await page.locator('#zoom').inputValue());
async function gridPoint(tick,pitch){await scrollPianoTo(pitch);const grid=page.locator('#note-grid'),box=await grid.boundingBox();return {x:box.x+tick/960*await zoom()+3,y:box.y+(127-pitch)*19+9};}
async function scrollPianoTo(pitch){await page.locator('#piano-scroll').evaluate((e,p)=>{e.scrollTop=Math.max(0,(127-p)*19-e.clientHeight/2);e.scrollLeft=0;},pitch);}
async function clickRuler(selector,tick){const box=await page.locator(selector).boundingBox();const scroll=selector==='#piano-ruler'?await page.locator('#piano-scroll').evaluate(e=>e.scrollLeft):await page.locator('#timeline-scroll').evaluate(e=>e.scrollLeft);await page.mouse.click(box.x+tick/960*await zoom()-scroll+0.01,box.y+5);}
const near=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg??''} ${a} expected ${b} ±${tol}`);
const rms=ch=>Math.sqrt(ch.reduce((s,x)=>s+x*x,0)/Math.max(1,ch.length));
let summary={};
try{
 // 1. Project
 await openPage();
 assert.equal((await proj()).tracks.length,0);assert.equal(await page.locator('#timeline-empty').isVisible(),true);check('project.new-empty-project-opens-in-GUI');

 // 2. MIDI track + notes
 let p=await act(()=>page.locator('#empty-add').click());
 const midiTrack=p.tracks[0],midiClip=p.clips[0];assert.equal(midiTrack.type,'midi');assert.equal(midiClip.type,'midi');check('midi.GUI-create-track-and-part');
 await page.locator('#piano-scroll').scrollIntoViewIfNeeded();await scrollPianoTo(64);
 const melody=[[0,60],[960,64],[1920,67],[2880,72]];
 for(const [tick,pitch] of melody){const pt=await gridPoint(tick,pitch);await act(()=>page.mouse.click(pt.x,pt.y));}
 p=await proj();let notes=p.clips.find(c=>c.id===midiClip.id).notes;
 assert.deepEqual(notes.map(n=>[n.startTick,n.pitch]).sort((a,b)=>a[0]-b[0]),melody);check('midi.GUI-piano-roll-note-input');
 // drag the last note up a whole tone and one beat later
 const lastNote=notes.find(n=>n.startTick===2880);let from=await gridPoint(2880+120,72);let to={x:from.x+await zoom(),y:from.y-2*19};
 await act(async()=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();});
 notes=(await proj()).clips[0].notes;const moved=notes.find(n=>n.id===lastNote.id);assert.equal(moved.startTick,3840);assert.equal(moved.pitch,74);check('midi.GUI-note-drag-move-time-and-pitch');
 // Inspector velocity + length
 await page.locator(`#note-grid [data-note-id="${lastNote.id}"]`).click();await page.locator('#note-form input[name="velocity"]').fill('70');
 const durField=page.locator('#note-form input[name="durationDisplayTicks"]');const displayPpq=Number((await durField.inputValue()).split('/')[0])/(moved.durationTicks/960)||480;
 await durField.fill(String(displayPpq*2));await act(()=>page.locator('#note-form button[type="submit"]').click());
 notes=(await proj()).clips[0].notes;const edited=notes.find(n=>n.id===lastNote.id);assert.equal(edited.velocity,70);assert.equal(edited.durationTicks,1920);check('midi.GUI-inspector-velocity-and-length');
 // Undo / Redo
 await act(()=>page.locator('#undo').click());assert.equal((await proj()).clips[0].notes.find(n=>n.id===lastNote.id).velocity,moved.velocity);
 await act(()=>page.locator('#redo').click());assert.equal((await proj()).clips[0].notes.find(n=>n.id===lastNote.id).velocity,70);check('midi.GUI-undo-redo');
 // Copy all notes, paste at the piano cursor (bar 3)
 await page.locator(`#note-grid [data-note-id="${notes[0].id}"]`).click();await page.keyboard.press('ControlOrMeta+a');
 await page.waitForFunction(n=>document.querySelectorAll('#note-grid .midi-note.selected').length===n,notes.length);
 await page.keyboard.press('ControlOrMeta+c');await clickRuler('#piano-ruler',7680);
 await page.waitForFunction(()=>document.querySelector('#position-bars')?.textContent.startsWith('003'));
 await act(()=>page.keyboard.press('ControlOrMeta+v'));
 notes=(await proj()).clips[0].notes;assert.equal(notes.length,8);assert.deepEqual(notes.filter(n=>n.startTick>=7680).map(n=>n.startTick-7680).sort((a,b)=>a-b),[0,960,1920,3840]);check('midi.GUI-note-copy-paste-at-cursor');
 // Repeat the part once (clip repeat dialog)
 await page.locator(`.timeline-clip[data-clip-id="${midiClip.id}"]`).first().click({position:{x:12,y:8}});
 await openMenu('editing-tools-menu');await page.locator('#repeat-selected-clips').click();await page.locator('#repeat-clips-count').fill('1');
 p=await act(()=>page.locator('#repeat-clips-form [type=submit]').click());
 const midiClips=p.clips.filter(c=>c.trackId===midiTrack.id).sort((a,b)=>a.startTick-b.startTick);assert.equal(midiClips.length,2);assert.equal(midiClips[1].startTick,midiClip.lengthTicks);assert.equal(midiClips[1].notes.length,8);check('midi.GUI-part-repeat');
 // Split the original part at bar 3 on the timeline ruler
 await page.locator(`.timeline-clip[data-clip-id="${midiClip.id}"]`).first().click({position:{x:12,y:8}});await clickRuler('#timeline-ruler',7680);
 p=await act(()=>openMenu('arrangement-edit-menu').then(()=>page.locator('#split-clips-cursor').click()));
 const splitClips=p.clips.filter(c=>c.trackId===midiTrack.id).sort((a,b)=>a.startTick-b.startTick);assert.equal(splitClips.length,3);assert.deepEqual(splitClips.slice(0,2).map(c=>[c.startTick,c.lengthTicks]),[[0,7680],[7680,7680]]);
 assert.equal(splitClips[0].notes.length+splitClips[1].notes.length,8);check('midi.GUI-part-split-at-cursor');
 await page.locator(`.timeline-clip[data-clip-id="${splitClips[0].id}"]`).first().click({position:{x:12,y:8}});
 const toolOriginal=(await proj()).clips.find(c=>c.id===splitClips[0].id).notes.map(note=>({...note}));
 await page.locator('#note-grid').focus();await page.keyboard.press('ControlOrMeta+a');
 await page.waitForFunction(count=>document.querySelectorAll('#note-grid .midi-note.selected').length===count,toolOriginal.length);
 await page.locator('#midi-tools-button').click();await page.locator('#midi-operation').selectOption('transpose');await page.locator('#transpose-semitones').fill('2');
 p=await act(()=>page.locator('#midi-tools-form [type=submit]').click());
 const transposed=p.clips.find(c=>c.id===splitClips[0].id).notes;assert.equal(transposed.length,toolOriginal.length);
 for(const note of transposed)assert.equal(note.pitch,toolOriginal.find(original=>original.id===note.id).pitch+2);
 p=await act(()=>page.locator('#undo').click());
 for(const note of p.clips.find(c=>c.id===splitClips[0].id).notes)assert.equal(note.pitch,toolOriginal.find(original=>original.id===note.id).pitch);
 check('midi.GUI-tools-transpose');
 await page.locator('#note-grid').focus();await page.keyboard.press('ControlOrMeta+a');
 await page.waitForFunction(count=>document.querySelectorAll('#note-grid .midi-note.selected').length===count,toolOriginal.length);
 await page.locator('#midi-tools-button').click();await page.locator('#midi-operation').selectOption('velocity');await page.locator('#velocity-mode').selectOption('set');await page.locator('#velocity-value').fill('54');
 p=await act(()=>page.locator('#midi-tools-form [type=submit]').click());
 assert.ok(p.clips.find(c=>c.id===splitClips[0].id).notes.every(note=>note.velocity===54));
 p=await act(()=>page.locator('#undo').click());
 for(const note of p.clips.find(c=>c.id===splitClips[0].id).notes)assert.equal(note.velocity,toolOriginal.find(original=>original.id===note.id).velocity);
 check('midi.GUI-tools-velocity');
 summary.midiNotes=p.clips.filter(c=>c.type==='midi').reduce((s,c)=>s+c.notes.length,0);

 // 3. Audio: WAV import at cursor, fake microphone recording, edit
 const wavPath=path.join(dir,'Tone A3.wav');await fs.writeFile(wavPath,sine(2,220));
 await clickRuler('#timeline-ruler',1920);
 p=await act(async()=>{await page.locator('#import-button').click();await page.locator('#import-audio-position').selectOption('cursor');const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#import-choose-file').click()]);await chooser.setFiles(wavPath);});
 let audioClip=p.clips.find(c=>c.type==='audio');assert.ok(audioClip,'imported audio clip');const audioTrack=p.tracks.find(t=>t.id===audioClip.trackId);assert.equal(audioTrack.type,'audio');
 summary.importStartSample=audioClip.startSample;near(audioClip.startSample,48000,48,'imported at cursor (1 s)');check('audio.GUI-WAV-import-at-cursor');
 await clickRuler('#timeline-ruler',960*12);
 const recordRev=(await proj()).revision;await page.locator('#audio-record').click();await page.waitForFunction(()=>document.querySelector('#audio-record-status').textContent.includes('녹음 중'));await page.waitForTimeout(1200);
 await page.locator('#audio-record-stop').click();await page.waitForFunction(()=>document.querySelector('#audio-record-status').textContent.includes('클립 저장 완료'),null,{timeout:30000});
 p=await proj();assert.equal(p.revision,recordRev+1);const recorded=p.clips.find(c=>c.type==='audio'&&c.id!==audioClip.id);assert.ok(recorded);near(recorded.startSample,48000*6,48,'recorded at cursor');assert.ok(recorded.lengthFrames>0);check('audio.GUI-fake-microphone-recording-to-cursor-clip');
 // move imported clip to 0.5 s via inspector, then split it at 2 s, then trim the tail
 await page.locator(`.timeline-clip[data-clip-id="${audioClip.id}"]`).first().click({position:{x:12,y:8}});
 await page.locator('#clip-form input[name="startSeconds"]').fill('0.5');p=await act(()=>page.locator('#clip-form button[type="submit"]').click());
 audioClip=p.clips.find(c=>c.id===audioClip.id);assert.equal(audioClip.startSample,24000);check('audio.GUI-clip-move');
 await clickRuler('#timeline-ruler',960*4);p=await act(()=>openMenu('arrangement-edit-menu').then(()=>page.locator('#split-clips-cursor').click()));
 const audioParts=p.clips.filter(c=>c.assetId===audioClip.assetId).sort((a,b)=>a.startSample-b.startSample);assert.equal(audioParts.length,2);near(audioParts[1].startSample,96000,48,'split at cursor');assert.equal(audioParts[0].lengthFrames+audioParts[1].lengthFrames,96000);check('audio.GUI-clip-split-at-cursor');
 await page.locator(`.timeline-clip[data-clip-id="${audioParts[1].id}"]`).first().click({position:{x:12,y:8}});
 await page.locator('#clip-form input[name="lengthFrames"]').fill('12000');p=await act(()=>page.locator('#clip-form button[type="submit"]').click());
 assert.equal(p.clips.find(c=>c.id===audioParts[1].id).lengthFrames,12000);check('audio.GUI-clip-trim-length');
 await page.locator(`.timeline-clip[data-clip-id="${audioParts[0].id}"]`).first().click({position:{x:12,y:8}});
 const renderAudioMix=async name=>{const file=path.join(downloads,name);await cli('render',file);return decodeWav(await fs.readFile(file));};
 const beforeFade=await renderAudioMix('before-fade.wav');
 await page.locator('#clip-form input[name="fadeInSeconds"]').fill('0.5');
 p=await act(()=>page.locator('#clip-form button[type="submit"]').click());
 const fadedClip=p.clips.find(c=>c.id===audioParts[0].id);
 const fadeAsset=p.assets.find(a=>a.id===fadedClip.assetId);
 assert.equal(fadedClip.fadeInFrames,Math.round(0.5*fadeAsset.sampleRate));
 const afterFade=await renderAudioMix('after-fade.wav');
 const fadeWindowRms=(mix,offsetSeconds,durationSeconds)=>{
  const start=Math.round((fadedClip.startSample/p.sampleRate+offsetSeconds)*mix.sampleRate);
  const end=Math.round(start+durationSeconds*mix.sampleRate),mono=new Float32Array(end-start);
  for(let i=0;i<mono.length;i++)mono[i]=(mix.channels[0][start+i]+mix.channels[1][start+i])/2;
  return rms(mono);
 };
 const earlyBefore=fadeWindowRms(beforeFade,0,0.05),lateBefore=fadeWindowRms(beforeFade,0.45,0.05);
 const earlyAfter=fadeWindowRms(afterFade,0,0.05),lateAfter=fadeWindowRms(afterFade,0.45,0.05);
 assert.ok(earlyAfter<lateAfter/2,`faded clip start ${earlyAfter} must be less than half of ${lateAfter}`);
 assert.ok(earlyAfter<earlyBefore,`fade must reduce the matching start window: ${earlyAfter} vs ${earlyBefore}`);
 assert.ok(lateAfter<lateBefore,`fade must reduce the matching late window: ${lateAfter} vs ${lateBefore}`);
 summary.fadeIn={earlyBefore,lateBefore,earlyAfter,lateAfter};
 p=await act(()=>page.locator('#undo').click());
 assert.ok(!p.clips.find(c=>c.id===audioParts[0].id).fadeInFrames,'Undo removes fade-in');
 check('audio.GUI-fade-in-changes-render');
 const assetBytes=await fs.readFile(path.join(dir,p.assets.find(a=>a.id===audioClip.assetId).path));assert.equal(decodeWav(assetBytes).frames,96000);check('audio.source-WAV-preserved-after-edits');
 p=await act(()=>cmd('track.update',{trackId:midiTrack.id,mute:true}));
 assert.equal(p.tracks.find(t=>t.id===midiTrack.id).mute,true);
 const beforeClipControls=await renderAudioMix('before-clip-controls.wav');
 const recordedAsset=p.assets.find(a=>a.id===recorded.assetId);
 const recordedStart=recorded.startSample/p.sampleRate,recordedWindow=Math.min(0.5,recorded.lengthFrames/recordedAsset.sampleRate);
 const recordedRms=mix=>{
  const start=Math.round(recordedStart*mix.sampleRate),end=Math.round(start+recordedWindow*mix.sampleRate),mono=new Float32Array(end-start);
  for(let i=0;i<mono.length;i++)mono[i]=(mix.channels[0][start+i]+mix.channels[1][start+i])/2;
  return rms(mono);
 };
 const recordedBeforeRms=recordedRms(beforeClipControls);
 assert.ok(recordedBeforeRms>0.0001,`recorded clip baseline must be audible: ${recordedBeforeRms}`);
 await page.locator(`.timeline-clip[data-clip-id="${recorded.id}"]`).first().click({position:{x:12,y:8}});
 await page.locator('#clip-form input[name="audioMute"]').check();
 p=await act(()=>page.locator('#clip-form button[type="submit"]').click());
 assert.equal(p.clips.find(c=>c.id===recorded.id).mute,true);
 assert.ok(await page.locator(`.timeline-clip[data-clip-id="${recorded.id}"]`).first().evaluate(e=>e.classList.contains('muted-clip')));
 const afterClipMute=await renderAudioMix('after-clip-mute.wav'),recordedMutedRms=recordedRms(afterClipMute);
 assert.ok(recordedMutedRms<0.0001,`muted recorded region must be near zero: ${recordedMutedRms}`);
 assert.ok(recordedMutedRms<recordedBeforeRms*0.01,`mute must reduce ${recordedBeforeRms} to near zero, got ${recordedMutedRms}`);
 summary.clipMute={before:recordedBeforeRms,after:recordedMutedRms};
 p=await act(()=>page.locator('#undo').click());assert.ok(!p.clips.find(c=>c.id===recorded.id).mute,'Undo restores clip mute');
 check('audio.GUI-clip-mute-silences-render');
 const polarityClip=p.clips.find(c=>c.id===audioParts[0].id);
 const polarityFrame=Math.round((polarityClip.startSample/p.sampleRate+0.13)*beforeClipControls.sampleRate);
 const beforePolaritySample=beforeClipControls.channels[0][polarityFrame];
 assert.ok(Math.abs(beforePolaritySample)>0.01,`polarity reference sample must be non-zero: ${beforePolaritySample}`);
 await page.locator(`.timeline-clip[data-clip-id="${polarityClip.id}"]`).first().click({position:{x:12,y:8}});
 await page.locator('#clip-form input[name="invertPolarity"]').check();
 p=await act(()=>page.locator('#clip-form button[type="submit"]').click());
 assert.equal(p.clips.find(c=>c.id===polarityClip.id).invertPolarity,true);
 const afterPolarity=await renderAudioMix('after-polarity.wav'),invertedSample=afterPolarity.channels[0][polarityFrame];
 assert.ok(Math.sign(invertedSample)===-Math.sign(beforePolaritySample),`polarity sign must flip: ${beforePolaritySample} vs ${invertedSample}`);
 near(invertedSample,-beforePolaritySample,2/32768,'inverted PCM sample');
 summary.polarity={frame:polarityFrame,before:beforePolaritySample,after:invertedSample};
 p=await act(()=>page.locator('#undo').click());assert.ok(!p.clips.find(c=>c.id===polarityClip.id).invertPolarity,'Undo restores polarity');
 check('audio.GUI-clip-polarity-inverts-render');
 const beforeNormalize=p.clips.find(c=>c.id===polarityClip.id),previousGain=beforeNormalize.gainDb??0;
 const {gainDb:ignoredBeforeGain,...beforeNormalizeWithoutGain}=beforeNormalize;
 await page.locator('#audio-normalize-target').fill('-1');
 p=await act(()=>page.locator('[data-action="normalize-audio"]').click());
 const normalizedClip=p.clips.find(c=>c.id===polarityClip.id),{gainDb:normalizedGain,...afterNormalizeWithoutGain}=normalizedClip;
 near(normalizedGain,6.96,0.05,'normalize gain');
 assert.deepEqual(afterNormalizeWithoutGain,beforeNormalizeWithoutGain,'normalize changes only clip gain');
 p=await act(()=>page.locator('#undo').click());assert.equal(p.clips.find(c=>c.id===polarityClip.id).gainDb??0,previousGain,'Undo restores pre-normalize gain');
 const normalizedAssetBytes=await fs.readFile(path.join(dir,p.assets.find(a=>a.id===polarityClip.assetId).path));
 assert.equal(sha(normalizedAssetBytes),sha(assetBytes),'normalize preserves source WAV bytes');
 summary.normalize={previousGain,normalizedGain,assetSha256:sha(normalizedAssetBytes)};check('audio.GUI-normalize-sets-clip-gain');
 p=await act(()=>cmd('track.update',{trackId:midiTrack.id,mute:false}));
 assert.equal(p.tracks.find(t=>t.id===midiTrack.id).mute,false);

 // 4. Playback + mixer
 await clickRuler('#timeline-ruler',0);
 await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent.includes('재생 중'),null,{timeout:60000});
 const pos1=await page.locator('#position-time').textContent();await page.waitForTimeout(700);const pos2=await page.locator('#position-time').textContent();assert.notEqual(pos1,pos2,'transport advances');
 await page.locator('#stop').click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='정지');check('playback.GUI-MIDI-and-audio-play-advance-stop');
 await clickRuler('#timeline-ruler',960*8);assert.ok((await page.locator('#position-bars').textContent()).startsWith('003'));check('playback.GUI-seek-by-ruler');
 const head=id=>page.locator(`.track-head[data-track-id="${id}"]`);
 p=await act(()=>head(audioTrack.id).locator('button[data-action="mute"]').click());assert.equal(p.tracks.find(t=>t.id===audioTrack.id).mute,true);
 p=await act(()=>head(audioTrack.id).locator('button[data-action="mute"]').click());assert.equal(p.tracks.find(t=>t.id===audioTrack.id).mute,false);
 p=await act(()=>head(midiTrack.id).locator('button[data-action="solo"]').click());assert.equal(p.tracks.find(t=>t.id===midiTrack.id).solo,true);
 p=await act(()=>head(midiTrack.id).locator('button[data-action="solo"]').click());assert.equal(p.tracks.find(t=>t.id===midiTrack.id).solo,false);
 const setRange=async(locator,value)=>act(()=>locator.evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value));
 p=await setRange(head(midiTrack.id).locator('input[data-action="gain"]'),-3);assert.equal(p.tracks.find(t=>t.id===midiTrack.id).gainDb,-3);
 p=await setRange(head(audioTrack.id).locator('input[data-action="pan"]'),0.3);assert.equal(p.tracks.find(t=>t.id===audioTrack.id).pan,0.3);
 p=await setRange(page.locator('#master-gain'),-4);assert.equal(p.masterGainDb,-4);check('mixer.GUI-mute-solo-gain-pan-master');
 p=await act(()=>cmd('project.locators',{range:{startTick:0,endTick:3840}}));
 assert.deepEqual(p.locators,{startTick:0,endTick:3840});await clickRuler('#timeline-ruler',0);
 p=await act(()=>page.locator('#cycle-playback').click());assert.equal(p.cycleEnabled,true);
 assert.equal(await page.locator('#cycle-playback').getAttribute('aria-pressed'),'true');
 await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent.includes('재생 중'),null,{timeout:60000});
 const cycleSamples=[],cyclePollStart=Date.now();
 while(Date.now()-cyclePollStart<3000){
  const parts=(await page.locator('#position-time').textContent()).split(/[:.]/).map(Number);
  assert.equal(parts.length,3);const seconds=parts[0]*60+parts[1]+parts[2]/1000;
  assert.ok(Number.isFinite(seconds),`cycle position must be numeric: ${parts}`);cycleSamples.push(seconds);
  await page.waitForTimeout(75);
 }
 await page.locator('#stop').click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='정지');
 assert.ok(cycleSamples.length>=10,`expected repeated cycle samples, got ${cycleSamples.length}`);
 for(const seconds of cycleSamples)assert.ok(seconds>=0&&seconds<=2.15,`cycle position outside locator range: ${seconds}`);
 const cycleWrapped=cycleSamples.some((seconds,index)=>index>0&&seconds+0.1<cycleSamples[index-1]);
 assert.ok(cycleWrapped,`expected a transport wrap: ${cycleSamples.join(', ')}`);
 summary.cycle={samples:cycleSamples.length,min:Math.min(...cycleSamples),max:Math.max(...cycleSamples),wrapped:cycleWrapped};
 p=await act(()=>page.locator('#cycle-playback').click());assert.equal(p.cycleEnabled,false);
 assert.equal(await page.locator('#cycle-playback').getAttribute('aria-pressed'),'false');check('playback.GUI-cycle-loops-locator-range');

 // 5. Export: WAV mix, MIDI, bundle
 await page.locator('#render-button').click();await page.locator('#mix-export-submit').click();
 await page.waitForSelector('.render-result a',{timeout:90000});
 const guiWav=await download(()=>page.locator('.render-result a').click(),'gui-mix.wav');const mix=decodeWav(await fs.readFile(guiWav));
 assert.ok(mix.frames>=48000*7,'mix covers project');assert.ok(rms(mix.channels[0])>0.001&&rms(mix.channels[1])>0.001,'mix is not silent');
 const atAudio=mix.channels[1].subarray(48000*0.6,48000*0.9),atMidiOnly=mix.channels[0].subarray(0,48000*0.4);assert.ok(rms(atAudio)>0.01);assert.ok(rms(atMidiOnly)>0.0005);
 summary.mix={frames:mix.frames,sampleRate:mix.sampleRate,rmsL:rms(mix.channels[0]),rmsR:rms(mix.channels[1])};check('export.GUI-mix-WAV-download-non-silent');
 await page.locator('#midi-export-open').click();const guiMid=await download(()=>page.locator('#midi-download').click(),'gui.mid');
 const parsed=parseMidi(await fs.readFile(guiMid));const exportedNotes=parsed.tracks.reduce((s,t)=>s+t.notes.length,0);assert.equal(exportedNotes,summary.midiNotes);check('export.GUI-MIDI-download-has-all-notes');
 await page.keyboard.press('Escape');
 const bundle=await download(()=>page.locator('#bundle-download').click(),'bundle.zip');const zip=await fs.readFile(bundle);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.includes(Buffer.from('.wav')));check('export.GUI-project-media-bundle-zip');

 // 6. CLI shares project, commands and render
 p=await proj();const cliMix=path.join(downloads,'cli-mix.wav');await cli('render',cliMix);
 const cliDecoded=decodeWav(await fs.readFile(cliMix));assert.equal(cliDecoded.frames,mix.frames);assert.equal(sha(Buffer.from(cliDecoded.channels[0].buffer)),sha(Buffer.from(mix.channels[0].buffer)));check('cli.render-matches-GUI-mix');
 await cmd('track.update',{trackId:midiTrack.id,name:'Lead (CLI)'});await page.waitForFunction(id=>document.querySelector(`.track-head[data-track-id="${id}"] .track-name`)?.textContent==='Lead (CLI)',midiTrack.id);
 await act(()=>page.locator('#undo').click());assert.equal((await proj()).tracks.find(t=>t.id===midiTrack.id).name,midiTrack.name);
 await act(()=>page.locator('#redo').click());assert.equal((await proj()).tracks.find(t=>t.id===midiTrack.id).name,'Lead (CLI)');check('cli.edit-appears-in-GUI-and-GUI-undo-redo-covers-it');

 // Explicit Save (Cmd/Ctrl+S) → stop server → restart → reopen
 await page.locator('#timeline-surface').click({position:{x:4,y:4}}).catch(()=>{});await page.locator('body').press('ControlOrMeta+s');
 await page.waitForFunction(()=>/저장 기준|저장했/.test(document.querySelector('#notice-text')?.textContent||''),null,{timeout:20000});
 const doc=await cli('document');summary.document=doc;const saved=await proj();
 await page.close();await session.close();session=await start();await openPage();
 const reopened=await proj();assert.deepEqual(reopened.tracks,saved.tracks);assert.deepEqual(reopened.clips,saved.clips);assert.deepEqual(reopened.assets,saved.assets);
 assert.equal(await page.locator('.track-head').count(),saved.tracks.length);assert.equal(await page.locator(".timeline-clip").count()>=saved.clips.length,true);check('project.explicit-save-restart-reopen-same-content');
 const hist=(await state()).historyView;summary.historyAfterRestart=hist?.entries?.length??hist?.length??null;
 await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent.includes('재생 중'),null,{timeout:60000});await page.locator('#stop').click();check('playback.after-restart');
 const again=path.join(downloads,'reopened-mix.wav');await cli('render',again);const againPcm=decodeWav(await fs.readFile(again));assert.equal(sha(Buffer.from(againPcm.channels[1].buffer)),sha(Buffer.from(mix.channels[1].buffer)));check('export.after-restart-identical-mix');
 // edit after reopen still works and undoes
 await page.locator(`.timeline-clip[data-clip-id="${midiClips[1].id}"]`).first().click({position:{x:12,y:8}});
 await page.locator(`#note-grid .midi-note`).first().click();await page.locator('#note-form input[name="velocity"]').fill('40');p=await act(()=>page.locator('#note-form button[type="submit"]').click());
 assert.ok(p.clips.find(c=>c.id===midiClips[1].id).notes.some(n=>n.velocity===40));p=await act(()=>page.locator('#undo').click());assert.ok(!p.clips.find(c=>c.id===midiClips[1].id).notes.some(n=>n.velocity===40));check('midi.edit-and-undo-after-restart');
 console.log(JSON.stringify(summary));
}catch(error){if(page){await page.screenshot({path:path.join(root,'.test-output/first-delivery-failure.png')}).catch(()=>{});summary.failureNotice=await page.locator('#notice-text').textContent().catch(()=>null);}throw error;}finally{
 await fs.writeFile(path.join(root,'.test-output/first-delivery-workflow.json'),JSON.stringify({tests,pageErrors,consoleErrors,httpErrors,summary,timings,dir},null,2));
 await browser.close();await session.close();
 if(!process.env.KEEP)await fs.rm(dir,{recursive:true,force:true});
}
assert.deepEqual(pageErrors,[]);
console.log(JSON.stringify({status:'passed',tests:tests.length}));
