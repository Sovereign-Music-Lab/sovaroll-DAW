import {MAX_WAV_FILE_BYTES} from './media/asset-limits.mjs';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {readBackup} from './auto-backup.mjs';
import { validateProject } from './core/engine.mjs';
import { atomicWrite, createDirectoryAtomically } from './storage.mjs';
import { decodeWav } from './media/wav.mjs';

// Project collection and media integrity.
// Collection never trims, deletes or bakes sources.
export const MAX_BUNDLE_BYTES=64*1024*1024;
const MAX_PROJECT_BYTES=16*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const error=(code,message,details)=>Object.assign(new Error(message),{code,status:422,...(details?{details}:{} )});

async function requireAbsent(filename) {
  try {await fs.lstat(filename);}
  catch(e){if(e.code==='ENOENT')return;throw e;}
  throw error('OUTPUT_EXISTS',`Output already exists: ${filename}`);
}

function managedPath(asset,sourceArchive=false) {
  if(sourceArchive){const match=asset.path?.match(/^sources\/([a-f0-9]{64})\.(aiff|aifc)$/);if(!match||match[1]!==asset.sha256)throw error('INVALID_ASSET_PATH','Invalid source archive content address.');return asset.path;}
  const match=typeof asset?.path==='string'&&asset.path.match(/^assets\/([a-f0-9]{64})\.wav$/);
  if(!match||match[1]!==asset.sha256)throw error('INVALID_ASSET_PATH',`Asset ${asset?.name??asset?.id??'unknown'} is not in the managed content-addressed WAV store.`);
  return asset.path;
}

/** A bounded, streaming hash check. Refuse symlinked stores/files rather than
 * letting a local HTTP media query follow an arbitrary filesystem reference. */
async function scanAsset(directory,asset,{destination,includeBytes=false,maxBytes=Infinity,allowMismatch=false,sourceArchive=false}={}) {
  const relative=managedPath(asset,sourceArchive),filename=path.join(directory,relative),storeName=sourceArchive?'sources':'assets';
  let input,output;
  try {
    const store=await fs.lstat(path.join(directory,storeName));
    if(!store.isDirectory()||store.isSymbolicLink())throw error('UNSAFE_ASSET',`The asset store for ${asset.name} is not a regular directory.`);
    const file=await fs.lstat(filename);
    if(!file.isFile()||file.isSymbolicLink())throw error('UNSAFE_ASSET',`Asset ${asset.name} is not a regular file.`);
    if(file.size>maxBytes)throw error('ASSET_TOO_LARGE',`Asset ${asset.name} exceeds the ${maxBytes}-byte limit.`,{bytes:file.size});
    input=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    const opened=await input.stat(),currentStore=await fs.lstat(path.join(directory,storeName));
    if(!opened.isFile()||opened.dev!==file.dev||opened.ino!==file.ino||currentStore.dev!==store.dev||currentStore.ino!==store.ino) {
      throw error('UNSAFE_ASSET',`Asset ${asset.name} changed identity while opening.`);
    }
    if(destination)output=await fs.open(destination,'wx',0o600);
    const hash=createHash('sha256'),chunks=[];
    const buffer=Buffer.allocUnsafe(64*1024);
    let bytes=0;
    for(;;) {
      const {bytesRead}=await input.read(buffer,0,buffer.length,null);
      if(!bytesRead)break;
      bytes+=bytesRead;
      if(bytes>maxBytes)throw error('ASSET_TOO_LARGE',`Asset ${asset.name} exceeds the ${maxBytes}-byte limit.`,{bytes});
      const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);
      if(includeBytes)chunks.push(Buffer.from(chunk));
      if(output)await output.writeFile(chunk);
    }
    const actualSha256=hash.digest('hex');
    if(actualSha256!==asset.sha256&&!allowMismatch)throw error('ASSET_CHANGED',`Content mismatch: ${asset.name}`,{bytes,actualSha256});
    if(output)await output.sync();
    return {bytes,sha256:actualSha256,hashValid:actualSha256===asset.sha256,
      identity:{dev:opened.dev,ino:opened.ino,size:opened.size,mtimeMs:opened.mtimeMs,ctimeMs:opened.ctimeMs},
      ...(includeBytes?{data:Buffer.concat(chunks,bytes)}:{})};
  } catch(e) {
    if(e.status)throw e;
    if(e.code==='ENOENT')throw error('ASSET_MISSING',`Missing asset: ${asset.name}`);
    if(e.code==='ELOOP')throw error('UNSAFE_ASSET',`Asset ${asset.name} is a symbolic link.`);
    throw error('ASSET_UNREADABLE',`Cannot read asset ${asset.name}: ${e.code??'I/O error'}`);
  } finally {await input?.close();await output?.close();}
}

