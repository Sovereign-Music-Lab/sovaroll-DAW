import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicWrite, acquireProjectLock } from '../src/storage.mjs';
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-storage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('concurrent no-clobber exports preserve exactly one complete output',async t=>{
 const dir=await temp(t),file=path.join(dir,'result.wav');const results=await Promise.allSettled([atomicWrite(file,'first',{noClobber:true}),atomicWrite(file,'second',{noClobber:true})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'EEXIST');assert.ok(['first','second'].includes(await fs.readFile(file,'utf8')));assert.deepEqual(await fs.readdir(dir),['result.wav']);
});
test('stale session recovery cannot delete a concurrently acquired replacement lock',async t=>{
 const dir=await temp(t),file=path.join(dir,'session.json');await fs.writeFile(file+'.lock',JSON.stringify({pid:2147483647,url:'old'}));const attempts=await Promise.allSettled([acquireProjectLock(file,'first'),acquireProjectLock(file,'second')]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);const lock=JSON.parse(await fs.readFile(file+'.lock','utf8'));assert.equal(lock.pid,process.pid);await attempts.find(r=>r.status==='fulfilled').value();assert.deepEqual(await fs.readdir(dir),[]);
});
test('a noncreating project lock refuses a missing parent without recreating it',async t=>{
 const dir=await temp(t),parent=path.join(dir,'missing','nested'),file=path.join(parent,'session.json');
 await assert.rejects(acquireProjectLock(file,'test',{createParent:false}),{code:'ENOENT'});assert.deepEqual(await fs.readdir(dir),[]);
 const release=await acquireProjectLock(file,'test');assert.ok((await fs.stat(file+'.lock')).isFile());await release();
 const next=await acquireProjectLock(file,'test',{createParent:false});await assert.rejects(acquireProjectLock(file,'other',{createParent:false}),/already open/);await next();assert.deepEqual(await fs.readdir(parent),[]);
});
