import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await walk(p);else if(entry.name.endsWith('.mjs'))files.push(p);}}
for(const dir of ['src','public','tests','scripts','native'])await walk(dir);
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