export async function readVerifiedAsset(directory,asset,{maxBytes=MAX_WAV_FILE_BYTES}={}) {
  return (await scanAsset(directory,asset,{includeBytes:true,maxBytes})).data;
}

export async function readVerifiedSourceArchive(directory,archive,{maxBytes=MAX_WAV_FILE_BYTES}={}){return(await scanAsset(directory,archive,{sourceArchive:true,includeBytes:true,maxBytes})).data;}
export async function restoreSourceArchive(directory,archive,bytes){
 const relative=managedPath(archive,true),base=path.resolve(directory);
 if(!(bytes instanceof Uint8Array)||bytes.length!==archive.bytes||digest(bytes)!==archive.sha256)throw error('ARCHIVE_CHANGED','Original source bytes do not match registration.');
 const baseIdentity=await regularDirectory(base,{create:true}),store=path.join(base,'sources'),storeIdentity=await regularDirectory(store,{create:true});
 try{await readVerifiedSourceArchive(base,archive);return false;}catch(e){if(e.code!=='ASSET_MISSING')throw e;}
 await unchangedDirectory(base,baseIdentity);await unchangedDirectory(store,storeIdentity);await atomicWrite(path.join(base,relative),bytes,{noClobber:true});return true;
}

async function regularDirectory(filename,{create=false}={}) {
  let stat;
  try {stat=await fs.lstat(filename);}
  catch(e) {
    if(e.code!=='ENOENT')throw error('ASSET_UNREADABLE',`Cannot inspect the media directory: ${e.code??'I/O error'}.`);
    if(!create)return null;
    try{await fs.mkdir(filename,{mode:0o700});}catch(problem){if(problem.code!=='EEXIST')throw error('ASSET_UNREADABLE',`Cannot create the media directory: ${problem.code??'I/O error'}.`);}
    stat=await fs.lstat(filename);
  }
  if(!stat.isDirectory()||stat.isSymbolicLink())throw error('UNSAFE_ASSET','Media repair requires regular project, asset and recovery directories; symbolic links are not followed.');
  return stat;
}

async function unchangedDirectory(filename,expected) {
  const current=await regularDirectory(filename);
  if(!current||current.dev!==expected.dev||current.ino!==expected.ino)throw error('ASSET_REPAIR_CONFLICT','The media directory changed while repair was being prepared.');
}

const repairQueues=new Map();

/** Restore registered media from a verified candidate.
 * This restores the exact registered bytes, not a filename-based relink, recursive
 * search, automatic remapping, processed-file reconstruction or event deletion.
 */
