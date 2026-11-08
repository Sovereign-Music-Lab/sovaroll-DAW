import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {parseMidi} from '../src/media/midi.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..'),route='/api/workspace/controller-settings';
const guard=r=>({expectedRevision:r.settings.revision,expectedFingerprint:r.fingerprint});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-controller-settings-http-')),projectPath=path.join(dir,'A.newdaw.json'),recentPath=path.join(dir,'recent.json');let s=await startServer({projectPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});t.after(async()=>{await s.close();await fs.rm(dir,{recursive:true,force:true});});return{dir,projectPath,recentPath,get url(){return s.url;},async restart(){await s.close();s=await startServer({projectPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});}};}
async function get(s,p='/api/state'){const r=await fetch(s.url+p);assert.equal(r.status,200);return r.json();}
async function post(s,p,data){const r=await fetch(s.url+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return{status:r.status,body:await r.json()};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const cli=async(s,...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:20000})).stdout);
async function cmd(s,command,args={},extra={}){const before=await get(s);return ok(await post(s,'/api/command',{command,arguments:args,expectedRevision:before.project.revision,...extra}));}
async function seed(s){await cmd(s,'track.add',{id:'track',type:'midi',name:'Controllers'});await cmd(s,'clip.add',{id:'clip',trackId:'track',type:'midi',name:'CC',lengthTicks:1920,notes:[],events:[]});}
const draw=(points,extra={})=>({clipId:'clip',lane:{kind:'cc',channel:0,controller:11},points,...extra});
const clip=s=>s.project.clips.find(c=>c.id==='clip');

