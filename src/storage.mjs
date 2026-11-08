import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWrite(filename, content, {noClobber=false}={}) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close(); handle = undefined;
    if(noClobber)await fs.link(temporary,filename);
    else await fs.rename(temporary, filename);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

/** Stage beside the destination, then atomically publish a complete new directory.
 * The sibling reservation serializes collectors. Existing destinations (even empty
 * directories or symlinks) are never intentionally replaced. The parent must exist.
 */
export async function createDirectoryAtomically(destination, build) {
  destination=path.resolve(destination);
  const parent=path.dirname(destination),guard=`${destination}.newdaw-collect.lock`;
  await fs.access(parent);
  let reserved=false,temporary;
  const absent=async()=>{
    try {await fs.lstat(destination);}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    throw Object.assign(new Error(`Destination already exists: ${destination}`),{code:'EEXIST'});
  };
  try {
    await absent();
    await fs.mkdir(guard,{mode:0o700});reserved=true;
    await absent();
    temporary=await fs.mkdtemp(path.join(parent,`.${path.basename(destination)}.collect-`));
    const value=await build(temporary);
    await absent();
    await fs.rename(temporary,destination);temporary=undefined;
    return value;
  } finally {
    if(temporary)await fs.rm(temporary,{recursive:true,force:true});
    if(reserved)await fs.rmdir(guard);
  }
}

export async function saveProject(filename, project) {
  // Preserve the previous valid on-disk generation before replacing the active file.
  try { await atomicWrite(`${filename}.bak`, await fs.readFile(filename)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await atomicWrite(filename, `${JSON.stringify(project, null, 2)}\n`);
}

export async function acquireProjectLock(filename, url, { createParent = true } = {}) {
  if (typeof createParent !== 'boolean') throw Object.assign(new Error('createParent must be boolean.'), { code: 'INVALID_LOCK_OPTIONS', status: 422 });
  const lockPath = `${filename}.lock`;
  if (createParent) await fs.mkdir(path.dirname(filename), { recursive: true });
  const guard=`${lockPath}.guard`,token=randomUUID();
  // Serialize both initial creation and stale-lock recovery, preventing another
  // startup from removing a replacement lock between read and unlink.
  try { await fs.mkdir(guard); }
  catch(error){if(error.code==='EEXIST')throw new Error(`Another startup is inspecting ${lockPath}. Retry; if a startup crashed, inspect ${guard}.`);throw error;}
  try {
    let owner;
    try { owner=JSON.parse(await fs.readFile(lockPath,'utf8')); }
    catch(error){if(error.code!=='ENOENT')throw new Error(`Cannot verify session lock ${lockPath}. Inspect it before removing it.`);}
    if(owner){
      if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw new Error(`Invalid PID in ${lockPath}`);
      let alive=true;
      try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive)throw new Error(`Project is already open (PID ${owner.pid}). Attach CLI with --url ${owner.url}`);
      await fs.rm(lockPath);
    }
    const handle=await fs.open(lockPath,'wx',0o600);
    try {
      await handle.writeFile(JSON.stringify({pid:process.pid,url,token,startedAt:new Date().toISOString()}));
    } finally {await handle.close();}
    return async()=>{try{const current=JSON.parse(await fs.readFile(lockPath,'utf8'));if(current.token===token)await fs.rm(lockPath);}catch(error){if(error.code!=='ENOENT')throw error;}};
  } finally {await fs.rmdir(guard);}
}
