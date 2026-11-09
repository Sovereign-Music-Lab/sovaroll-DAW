// Automatic-backup recovery: GUI backup, CLI independent recovery, GUI open. Temporary files only.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/newdaw-auto-backup-recovery-'));
const projectPath=path.join(dir,'Original.newdaw.json'),recoveredPath=path.join(dir,'Recovered','Recovered.newdaw.json'),recentPath=path.join(dir,'.recent.json');
const session=await startServer({projectPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:600000});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:1100}}),tests=[],pageErrors=[];
page.setDefaultTimeout(25000);page.on('pageerror',error=>pageErrors.push(error.message));
const check=id=>{tests.push(id);console.log(`PASS ${id}`);};
const get=async(route='/api/state')=>{const response=await fetch(session.url+route);assert.equal(response.status,200);return response.json();};
const cli=async(...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args],{cwd:root,timeout:25000})).stdout);
const action=async(work,route)=>{
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname===route&&response.request().method()==='POST').then(async response=>({status:response.status(),body:await response.json()}));
 await work();return pending;
};
const waitState=async()=>{
 const current=await get();
 await page.waitForFunction(value=>document.querySelector('#project-name')?.value===value.name&&Number(document.querySelector('#revision-label')?.textContent.match(/\d+/)?.[0])===value.revision,current.project);
 return current;
};
const openLibrary=async()=>{await page.locator('#projects-button').click();await page.waitForFunction(()=>document.querySelector('#projects-dialog')?.open&&!document.querySelector('#projects-preview').disabled);};
try{
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#empty-add').disabled);
 let response=await action(()=>page.locator('#empty-add').click(),'/api/command');assert.equal(response.status,200,JSON.stringify(response.body));
 let current=await waitState();const trackId=current.project.tracks[0].id,clipId=current.project.clips[0].id,originalName=current.project.name;
 assert.equal(current.project.tracks.length,1);check('project.GUI-original-track-created-for-backup');

 await page.locator('#backups-button').click();await page.waitForFunction(()=>document.querySelector('#backups-dialog')?.open&&!document.querySelector('#backup-now').disabled);
 response=await action(()=>page.locator('#backup-now').click(),'/api/backups/create');
 assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.status,'created');
 const backupId=response.body.id;assert.ok(backupId);await page.waitForSelector('#backup-list a');
 const backup=await(await fetch(session.url+`/api/backups/${encodeURIComponent(backupId)}/file`)).json();
 assert.equal(backup.name,originalName);assert.equal(backup.tracks[0].id,trackId);assert.equal(backup.clips[0].id,clipId);check('project.GUI-auto-backup-created-and-listed');

 await cli('command','project.rename',JSON.stringify({name:'Changed after backup'}),'--url',session.url);await waitState();
 const beforeRecovery=await fs.readFile(projectPath,'utf8');
 const recovered=await cli('recover-backup',projectPath,backupId,'--output',recoveredPath);
 assert.equal(recovered.status,'recovered');assert.equal(recovered.projectFile,recoveredPath);
 assert.equal(await fs.readFile(projectPath,'utf8'),beforeRecovery);
 const recoveredDisk=JSON.parse(await fs.readFile(recoveredPath,'utf8'));assert.equal(recoveredDisk.name,originalName);assert.equal(recoveredDisk.tracks[0].id,trackId);
 check('project.CLI-backup-recovery-creates-independent-preserved-project');

 await page.locator('#backups-dialog [data-close-dialog]').click();await page.waitForFunction(()=>!document.querySelector('#backups-dialog').open);
 await openLibrary();await page.locator('#projects-path').fill(recoveredPath);
 response=await action(()=>page.locator('#projects-preview').click(),'/api/workspace/open/plan');assert.equal(response.status,200,JSON.stringify(response.body));
 if(await page.locator('#projects-current-policy').isVisible())await page.locator('#projects-current-policy').selectOption('preserve');
 response=await action(()=>page.locator('#projects-open').click(),'/api/workspace/open');assert.equal(response.status,200,JSON.stringify(response.body));
 await page.waitForFunction(()=>!document.querySelector('#projects-dialog').open);current=await waitState();
 assert.equal(current.session.document.projectPath,recoveredPath);assert.equal(current.project.name,originalName);
 assert.equal(current.project.tracks[0].id,trackId);assert.equal(current.project.clips[0].id,clipId);assert.equal(current.project.tracks.length,1);
 assert.deepEqual(pageErrors,[]);check('project.GUI-recovered-backup-opens-with-original-track');
 console.log(JSON.stringify({status:'passed',tests:tests.length}));
}catch(error){
 await page.screenshot({path:path.join(root,'.test-output/auto-backup-recovery-failure.png')}).catch(()=>{});throw error;
}finally{
 await browser.close();await session.close();if(!process.env.KEEP)await fs.rm(dir,{recursive:true,force:true});
}