export async function restoreAsset(directory,asset,input,{dryRun=false}={}) {
  const relative=managedPath(asset),base=path.resolve(directory),key=path.join(base,relative);
  if(!(input instanceof Uint8Array))throw error('INVALID_RESTORE_SOURCE','Send binary WAV bytes for media repair.');
  if(input.byteLength>MAX_WAV_FILE_BYTES)throw error('RESTORE_SOURCE_TOO_LARGE','Restore sources must not exceed 128 MiB.');
  if(typeof dryRun!=='boolean')throw error('INVALID_DRY_RUN','dryRun must be boolean.');
  const bytes=Buffer.from(input); // Freeze the source across asynchronous file operations.
  const actualSha256=digest(bytes);
  if(actualSha256!==asset.sha256)throw error('ASSET_HASH_MISMATCH','The selected WAV does not exactly match the registered SHA-256; no files were changed.',{expectedSha256:asset.sha256,actualSha256});
  let decoded;
  try{decoded=decodeWav(bytes);}catch{throw error('INVALID_RESTORE_SOURCE','The matching source is not a supported WAV file.');}
  if(decoded.sampleRate!==asset.sampleRate||decoded.frames!==asset.frames||decoded.channels.length!==asset.channels) {
    throw error('ASSET_METADATA_MISMATCH','The selected WAV disagrees with the registered sample rate, channel count or frame count.');
  }
  const previous=repairQueues.get(key)??Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
    const baseIdentity=await regularDirectory(base);
    if(!baseIdentity)throw error('ASSET_MISSING','The project directory is missing.');
    const storePath=path.join(base,'assets'),filename=path.join(base,relative);
    let storeIdentity=await regularDirectory(storePath),current=null;
    if(storeIdentity) {
      try{current=await scanAsset(base,asset,{allowMismatch:true,maxBytes:MAX_BUNDLE_BYTES});}
      catch(e){if(e.code!=='ASSET_MISSING')throw e;}
    }
    const plannedAction=!current?'restore':current.hashValid?'none':'replace-damaged';
    if(plannedAction==='replace-damaged')await regularDirectory(path.join(base,'recovery'));
    const describe=state=>({id:asset.id,name:asset.name,path:relative,sha256:asset.sha256,
      available:Boolean(state),hashValid:state?state.hashValid:null,bytes:state?.bytes??null,
      status:!state?'missing':state.hashValid?'ready':'changed'});
    const common={assetId:asset.id,dryRun,plannedAction,projectChanged:false,preservedDamagedCopy:null,
      candidate:{sha256:actualSha256,bytes:bytes.length,verified:true},warnings:[]};
    if(dryRun)return {...common,status:'validated',applied:false,asset:describe(current)};
    if(plannedAction==='none')return {...common,status:'unchanged',applied:false,asset:describe(current)};
    await unchangedDirectory(base,baseIdentity);
    const madeStore=!storeIdentity;
    if(!storeIdentity)storeIdentity=await regularDirectory(storePath,{create:true});
    let preservedDamagedCopy=null;
    try {
      if(current) {
        const recoveryPath=path.join(base,'recovery');
        const recoveryIdentity=await regularDirectory(recoveryPath,{create:true});
        const savedRelative=`recovery/${asset.sha256}-${randomUUID()}.damaged.wav`;
        let saved;
        try {saved=await scanAsset(base,asset,{destination:path.join(base,savedRelative),allowMismatch:true,maxBytes:MAX_BUNDLE_BYTES});}
        catch(e){await fs.rm(path.join(base,savedRelative),{force:true}).catch(()=>{});throw e;}
        preservedDamagedCopy={path:savedRelative,sha256:saved.sha256,bytes:saved.bytes};
        await unchangedDirectory(recoveryPath,recoveryIdentity);
        if(saved.sha256!==current.sha256||saved.identity.dev!==current.identity.dev||saved.identity.ino!==current.identity.ino) {
          throw error('ASSET_REPAIR_CONFLICT','Damaged source changed while its preserved copy was created.');
        }
        const latest=await scanAsset(base,asset,{allowMismatch:true,maxBytes:MAX_BUNDLE_BYTES});
        if(latest.sha256!==current.sha256||latest.identity.dev!==current.identity.dev||latest.identity.ino!==current.identity.ino) {
          throw error('ASSET_REPAIR_CONFLICT','Source changed before media repair could commit.');
        }
      }
      await unchangedDirectory(base,baseIdentity);await unchangedDirectory(storePath,storeIdentity);
      // Missing files use exclusive publication. Damaged files may only be
      // atomically replaced after a complete, synced, hash-checked preservation.
      // The server queue serializes cooperating project operations. An external
      // writer that ignores that queue can still change the file after the final
      // check; this is not a filesystem-wide compare-and-swap guarantee.
      await atomicWrite(filename,bytes,{noClobber:!current});
      return {...common,status:'restored',applied:true,preservedDamagedCopy,
        asset:describe({hashValid:true,bytes:bytes.length}),
        warnings:preservedDamagedCopy?[`Previous damaged bytes were preserved at ${preservedDamagedCopy.path}.`]:[]};
    } catch(e) {
      if(madeStore)await fs.rmdir(storePath).catch(()=>{});
      if(preservedDamagedCopy)throw error(e.code??'ASSET_RESTORE_FAILED',`${e.status?e.message:`Media repair did not commit: ${e.code??'I/O error'}.`} Preserved copy remains at ${preservedDamagedCopy.path}.`,{preservedDamagedCopy});
      if(e.status)throw e;
      throw error(e.code==='EEXIST'?'ASSET_REPAIR_CONFLICT':'ASSET_RESTORE_FAILED',`Media repair did not commit: ${e.code??'I/O error'}.`);
    }
  });
  repairQueues.set(key,operation);
  try{return await operation;}finally{if(repairQueues.get(key)===operation)repairQueues.delete(key);}
}