test('controller preferences HTTP/CLI: read dry-run save and restart leave project history untouched',async t=>{
 const s=await fixture(t);await seed(s);const before=await get(s),bytes=await fs.readFile(s.projectPath),initial=await cli(s,'controller-settings');
 const payload={...guard(initial),visibleControllers:[1,11],newEventType:'ramp',preset:{action:'save',name:'Expression',lanes:[{kind:'cc',channel:0,controller:11}]}};
 const dry=await cli(s,'controller-settings',JSON.stringify(payload),'--dry-run');assert.equal(dry.status,'validated');assert.equal((await get(s,route)).settings.revision,0);
 const saved=await cli(s,'controller-settings',JSON.stringify(payload));assert.equal(saved.settings.newEventType,'ramp');const after=await get(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
 await s.restart();assert.deepEqual((await cli(s,'controller-settings')).settings,saved.settings);assert.deepEqual((await get(s)).project,before.project);
});
test('controller preferences HTTP/CLI: stale CAS and invalid fields preserve saved profile',async t=>{
 const s=await fixture(t),r=await get(s,route);ok(await post(s,route,{...guard(r),visibleControllers:[11]}));let result=await post(s,route,{...guard(r),newEventType:'ramp'});assert.equal(result.status,409);assert.equal(result.body.errors[0].code,'CONTROLLER_SETTINGS_CONFLICT');
 const before=await get(s,route);result=await post(s,route,{...guard(before),visibleControllers:[1],unknown:true});assert.equal(result.status,422);assert.deepEqual(await get(s,route),before);
 await assert.rejects(cli(s,'controller-settings',JSON.stringify({newEventType:'ramp'})),/INVALID_CONTROLLER_UPDATE/);
});
test('controller preferences HTTP/CLI: same profile shared across servers and settings SSE notifies clients',async t=>{
 const a=await fixture(t),b=await startServer({projectPath:path.join(a.dir,'B.newdaw.json'),recentPath:a.recentPath,port:0,demo:false,quiet:true,backupPollMs:60000});t.after(()=>b.close());
 const abort=new AbortController();t.after(()=>abort.abort());const stream=await fetch(a.url+'/api/events',{signal:abort.signal}),reader=stream.body.getReader();let output='';const listen=(async()=>{for(;;){const r=await reader.read();if(r.done)return;output+=new TextDecoder().decode(r.value);if(output.includes('event: controller-settings'))return;}})();
 const old=await get(a,route);const saved=ok(await post(a,route,{...guard(old),visibleControllers:[7,11]}));await listen;assert.match(output,/event: controller-settings/);abort.abort();assert.deepEqual((await get(b,route)).settings,saved.settings);
 const stale=await post(b,route,{...guard(old),visibleControllers:[64]});assert.equal(stale.status,409);
});
test('controller preferences HTTP/CLI: implicit ramp edits incoming segment and exports intermediate CC',async t=>{
 const s=await fixture(t);await seed(s);await cmd(s,'midi.controllers.draw',draw([{tick:0,value:10}],{curve:null}));const profile=await get(s,route);ok(await post(s,route,{...guard(profile),newEventType:'ramp'}));
 await cli(s,'command','midi.controllers.draw',JSON.stringify(draw([{tick:960,value:110}])));const state=await get(s),events=clip(state).events;assert.equal(events[0].curve.type,'ramp');assert.equal(events[1].curve,undefined);
 // Inspect the exported file through a separate import path and analytically check its held value at the midpoint.
 const response=await fetch(s.url+'/api/export/midi');assert.equal(response.status,200);const bytes=new Uint8Array(await response.arrayBuffer());const parsed=parseMidi(bytes);const exported=parsed.tracks.flatMap(t=>t.events).filter(e=>e.kind==='channel'&&e.status===0xb0&&e.data[0]===11).sort((a,b)=>a.tick-b.tick);assert.equal(exported[0].data[1],10);assert.equal(exported.at(-1).data[1],110);assert.equal(exported.filter(e=>e.tick<=480).at(-1).data[1],60);assert.ok(exported.length>2);
 const before=structuredClone(events);await cmd(s,'history.undo');assert.equal(clip(await get(s)).events.length,1);await cmd(s,'history.redo');assert.deepEqual(clip(await get(s)).events,before);
 await s.restart();assert.deepEqual(clip(await get(s)).events,before);
});
test('controller preferences HTTP/CLI: explicit Step overrides Ramp and preference changes do not rewrite events',async t=>{
 const s=await fixture(t);await seed(s);const initial=await get(s,route);ok(await post(s,route,{...guard(initial),newEventType:'ramp'}));await cmd(s,'midi.controllers.draw',draw([{tick:0,value:20},{tick:960,value:100}],{curve:null}));assert.equal(clip(await get(s)).events[0].curve,undefined);
 const before=await get(s),r=await get(s,route);ok(await post(s,route,{...guard(r),newEventType:'step',visibleControllers:[]}));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);
});
test('controller preferences HTTP/CLI: implicit batch dry-run and invalid batch remain atomic',async t=>{
 const s=await fixture(t);await seed(s);const r=await get(s,route);ok(await post(s,route,{...guard(r),newEventType:'ramp'}));const before=await get(s),commands=[{command:'midi.controllers.draw',arguments:draw([{tick:0,value:0},{tick:480,value:100}])},{command:'midi.controllers.line',arguments:{clipId:'clip',lane:{kind:'pitchBend',channel:0},startTick:0,endTick:480,startValue:8192,endValue:12288,stepTicks:240}}];
 const dry=await cmd(s,'batch',{commands},{dryRun:true});assert.equal(dry.applied,false);assert.deepEqual((await get(s)).project,before.project);
 const bad=await post(s,'/api/command',{command:'batch',arguments:{commands:[...commands,{command:'midi.controllers.draw',arguments:draw([{tick:9999,value:1}])}]},expectedRevision:before.project.revision});assert.equal(bad.status,422);assert.equal(bad.body.applied,false);assert.deepEqual((await get(s)).project,before.project);
 await cmd(s,'batch',{commands});const events=clip(await get(s)).events;assert.equal(events.find(e=>e.tick===0&&e.status===0xb0).curve.type,'ramp');assert.equal(events.find(e=>e.tick===0&&e.status===0xe0).curve.type,'ramp');
});

test('controller preferences HTTP/CLI: Paint uses shared Ramp default within range and explicit Step wins',async t=>{
 const s=await fixture(t);await seed(s);const r=await get(s,route);ok(await post(s,route,{...guard(r),newEventType:'ramp'}));
 const args={...draw([{tick:240,value:20},{tick:720,value:100}]),startTick:240,endTick:720};
 await cli(s,'command','midi.controllers.paint',JSON.stringify(args));
 assert.equal(clip(await get(s)).events.find(e=>e.tick===240).curve.type,'ramp');
 assert.equal(clip(await get(s)).events.find(e=>e.tick===720).curve,undefined);
 const bytes=new Uint8Array(await (await fetch(s.url+'/api/export/midi')).arrayBuffer()),events=parseMidi(bytes).tracks.flatMap(t=>t.events).filter(e=>e.status===176&&e.data[0]===11).sort((a,b)=>a.tick-b.tick);
 assert.equal(events.filter(e=>e.tick<=480).at(-1).data[1],60);
 await cmd(s,'history.undo');assert.equal(clip(await get(s)).events.length,0);
 await cmd(s,'midi.controllers.paint',{...args,curve:null});assert.equal(clip(await get(s)).events.find(e=>e.tick===240).curve,undefined);
});
