import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),binary=path.join(root,'.native-build/newdaw-audio-units'),exec=promisify(execFile);
before(async()=>{await exec(process.execPath,['scripts/build-native-audio-units.mjs'],{cwd:root,timeout:120000});});
async function helper(t){
 const child=spawn(binary,[],{stdio:['pipe','pipe','pipe']});let input='',events=[],waiters=[];
 child.stdout.on('data',bytes=>{input+=bytes.toString();while(input.includes('\n')){const index=input.indexOf('\n'),line=input.slice(0,index);input=input.slice(index+1);const event=JSON.parse(line);events.push(event);for(const waiter of [...waiters])if(waiter.predicate(event)){events.splice(events.indexOf(event),1);waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(event);}}});
 child.on('error',error=>{for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}});
 const next=(predicate,timeout=10000)=>{const index=events.findIndex(predicate);if(index>=0)return Promise.resolve(events.splice(index,1)[0]);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Audio Unit helper event timeout'));},timeout)};waiters.push(waiter);});};
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 t.after(async()=>{if(child.exitCode===null){send({command:'quit'});await new Promise(resolve=>child.once('exit',resolve));}});
 return {send,next};
}
test('Audio Unit discovery returns bounded metadata without instantiation',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list',limit:1});
 const list=await h.next(event=>event.event==='list');assert.ok(list.count<=1);assert.ok(list.availableCount>=list.count);assert.equal(list.instantiated,false);
 for(const component of list.components){assert.equal(typeof component.id,'string');assert.equal(typeof component.name,'string');assert.equal(typeof component.manufacturer,'string');assert.equal(component.instantiated,false);}
 h.send({command:'status'});const status=await h.next(event=>event.event==='status');assert.equal(status.instantiated,false);assert.equal(status.selected,null);
});

test('Audio Unit selection validates identity and never instantiates plugin code',async t=>{
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list'});
 const list=await h.next(event=>event.event==='list');h.send({command:'select',id:'not-present'});const missing=await h.next(event=>event.event==='error');assert.equal(missing.code,'AUDIO_UNIT_NOT_FOUND');
 h.send({command:'list',limit:0});const invalid=await h.next(event=>event.event==='error');assert.equal(invalid.code,'INVALID_LIMIT');
 if(list.count>0){
  const id=list.components[0].id;h.send({command:'select',id});const selected=await h.next(event=>event.event==='selected');assert.equal(selected.instantiated,false);assert.equal(selected.component.id,id);
  h.send({command:'status'});const status=await h.next(event=>event.event==='status');assert.equal(status.selected,id);assert.equal(status.instantiated,false);
 }else assert.equal(list.availableCount,0,'An empty host still exposes safe discovery without executing plugin code');
});

test('Audio Unit offline instantiation requires explicit intent and releases the exact component',async t=>{
 const fourCC=value=>[...value].reduce((result,char)=>(result*256+char.charCodeAt(0))>>>0,0);
 const h=await helper(t);await h.next(event=>event.event==='ready');h.send({command:'list'});
 const list=await h.next(event=>event.event==='list'),effect=list.components.find(component=>component.type===fourCC('aufx'));
 h.send({command:'instantiate',id:'not-present',offline:true});const missing=await h.next(event=>event.event==='error');assert.equal(missing.code,'AUDIO_UNIT_NOT_FOUND');
 const id=effect?.id??'not-present';h.send({command:'instantiate',id,offline:false});const offline=await h.next(event=>event.event==='error');assert.equal(offline.code,'OFFLINE_REQUIRED');
 if(effect){
  h.send({command:'instantiate',id:effect.id,offline:true});const result=await h.next(event=>['instantiated','error'].includes(event.event));
  if(result.event==='error'){
   assert.equal(result.code,'INSTANTIATION_FAILED');assert.ok(result.message);console.log(JSON.stringify({status:'environment-limited',code:result.code,message:result.message}));
  }else{
   assert.equal(result.component.id,effect.id);assert.equal(result.offline,true);assert.ok(result.inputChannels>0);assert.ok(result.outputChannels>0);
   h.send({command:'status'});const active=await h.next(event=>event.event==='status');assert.equal(active.instantiated,true);
   h.send({command:'release'});await h.next(event=>event.event==='released');h.send({command:'status'});const released=await h.next(event=>event.event==='status');assert.equal(released.instantiated,false);
  }
 }else console.log(JSON.stringify({status:'environment-limited',reason:'No effect Audio Unit discovered'}));
});