export async function assetInventory(project,directory) {
  const snapshot=structuredClone(project);validateProject(snapshot);
  const rows=[];
  for(const asset of snapshot.assets) {
    const users=snapshot.clips.filter(clip=>clip.type==='audio'&&clip.assetId===asset.id)
      .map(clip=>({clipId:clip.id,trackId:clip.trackId,clipName:clip.name}));
    const row={id:asset.id,name:asset.name,path:asset.path,sha256:asset.sha256,users,referenceCount:users.length,
      available:false,hashValid:null,bytes:null,status:'unreadable'};
    try {const checked=await scanAsset(directory,asset);Object.assign(row,{available:true,hashValid:true,bytes:checked.bytes,status:'ready'});}
    catch(e) {
      row.status=e.code==='ASSET_MISSING'?'missing':e.code==='ASSET_CHANGED'?'changed':/UNSAFE|INVALID_ASSET_PATH/.test(e.code)?'unsafe':'unreadable';
      row.available=e.code==='ASSET_CHANGED';row.hashValid=e.code==='ASSET_CHANGED'?false:null;
      row.bytes=e.details?.bytes??null;row.error={code:e.code??'ASSET_UNREADABLE',message:e.message};
    }
    rows.push(row);
  }
  const sourceArchives=[];for(const archive of snapshot.sourceArchives??[]){const row={...archive,status:'ready',hashValid:true};try{await scanAsset(directory,archive,{sourceArchive:true,maxBytes:MAX_WAV_FILE_BYTES});}catch(e){row.status=e.code==='ASSET_MISSING'?'missing':'invalid';row.hashValid=false;row.error={code:e.code,message:e.message};}sourceArchives.push(row);}
  return {projectId:snapshot.id,projectRevision:snapshot.revision,assets:rows,sourceArchives};
}

async function readProjectFile(filename) {
  const stat=await fs.stat(filename);
  if(!stat.isFile()||stat.size>MAX_PROJECT_BYTES)throw error('INVALID_PROJECT_FILE','Project JSON must be a regular file no larger than 16 MiB.');
  const bytes=await fs.readFile(filename);
  if(bytes.length>MAX_PROJECT_BYTES)throw error('INVALID_PROJECT_FILE','Project JSON exceeds 16 MiB.');
  let project;
  try{project=JSON.parse(bytes.toString('utf8'));}
  catch{throw error('INVALID_PROJECT_JSON',`Invalid project JSON: ${path.basename(filename)}`);}
  validateProject(project);
  return {project,sha256:digest(bytes)};
}

function manifestFor(project,filename,projectBytes,source,assets,kind='collection') {
  return {format:`newdaw-${kind}`,version:1,createdAt:new Date().toISOString(),source,
    project:{file:filename,id:project.id,revision:project.revision,sha256:digest(projectBytes)},
    assets,preserved:{ids:true,revision:true,sourceBytes:true},
    warnings:['The persistent undo-history sidecar is not included. Rendered mixes are not substitutes for editable project sources.']};
}

async function collectSnapshot(project,sourceDirectory,destination,{filename,source,dryRun=false}={}) {
  const snapshot=structuredClone(project);validateProject(snapshot);
  if(!filename||path.basename(filename)!==filename||['manifest.json','.','..'].includes(filename))throw error('INVALID_OUTPUT_NAME','Choose a project filename without directory separators.');
  destination=path.resolve(destination);
  await requireAbsent(destination);
  const parent=await fs.stat(path.dirname(destination));
  if(!parent.isDirectory())throw error('INVALID_DESTINATION','Collection destination parent must be a directory.');
  const projectBytes=encoded(snapshot);
  const run=async staging=>{
    if(staging&&snapshot.assets.length)await fs.mkdir(path.join(staging,'assets'),{mode:0o700});if(staging&&snapshot.sourceArchives?.length)await fs.mkdir(path.join(staging,'sources'),{mode:0o700});
    const assets=[],seen=new Map();
    for(const asset of [...snapshot.assets,...(snapshot.sourceArchives??[]).map(a=>({...a,sourceArchive:true}))]) {
      const relative=managedPath(asset,asset.sourceArchive);
      let check=seen.get(relative);
      if(!check) {
        check=await scanAsset(sourceDirectory,asset,{sourceArchive:asset.sourceArchive,...(staging?{destination:path.join(staging,relative)}:{})});
        seen.set(relative,check);
      }
      assets.push({id:asset.id,path:relative,sha256:asset.sha256,bytes:check.bytes});
    }
    const manifest=manifestFor(snapshot,filename,projectBytes,source,assets);
    if(staging) {
      await atomicWrite(path.join(staging,filename),projectBytes,{noClobber:true});
      await atomicWrite(path.join(staging,'manifest.json'),encoded(manifest),{noClobber:true});
    }
    return {status:dryRun?'validated':'collected',dryRun,destination,projectFile:path.join(destination,filename),
      projectId:snapshot.id,revision:snapshot.revision,assetCount:assets.length,
      uniqueAssetCount:seen.size,assetBytes:[...seen.values()].reduce((sum,value)=>sum+value.bytes,0),manifest};
  };
  return dryRun?run():createDirectoryAtomically(destination,run);
}

