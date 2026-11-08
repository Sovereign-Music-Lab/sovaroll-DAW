import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {getControllerSettings as get,updateControllerSettings as update,withControllerDefaults} from '../src/controller-settings.mjs';
import {writeSidecar} from '../src/session-store.mjs';
const exec=promisify(execFile),moduleUrl=new URL('../src/controller-settings.mjs',import.meta.url).href;
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-controller-settings-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return{dir,file:path.join(dir,'profile','settings.json')};}
const guard=r=>({expectedRevision:r.settings.revision,expectedFingerprint:r.fingerprint});
const save=async(file,patch,options)=>update(file,{...guard(await get(file)),...patch},options);
const lanes=[{kind:'velocity',channel:'all'},{kind:'cc',channel:0,controller:11},{kind:'polyPressure',channel:3,pitch:64}];

test('controller settings: read and dry run never create profile directories',async t=>{
 const {dir,file}=await fixture(t),r=await get(file);assert.equal(r.status,'new');assert.equal(r.fingerprint,null);assert.equal(r.settings.visibleControllers.length,128);
 const dry=await save(file,{visibleControllers:[1,11],newEventType:'ramp',dryRun:true});assert.equal(dry.settings.revision,1);assert.equal(dry.applied,false);assert.deepEqual(await fs.readdir(dir),[]);
});
test('controller settings: menu and new type persist atomically and equal update is no-op',async t=>{
 const {file}=await fixture(t);const r=await save(file,{visibleControllers:[],newEventType:'ramp'}),bytes=await fs.readFile(file);assert.equal(r.settings.revision,1);assert.deepEqual((await get(file)).settings,r.settings);
 const same=await save(file,{visibleControllers:[],newEventType:'ramp'});assert.equal(same.status,'unchanged');assert.equal(same.fingerprint,r.fingerprint);assert.deepEqual(await fs.readFile(file),bytes);
});
test('controller settings: preset save rename load and delete preserve ordered descriptors',async t=>{
 const {file}=await fixture(t);let r=await save(file,{preset:{action:'save',name:'  악기 <CC>  ',lanes}});const id=r.settings.presets[0].id;assert.equal(r.settings.presets[0].name,'악기 <CC>');assert.deepEqual((await get(file)).settings.presets[0].lanes,lanes);
 r=await save(file,{preset:{action:'rename',id,name:'Dynamics'}});assert.equal(r.settings.presets[0].id,id);assert.deepEqual(r.settings.presets[0].lanes,lanes);
 r=await save(file,{preset:{action:'delete',id}});assert.deepEqual(r.settings.presets,[]);assert.equal(r.settings.revision,3);
});
test('controller settings: duplicate normalized names and missing preset IDs cannot overwrite',async t=>{
 const {file}=await fixture(t);await save(file,{preset:{action:'save',name:'é',lanes}});const bytes=await fs.readFile(file);
 await assert.rejects(save(file,{preset:{action:'save',name:' e\u0301 ',lanes}}),{code:'INVALID_CONTROLLER_SETTINGS'});
 await assert.rejects(save(file,{preset:{action:'delete',id:randomUUID()}}),{code:'CONTROLLER_PRESET_NOT_FOUND'});assert.deepEqual(await fs.readFile(file),bytes);
});
test('controller settings: invalid schema and limits reject before filesystem changes',async t=>{
 const {dir,file}=await fixture(t);
 for(const patch of [{visibleControllers:[1,1]},{visibleControllers:[128]},{visibleControllers:[11,1]},{visibleControllers:[1.5]},{visibleControllers:null},{newEventType:'bezier'},{preset:{action:'save',name:'x',lanes:[]}},{preset:{action:'save',name:'x',lanes:Array(65).fill(lanes[0])}},{preset:{action:'save',name:'x',lanes:[{kind:'cc',channel:16,controller:1}]}},{preset:{action:'save',name:'x',lanes:[{...lanes[0],height:100}]}},{preset:{action:'save',name:'\n',lanes}},{other:true}])await assert.rejects(save(file,patch));
 assert.deepEqual(await fs.readdir(dir),[]);
});
test('controller settings: stale revision and same-revision fingerprint changes reject',async t=>{
 const {file}=await fixture(t);const old=await get(file);await save(file,{visibleControllers:[1]});await assert.rejects(update(file,{...guard(old),newEventType:'ramp'}),{code:'CONTROLLER_SETTINGS_CONFLICT'});
 const prior=await get(file);await fs.appendFile(file,' ');await assert.rejects(update(file,{...guard(prior),newEventType:'ramp'}),{code:'CONTROLLER_SETTINGS_CONFLICT'});assert.equal((await get(file)).settings.newEventType,'step');
});
test('controller settings: corrupt profile and symlink files are preserved',async t=>{
 const {dir,file}=await fixture(t);await fs.mkdir(path.dirname(file));await fs.writeFile(file,'broken');await assert.rejects(get(file),{code:'INVALID_CONTROLLER_SETTINGS'});await assert.rejects(update(file,{expectedRevision:0,expectedFingerprint:null,newEventType:'ramp'}));assert.equal(await fs.readFile(file,'utf8'),'broken');
 const target=path.join(dir,'target');await fs.writeFile(target,'private');await fs.unlink(file);await fs.symlink(target,file);await assert.rejects(get(file),{code:'UNSAFE_PATH'});assert.equal(await fs.readFile(target,'utf8'),'private');
});
test('controller settings: concurrent in-process CAS has exactly one winner',async t=>{
 const {file}=await fixture(t),g=guard(await get(file));const results=await Promise.allSettled([update(file,{...g,visibleControllers:[1]}),update(file,{...g,visibleControllers:[11]})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CONTROLLER_SETTINGS_CONFLICT');assert.equal((await get(file)).settings.revision,1);
});
test('controller settings: independent processes share the lock and CAS',async t=>{
 const {file}=await fixture(t),g=guard(await get(file));
 const child=controller=>exec(process.execPath,['--input-type=module','-e',`import {updateControllerSettings} from ${JSON.stringify(moduleUrl)};try {let r=await updateControllerSettings(${JSON.stringify(file)},${JSON.stringify({...g,visibleControllers:[controller]})});console.log(JSON.stringify({ok:true,revision:r.settings.revision}));}catch(e){console.log(JSON.stringify({ok:false,code:e.code}));}`]);
 const results=(await Promise.all([child(1),child(11)])).map(r=>JSON.parse(r.stdout));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'CONTROLLER_SETTINGS_CONFLICT');assert.equal((await get(file)).settings.revision,1);
});
test('controller settings: writer failure rolls back while post-commit warning is honest',async t=>{
 const {file}=await fixture(t);await save(file,{visibleControllers:[1]});const bytes=await fs.readFile(file);
 await assert.rejects(save(file,{newEventType:'ramp'},{writeSettings:async()=>{throw new Error('disk failed');}}),/disk failed/);assert.deepEqual(await fs.readFile(file),bytes);
 const result=await save(file,{newEventType:'ramp'},{writeSettings:async(...args)=>{await writeSidecar(...args);throw new Error('after commit');}});assert.equal(result.applied,true);assert.equal(result.warnings[0].code,'CONTROLLER_SETTINGS_COMMITTED_WITH_WARNING');assert.equal((await get(file)).settings.newEventType,'ramp');
});
test('controller settings: live lock times out without replacing owner',async t=>{
 const {file}=await fixture(t);await save(file,{visibleControllers:[1]});const owner={pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()};await fs.mkdir(file+'.lock');await fs.writeFile(path.join(file+'.lock','owner.json'),JSON.stringify(owner));await assert.rejects(save(file,{newEventType:'ramp'},{lockTimeoutMs:50}),{code:'CONTROLLER_SETTINGS_LOCKED'});assert.deepEqual(JSON.parse(await fs.readFile(path.join(file+'.lock','owner.json'))),owner);
});
test('controller settings: dead lock is reclaimed but unknown stale lock contents survive',async t=>{
 const {file}=await fixture(t);await save(file,{visibleControllers:[1]});const {stdout}=await exec(process.execPath,['-p','process.pid']),pid=Number(stdout);
 const lock=async()=>{await fs.mkdir(file+'.lock');await fs.writeFile(path.join(file+'.lock','owner.json'),JSON.stringify({pid,token:randomUUID(),createdAt:new Date().toISOString()}));};
 await lock();await save(file,{newEventType:'ramp'});await assert.rejects(fs.stat(file+'.lock'),{code:'ENOENT'});
 await lock();await fs.writeFile(path.join(file+'.lock','unknown'),'preserve');await assert.rejects(save(file,{newEventType:'step'}),{code:'INVALID_CONTROLLER_LOCK'});assert.equal(await fs.readFile(path.join(file+'.lock','unknown'),'utf8'),'preserve');
});
test('controller settings: defaults resolve one batch and preserve explicit/raw/clipboard values',async t=>{
 const {file}=await fixture(t);await save(file,{newEventType:'ramp'});const implicit={command:'midi.controllers.draw',arguments:{clipId:'x',lane:{kind:'cc',channel:0,controller:64},points:[{tick:0,value:0}]}};
 const explicit=structuredClone(implicit);explicit.arguments.curve=null;
 const batch={command:'batch',arguments:{commands:[implicit,explicit,{command:'midi.events.add',arguments:{events:[]}},{command:'midi.controllers.paste',arguments:{events:[]}}]}};
 const result=await withControllerDefaults(batch,file);assert.deepEqual(result.arguments.commands[0].arguments.curve,{type:'ramp'});assert.equal(result.arguments.commands[1].arguments.curve,null);assert.deepEqual(result.arguments.commands.slice(2),batch.arguments.commands.slice(2));assert.equal(Object.hasOwn(implicit.arguments,'curve'),false);
 const program=structuredClone(implicit);program.arguments.lane={kind:'program',channel:0};assert.equal(await withControllerDefaults(program,file),program);
});
test('controller settings: explicit commands do not depend on a corrupt default profile',async t=>{
 const {file}=await fixture(t);await fs.mkdir(path.dirname(file));await fs.writeFile(file,'bad');const explicit={command:'midi.controllers.draw',arguments:{lane:{kind:'cc'},curve:null}};assert.equal(await withControllerDefaults(explicit,file),explicit);await assert.rejects(withControllerDefaults({...explicit,arguments:{lane:{kind:'cc'}}},file),{code:'INVALID_CONTROLLER_SETTINGS'});
});
