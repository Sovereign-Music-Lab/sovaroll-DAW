#!/usr/bin/env node
// Source-derived inventory metrics. These dimensions are intentionally not summed as "features".
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const ROOT=path.resolve(import.meta.dirname,'..');
const unique=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b));
const matches=(text,regex)=>{const values=[];for(const match of text.matchAll(regex))values.push(match[1]);return unique(values);};
async function filesBelow(directory,suffix){const result=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())result.push(...await filesBelow(file,suffix));else if(entry.name.endsWith(suffix))result.push(file);}return result;}
async function read(root,file){return fs.readFile(path.join(root,file),'utf8');}
export async function buildFeatureInventory(root=ROOT){
 const schema=await read(root,'src/core/schema.mjs'),server=await read(root,'src/server.mjs'),requirements=await read(root,'docs/agent/REQUIREMENTS.md');
 const engineCommands=matches(schema,/^\s*\['([a-z][A-Za-z0-9.]+)'/gm);
 const apiRouteStrings=matches(server,/["'`](\/api\/[A-Za-z0-9/_-]+)["'`]/g);
 const nativeFiles=['native/macos/midi-bridge.swift','native/macos/audio-bridge.swift','native/macos/audio-units.swift'];
 const nativeHelperCommands={};for(const file of nativeFiles)nativeHelperCommands[path.basename(file,'.swift')]=matches(await read(root,file),/command\s*==\s*"([^"]+)"/g);
 const publicFiles=['public/index.html',...(await filesBelow(path.join(root,'public'),'.mjs')).map(file=>path.relative(root,file))];
 const uiControlIds={};for(const file of publicFiles)uiControlIds[file]=matches(await read(root,file),/\bid=(?:\\?"|\\?')([A-Za-z][A-Za-z0-9_:-]*)(?:\\?"|\\?')/g);
 const testFiles=(await filesBelow(path.join(root,'tests'),'.test.mjs')).map(file=>path.relative(root,file));
 const nativeTestFiles=(await filesBelow(path.join(root,'native/tests'),'.test.mjs')).map(file=>path.relative(root,file));
 const declaredProductTests={},declaredNativeTests={};for(const file of testFiles)declaredProductTests[file]=matches(await read(root,file),/\btest\s*\(\s*['"`]([^'"`]+)['"`]/g);for(const file of nativeTestFiles)declaredNativeTests[file]=matches(await read(root,file),/\btest\s*\(\s*['"`]([^'"`]+)['"`]/g);
 const guiFiles=(await filesBelow(path.join(root,'scripts'),'.mjs')).filter(file=>path.basename(file).startsWith('gui-')).map(file=>path.relative(root,file));
 const guiCheckIds={};for(const file of guiFiles)guiCheckIds[file]=matches(await read(root,file),/\bcheck\(\s*['"`]([^'"`]+)['"`]/g);
 const acceptanceIds=matches(requirements,/\b(FD-\d{2})\b/g);
 const metric=(file,values)=>({file,count:values.length,values});
 return {
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  featureCatalog2500:{status:'not-verified-no-source-catalogue',verified:false,source:null,note:'No 2500-item source feature catalogue exists in this repository. Do not sum these metrics as feature coverage.'},
  acceptanceIds:{count:acceptanceIds.length,values:acceptanceIds},
  metrics:{
   engineCommands:metric('src/core/schema.mjs',engineCommands),
   apiRouteStrings:metric('src/server.mjs',apiRouteStrings),
   nativeHelperCommands:{count:Object.values(nativeHelperCommands).reduce((sum,values)=>sum+values.length,0),files:nativeHelperCommands},
   uiControlIds:{count:Object.values(uiControlIds).reduce((sum,values)=>sum+values.length,0),note:'Literal IDs per source file; duplicates across files and non-control IDs may exist.',files:uiControlIds},
   declaredProductTests:{fileCount:testFiles.length,count:Object.values(declaredProductTests).reduce((sum,values)=>sum+values.length,0),files:declaredProductTests},
   declaredNativeTests:{fileCount:nativeTestFiles.length,count:Object.values(declaredNativeTests).reduce((sum,values)=>sum+values.length,0),files:declaredNativeTests},
   guiCheckIds:{fileCount:guiFiles.length,count:Object.values(guiCheckIds).reduce((sum,values)=>sum+values.length,0),note:'Declared check IDs; a script may execute them conditionally.',files:guiCheckIds}
  }
 };
}
async function main(){
 const inventory=await buildFeatureInventory();const target=path.join(ROOT,'.test-output','feature-inventory.json');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(inventory,null,2)+'\n');
 console.log(JSON.stringify({output:path.relative(ROOT,target),featureCatalog2500:inventory.featureCatalog2500.status,acceptanceIds:inventory.acceptanceIds.count,...Object.fromEntries(Object.entries(inventory.metrics).map(([key,value])=>[key,value.count]))},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