/** Read one immutable JSON generation, then copy and hash every registered asset. */
export async function collectProject(input,destination,{dryRun=false}={}) {
  input=path.resolve(input);
  const {project,sha256}=await readProjectFile(input);
  return collectSnapshot(project,path.dirname(input),destination,{dryRun,filename:path.basename(input),
    source:{kind:'file',file:path.basename(input),projectSha256:sha256,projectId:project.id,revision:project.revision}});
}

/** Recovery is always a new identity on disk, retaining the backed-up project's IDs/revision.
 * A different parent is published as a complete, newly collected directory. */
export async function recoverProject(input,{output,dryRun=false}={}) {
  if(!output)throw error('OUTPUT_REQUIRED','Recovery requires --output NEWFILE; it never replaces the source.');
  input=path.resolve(input);output=path.resolve(output);
  const backup=`${input}.bak`;
  if(output===input||output===backup)throw error('RECOVERY_SOURCE_OVERWRITE','Recovery output must differ from the original project and its backup.');
  await requireAbsent(output);
  const {project,sha256}=await readProjectFile(backup);
  const source={kind:'backup',file:path.basename(backup),originalFile:path.basename(input),projectSha256:sha256,projectId:project.id,revision:project.revision};
  if(path.dirname(output)!==path.dirname(input)) {
    const result=await collectSnapshot(project,path.dirname(input),path.dirname(output),{filename:path.basename(output),source,dryRun});
    return {...result,status:dryRun?'validated':'recovered',recoveryFrom:path.basename(backup),assetsCollected:true};
  }
  const sidecar=`${output}.recovery.json`;
  await requireAbsent(sidecar);
  const inventory=await assetInventory(project,path.dirname(input));
  const failed=[...inventory.assets,...inventory.sourceArchives].find(asset=>!asset.hashValid);
  if(failed)throw error(failed.error.code,failed.error.message);
  const bytes=encoded(project);
  const manifest=manifestFor(project,path.basename(output),bytes,source,[...inventory.assets,...inventory.sourceArchives].map(a=>({id:a.id,path:a.path,sha256:a.sha256,bytes:a.bytes})),'recovery');
  if(!dryRun) {
    // Write the provenance first; only publish the project after it exists. Roll
    // back our sidecar if the project destination appeared in the meantime.
    await atomicWrite(sidecar,encoded(manifest),{noClobber:true});
    try{await atomicWrite(output,bytes,{noClobber:true});}
    catch(e){await fs.rm(sidecar,{force:true});throw e;}
  }
  return {status:dryRun?'validated':'recovered',dryRun,projectFile:output,projectId:project.id,revision:project.revision,
    recoveryFrom:path.basename(backup),assetsCollected:false,manifest};
}

const crcTable=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});
function crc32(bytes) {let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

/** ZIP32, method STORE, UTF-8 paths, fixed DOS epoch. No compression or external binaries. */
export function storedZip(entries,maxBytes) {
  if(entries.length>65535)throw error('BUNDLE_TOO_LARGE','Too many files for the ZIP32 bundle.');
  const local=[],central=[];let offset=0,centralBytes=0;
  for(const {name,data} of entries) {
    const filename=Buffer.from(name,'utf8'),crc=crc32(data),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    if(filename.length>65535||offset+30+filename.length+data.length>maxBytes)throw error('BUNDLE_TOO_LARGE','Project bundle exceeds 64 MiB.');
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(0x314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(0x21,14);
    directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);
    directory.writeUInt32LE((0o100600<<16)>>>0,38);directory.writeUInt32LE(offset,42);
    local.push(header,filename,data);central.push(directory,filename);
    offset+=header.length+filename.length+data.length;centralBytes+=directory.length+filename.length;
  }
  if(offset+centralBytes+22>maxBytes)throw error('BUNDLE_TOO_LARGE','Project bundle exceeds 64 MiB.');
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,end],offset+centralBytes+22);
}

