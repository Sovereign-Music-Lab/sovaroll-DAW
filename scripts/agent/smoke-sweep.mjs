#!/usr/bin/env node
// Run every top-level GUI smoke sequentially and retain bounded machine-readable results.
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {ROOT,findPlaywright,run,writeJson} from './lib.mjs';

const playwright=await findPlaywright();
if(!playwright){
 console.error('SMOKE SWEEP BLOCKED: Playwright not found; set NEWDAW_PLAYWRIGHT_MODULE or install it externally.');
 process.exit(2);
}
const scriptsDir=path.join(ROOT,'scripts');
const names=(await fs.readdir(scriptsDir,{withFileTypes:true}))
 .filter(entry=>entry.isFile()&&/^gui-.*-smoke\.mjs$/.test(entry.name))
 .map(entry=>entry.name)
 .sort();
const output=path.join(ROOT,'.test-output','smoke-sweep.json'),results=[];
for(const name of names){
 const script=`scripts/${name}`,started=Date.now();
 console.log(`RUN ${script} (${results.length+1}/${names.length})`);
 const result=run(process.execPath,[path.join(ROOT,'scripts','agent','e2e.mjs'),script],{
  env:{...process.env,NEWDAW_PLAYWRIGHT_MODULE:playwright},timeout:5*60*1000,
 });
 const outputText=`${result.stdout}\n${result.stderr}`;
 const passed=result.status===0&&/(?:^|\n)E2E PASS(?:\n|$)/.test(result.stdout);
 const firstError=passed?null:(
  outputText.split('\n').find(line=>line.startsWith('FAIL:'))??
  outputText.split('\n').find(line=>/Error|expected|actual|at file|gui-.*smoke\.mjs:\d+/.test(line))??
  result.error??'Harness did not report E2E PASS'
 ).trim();
 const record={script,status:passed?'passed':'failed',ms:Date.now()-started,firstError};
 results.push(record);await writeJson(output,results);
 console.log(`${record.status==='passed'?'PASS':'FAIL'} ${script} (${record.ms} ms)${record.firstError?` — ${record.firstError}`:''}`);
}
const failed=results.filter(result=>result.status==='failed');
console.log(JSON.stringify({status:failed.length?'failed':'passed',scripts:results.length,passed:results.length-failed.length,failed:failed.length,output:path.relative(ROOT,output)}));
process.exitCode=failed.length?1:0;
