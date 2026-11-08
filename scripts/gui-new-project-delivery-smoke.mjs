// GUI new-project and first-save delivery flow. All project files stay in one temporary folder.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/newdaw-new-project-delivery-'));
const initialPath=path.join(dir,'Existing.newdaw.json'),recentPath=path.join(dir,'.recent.json');
const newFolder=path.join(dir,'Untitled Workspace'),namedFolder=path.join(dir,'Named'),savedPath=path.join(namedFolder,'First Song.newdaw.json');
await exec(process.execPath,['src/cli.mjs','init',initialPath],{cwd:root,timeout:25000});
let session=await startServer({projectPath:initialPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:600000});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1512,height:1180}}),page=await context.newPage(),tests=[],pageErrors=[];
page.setDefaultTimeout(25000);page.on('pageerror',error=>pageErrors.push(error.message));
const check=id=>{tests.push(id);console.log(`PASS ${id}`);};
const get=async(route='/api/state')=>{const response=await fetch(session.url+route);assert.equal(response.status,200);return response.json();};
const action=async(work,route)=>{
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname===route&&response.request().method()==='POST').then(async response=>({status:response.status(),body:await response.json()}));
 await work();return pending;
};
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.body));return response.body;};
const waitState=async()=>{
 const current=await get();
 await page.waitForFunction(value=>document.querySelector('#project-name')?.value===value.name&&Number(document.querySelector('#revision-label')?.textContent.match(/\d+/)?.[0])===value.revision,current.project);
 return current;
};
const ready=()=>page.waitForFunction(()=>document.querySelector('#projects-preview')&&!document.querySelector('#projects-preview').disabled);
const openLibrary=async()=>{if(!await page.locator('#projects-dialog').evaluate(element=>element.open))await page.locator('#projects-button').click();await ready();};
try{
 const initialBytes=await fs.readFile(initialPath);
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#projects-button').disabled);
 await openLibrary();
 if(!await page.locator('.projects-new').evaluate(element=>element.open))await page.locator('#projects-new-toggle').click();
 if(!await page.locator('.projects-direct-location').evaluate(element=>element.open))await page.locator('#projects-direct-toggle').click();
 await page.locator('#projects-use-direct-path').check();await page.locator('#projects-new-folder').fill(newFolder);
 await page.locator('#projects-new-rate').fill('48000');await page.locator('#projects-new-mode').selectOption('active');
 const plan=ok(await action(()=>page.locator('#projects-new-preview').click(),'/api/workspace/new/plan'));await ready();
 assert.match(plan.target.name,/^Untitled\d+$/);
 ok(await action(()=>page.locator('#projects-open').click(),'/api/workspace/new'));
 await page.waitForFunction(()=>!document.querySelector('#projects-dialog').open);
 let current=await waitState();
 assert.equal(current.session.document.neverSaved,true);assert.equal(current.session.document.projectPath,null);
 assert.equal(current.project.tracks.length,0);assert.equal(current.project.sampleRate,48000);
 assert.deepEqual(await fs.readFile(initialPath),initialBytes);check('project.GUI-create-new-Untitled');

 ok(await action(()=>page.locator('#empty-add').click(),'/api/command'));current=await waitState();
 assert.equal(current.project.tracks.length,1);assert.equal(current.project.tracks[0].type,'midi');
 assert.equal(current.project.clips.length,1);assert.equal(current.project.clips[0].trackId,current.project.tracks[0].id);
 const trackId=current.project.tracks[0].id;check('project.GUI-add-first-MIDI-track');

 await fs.mkdir(namedFolder);
 await page.locator('#timeline-scroll').focus();await page.keyboard.press('ControlOrMeta+s');
 await page.waitForFunction(()=>document.querySelector('#document-dialog')?.open&&!document.querySelector('#document-save-as').disabled);
 await page.locator('#document-output').fill(savedPath);
 ok(await action(()=>page.locator('#document-save-as').click(),'/api/document/save-as'));current=await waitState();
 assert.equal(current.session.document.neverSaved,false);assert.equal(current.session.document.projectPath,savedPath);
 assert.equal(current.session.document.dirty,false);assert.equal(current.project.tracks[0].id,trackId);
 const savedProject=JSON.parse(await fs.readFile(savedPath,'utf8'));assert.equal(savedProject.tracks[0].id,trackId);
 assert.deepEqual(await fs.readFile(initialPath),initialBytes);check('project.GUI-first-save-as-named-project');

 await session.close();session=await startServer({projectPath:savedPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:600000});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#projects-button').disabled);current=await waitState();
 assert.equal(current.session.document.projectPath,savedPath);assert.equal(current.project.tracks.length,1);
 assert.equal(current.project.tracks[0].id,trackId);assert.equal(current.project.clips.length,1);
 assert.deepEqual(await fs.readFile(initialPath),initialBytes);check('project.restart-reopens-first-saved-track');

 assert.deepEqual(pageErrors,[]);console.log(JSON.stringify({status:'passed',tests:tests.length}));
}catch(error){
 await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});
 console.error(`FAILED after ${tests.length} checks:`,error);throw error;
}finally{
 await browser.close();await session.close();
 if(!process.env.KEEP)await fs.rm(dir,{recursive:true,force:true});
}