/** The caller supplies a frozen project snapshot. Never include source disk paths in HTTP provenance. */
export async function createProjectBundle(project,directory,{maxBytes=MAX_BUNDLE_BYTES}={}) {
  const snapshot=structuredClone(project);validateProject(snapshot);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<=0||maxBytes>MAX_BUNDLE_BYTES)throw error('INVALID_BUNDLE_LIMIT','Bundle byte limit must be positive and no greater than 64 MiB.');
  const filename='session.newdaw.json',projectBytes=encoded(snapshot);
  const entries=[{name:filename,data:projectBytes}],assets=[],seen=new Map();let total=projectBytes.length;
  if(total>maxBytes)throw error('BUNDLE_TOO_LARGE','Project JSON alone exceeds the bundle limit.');
  for(const asset of [...snapshot.assets,...(snapshot.sourceArchives??[]).map(a=>({...a,sourceArchive:true}))]) {
    const relative=managedPath(asset,asset.sourceArchive);let bytes=seen.get(relative);
    if(!bytes) {
      try{bytes=await(asset.sourceArchive?readVerifiedSourceArchive:readVerifiedAsset)(directory,asset,{maxBytes:maxBytes-total});}
      catch(e){if(e.code==='ASSET_TOO_LARGE')throw error('BUNDLE_TOO_LARGE','Project assets exceed the 64 MiB bundle limit.');throw e;}
      total+=bytes.length;entries.push({name:relative,data:bytes});seen.set(relative,bytes);
    }
    assets.push({id:asset.id,path:relative,sha256:asset.sha256,bytes:bytes.length});
  }
  const manifest=manifestFor(snapshot,filename,projectBytes,{kind:'http-snapshot',projectId:snapshot.id,revision:snapshot.revision},assets);
  entries.push({name:'manifest.json',data:encoded(manifest)});
  return {bytes:storedZip(entries,maxBytes),manifest,projectId:snapshot.id,revision:snapshot.revision};
}

/** Recover a managed automatic backup to a new file; collect assets for a new folder. */
export async function recoverAutoBackup(input,backupId,{output,dryRun=false}={}) {
  if(!output)throw error('OUTPUT_REQUIRED','Recovery requires --output NEWFILE; it never replaces the source.');
  input=path.resolve(input);output=path.resolve(output);
  if(output===input||output===`${input}.bak`)throw error('RECOVERY_SOURCE_OVERWRITE','Choose a new project filename for recovery.');
  await requireAbsent(output);
  const {project,bytes:original}=await readBackup(input,backupId);
  const source={kind:'automatic-backup',backupId,originalFile:path.basename(input),projectSha256:digest(original),projectId:project.id,revision:project.revision};
  if(path.dirname(output)!==path.dirname(input)) {
    const result=await collectSnapshot(project,path.dirname(input),path.dirname(output),{filename:path.basename(output),source,dryRun});
    return {...result,status:dryRun?'validated':'recovered',assetsCollected:true};
  }
  const sidecar=`${output}.recovery.json`;await requireAbsent(sidecar);
  const inventory=await assetInventory(project,path.dirname(input)),failed=[...inventory.assets,...inventory.sourceArchives].find(a=>!a.hashValid);
  if(failed)throw error(failed.error.code,failed.error.message);
  const bytes=encoded(project),manifest=manifestFor(project,path.basename(output),bytes,source,[...inventory.assets,...inventory.sourceArchives].map(a=>({id:a.id,path:a.path,sha256:a.sha256,bytes:a.bytes})),'recovery');
  if(!dryRun){await atomicWrite(sidecar,encoded(manifest),{noClobber:true});try{await atomicWrite(output,bytes,{noClobber:true});}catch(e){await fs.rm(sidecar,{force:true});throw e;}}
  return {status:dryRun?'validated':'recovered',dryRun,projectFile:output,projectId:project.id,revision:project.revision,assetsCollected:false,manifest};
}
