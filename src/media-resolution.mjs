import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Engine} from './core/engine.mjs';
import {assetInventory,restoreAsset} from './project-files.mjs';
import {createMediaSearch,readMediaCandidate} from './media-search.mjs';

const fail=(code,message,status=422,details)=>{throw Object.assign(new Error(message),{code,status,...(details?{details}:{} )});};
const object=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('INVALID_RESOLUTION_OPTIONS','Unknown or invalid media-resolution options.');
};
const bool=(value,name)=>{if(value!==undefined&&typeof value!=='boolean')fail('INVALID_RESOLUTION_OPTIONS',`${name} must be boolean.`);};
const MAX_ACCEPT_BYTES=64*1024*1024;

// Discovery is read-only. Acceptance is serialized with every project edit and
// resolves only server-held candidate handles, never a newly supplied path.
export function createMediaResolver({directory,getEngine,getMediaRevision,runExclusive,commitCommand,mediaChanged,isClosed,onPublished=async()=>[]}) {
  const jobs=new Map(),plans=new Map();let disposed=false;
  const current=()=>getEngine().project;
  function guard(input){
    if(disposed||isClosed())fail('SESSION_CLOSING','Session is closing.',503);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!Number.isSafeInteger(input.expectedMediaRevision)||input.expectedMediaRevision<0)fail('EXPECTED_REVISION_REQUIRED','Provide expectedRevision and expectedMediaRevision from the current session.');
    if(input.expectedRevision!==current().revision||input.expectedMediaRevision!==getMediaRevision())fail('REVISION_CONFLICT','Project or media changed. Refresh and choose the source again.',409);
  }
  const getJob=id=>{const job=jobs.get(id);if(!job)fail('SEARCH_NOT_FOUND','Search expired or does not exist.',404);return job;};
  function publicJob(job){const result=job.search.snapshot();return {...result,warnings:[...result.warnings,...(job.warnings??[])],projectRevision:job.revision,mediaRevision:job.mediaRevision,stale:job.revision!==current().revision||job.mediaRevision!==getMediaRevision()};}
  async function start(input){
    object(input,['expectedRevision','expectedMediaRevision','assetId','mode','location','caseSensitive','queryName']);guard(input);bool(input.caseSensitive,'caseSensitive');
    const frozen=current(),inventory=await assetInventory(frozen,directory);guard(input);
    const targets=inventory.assets.filter(a=>['missing','changed'].includes(a.status));
    if(!targets.some(a=>a.id===input.assetId))fail('ASSET_NOT_MISSING','Choose a missing or changed source from the current media inventory.');
    if([...jobs.values()].filter(j=>j.search.snapshot().status==='running').length>=2)fail('SEARCH_BUSY','Stop an existing search first.',409);
    while(jobs.size>=8){const old=[...jobs].find(([,j])=>j.search.snapshot().status!=='running');if(!old)break;jobs.delete(old[0]);}
    const assetIds=[input.assetId,...targets.filter(a=>a.id!==input.assetId).map(a=>a.id)].slice(0,1000);
    const warnings=targets.length>1000?[{code:'SEARCH_TARGET_LIMIT',message:'The selected source and the next 999 unresolved sources are searched in this pass. Other sources remain unresolved.'}]:[];
    const search=createMediaSearch({project:frozen,assetIds,location:input.location,mode:input.mode,caseSensitive:input.caseSensitive??false,...(input.queryName!==undefined?{queryName:input.queryName}:{})});
    const job={search,warnings,revision:input.expectedRevision,mediaRevision:input.expectedMediaRevision,assetId:input.assetId};jobs.set(search.id,job);
    return publicJob(job);
  }
  async function plan(input){
    object(input,['expectedRevision','expectedMediaRevision','searchId','candidateId','autoMap','framePolicy']);guard(input);bool(input.autoMap,'autoMap');
    if(input.framePolicy!==undefined&&!['exact','nearest'].includes(input.framePolicy))fail('INVALID_FRAME_POLICY','Use exact or nearest frame conversion.');
    const job=getJob(input.searchId);
    if(job.revision!==input.expectedRevision||job.mediaRevision!==input.expectedMediaRevision)fail('REVISION_CONFLICT','This search used an older project or media state.',409);
    const handle=job.search.getCandidate(input.candidateId);
    if(!handle)fail('CANDIDATE_NOT_FOUND','Choose a candidate from this search.',404);
    const selected=await readMediaCandidate(handle);guard(input);
    const project=current(),inventory=await assetInventory(project,directory);guard(input);
    const unresolved=inventory.assets.filter(a=>['missing','changed'].includes(a.status));
    if(!unresolved.some(a=>a.id===job.assetId))fail('ASSET_NOT_MISSING','The selected source no longer needs resolution.');
    let totalBytes=selected.bytes.length;
    const chosen=[{assetId:job.assetId,handle,info:selected,automatic:false}],warnings=[];
    // After an explicit choice, try all remaining missing sources in its folder.
    // Hash identity is sufficient for automatic mapping; names alone are not.
    if(input.autoMap!==false&&unresolved.length>1){
      const scan=createMediaSearch({project,assetIds:unresolved.filter(a=>a.id!==job.assetId).map(a=>a.id).slice(0,1000),location:path.dirname(selected.path),mode:'folder'});
      const found=await scan.done;guard(input);
      if(unresolved.length>1001)warnings.push('Automatic mapping checks at most 1000 other sources per acceptance. Remaining sources are listed below.');
      warnings.push(...(found.warnings??[]));
      for(const row of unresolved.filter(a=>a.id!==job.assetId)){
        const asset=project.assets.find(a=>a.id===row.id),matches=found.candidates.filter(c=>c.sha256===asset.sha256);
        // Identical hashes in several files have the same media content. Stable
        // path ordering chooses one; differing contents require explicit choice.
        if(matches.length){
          const candidate=matches.sort((a,b)=>a.path.localeCompare(b.path))[0],h=scan.getCandidate(candidate.id);
          const info=await readMediaCandidate(h);totalBytes+=info.bytes.length;
          if(totalBytes>MAX_ACCEPT_BYTES)fail('RESOLUTION_TOO_LARGE','One acceptance may copy at most 64 MiB. Disable automatic mapping and resolve fewer sources.');
          chosen.push({assetId:asset.id,handle:h,info,automatic:true});
        }
      }
      if(found.truncated)warnings.push('Automatic mapping reached its scan limit; unresolved sources remain listed.');
      if(found.status==='failed')warnings.push('Automatic mapping could not finish; the explicitly selected source is still available.');
    }
    guard(input);
    const mappings=chosen.map(({assetId,info})=>({assetId,sha256:info.sha256,path:`assets/${info.sha256}.wav`,sampleRate:info.sampleRate,channels:info.channels,frames:info.frames}));
    const probe=new Engine(project),preview=probe.execute({command:'asset.relink',arguments:{mappings,framePolicy:input.framePolicy??'exact'},expectedRevision:project.revision,dryRun:true});
    if(preview.status==='error')fail(preview.errors[0].code,preview.errors[0].message,422,preview.errors[0].details);
    if(chosen.reduce((sum,c)=>sum+c.info.bytes.length,0)>MAX_ACCEPT_BYTES)fail('RESOLUTION_TOO_LARGE','One acceptance may copy at most 64 MiB. Resolve fewer sources.');
    const rows=chosen.map(({assetId,info,automatic})=>{
      const asset=project.assets.find(a=>a.id===assetId),row=inventory.assets.find(a=>a.id===assetId);
      return {assetId,name:asset.name,source:info.path,automatic,exactHash:asset.sha256===info.sha256,oldSha256:asset.sha256,sha256:info.sha256,sampleRate:info.sampleRate,channels:info.channels,frames:info.frames,clipIds:row.users.map(u=>u.clipId),action:asset.sha256===info.sha256?'restore':'relink'};
    });
    const id=randomUUID(),value={id,projectRevision:project.revision,mediaRevision:input.expectedMediaRevision,rows,changes:preview.changes,warnings,
      unresolved:unresolved.filter(a=>!chosen.some(c=>c.assetId===a.id)).map(a=>({assetId:a.id,name:a.name})),requiresReplacementConsent:rows.some(r=>!r.exactHash)};
    while(plans.size>=16)plans.delete(plans.keys().next().value);
    // Keep handles and metadata, not decoded audio buffers, between requests.
    plans.set(id,{value,handles:chosen.map(c=>c.handle),mappings,framePolicy:input.framePolicy??'exact'});
    return value;
  }
  async function accept(input){
    object(input,['expectedRevision','expectedMediaRevision','planId','allowReplacement','dryRun']);bool(input.allowReplacement,'allowReplacement');bool(input.dryRun,'dryRun');
    return runExclusive(async()=>{
      guard(input);const plan=plans.get(input.planId);if(!plan)fail('PLAN_NOT_FOUND','Preview expired. Prepare a new resolution plan.',404);
      if(plan.value.projectRevision!==input.expectedRevision||plan.value.mediaRevision!==input.expectedMediaRevision)fail('REVISION_CONFLICT','Plan is stale. Prepare a new preview.',409);
      if(plan.value.requiresReplacementConsent&&!input.allowReplacement)fail('REPLACEMENT_CONFIRMATION_REQUIRED','The selected file has different content. Review and explicitly allow replacement.',409);
      if(getMediaRevision()===Number.MAX_SAFE_INTEGER)fail('MEDIA_REVISION_OVERFLOW','Media revision cannot be incremented safely.',409);
      const bytes=[];let total=0;
      for(const handle of plan.handles){const info=await readMediaCandidate(handle);total+=info.bytes.length;if(total>MAX_ACCEPT_BYTES)fail('RESOLUTION_TOO_LARGE','Acceptance exceeds 64 MiB.');bytes.push(info.bytes);}
      const envelope={command:'asset.relink',arguments:{mappings:plan.mappings,framePolicy:plan.framePolicy},expectedRevision:input.expectedRevision,dryRun:Boolean(input.dryRun)};
      const preview=new Engine(current()).execute({...envelope,dryRun:true});
      if(preview.status==='error')fail(preview.errors[0].code,preview.errors[0].message,422);
      const repairs=[];
      // Validate every destination before publication. Source originals and old
      // content-addressed files are retained, so undo can still reference them.
      for(let i=0;i<plan.mappings.length;i++){
        const mapping=plan.mappings[i],old=current().assets.find(a=>a.id===mapping.assetId);
        await restoreAsset(directory,{...old,...mapping,id:old.id},bytes[i],{dryRun:true});
      }
      if(input.dryRun)return {status:'validated',applied:false,plan:plan.value,changes:preview.changes};
      try{
        for(let i=0;i<plan.mappings.length;i++){
          const mapping=plan.mappings[i],old=current().assets.find(a=>a.id===mapping.assetId);
          repairs.push(await restoreAsset(directory,{...old,...mapping,id:old.id},bytes[i]));
        }
        const publicationWarnings=await onPublished(plan.mappings.filter((m,i)=>repairs[i].applied&&repairs[i].plannedAction==='restore').map(m=>{const {assetId,...fields}=m;return {...current().assets.find(a=>a.id===assetId),...fields};}));
        const changedMappings=plan.mappings.filter(m=>{const old=current().assets.find(a=>a.id===m.assetId);return ['sha256','path','sampleRate','channels','frames'].some(k=>old[k]!==m[k]);});
        const result=changedMappings.length?await commitCommand({...envelope,arguments:{...envelope.arguments,mappings:changedMappings}},{internal:true}):{status:'unchanged',applied:false,projectRevision:current().revision,project:current(),history:getEngine().history,changes:preview.changes};
        if(result.status==='error')fail(result.errors[0].code,result.errors[0].message,422);
        if(repairs.some(r=>r.applied))mediaChanged();
        plans.delete(input.planId);
        return {...result,status:result.applied||repairs.some(r=>r.applied)?'applied':'unchanged',applied:result.applied||repairs.some(r=>r.applied),projectChanged:result.applied,mediaRevision:getMediaRevision(),repairs,plan:plan.value,warnings:publicationWarnings};
      }catch(error){
        // A failed project commit does not erase published source copies. Exact
        // repairs may already be usable; report them and invalidate media cache.
        if(repairs.some(r=>r.applied))mediaChanged();
        error.details={...error.details,projectCommitted:false,repairs,retainedCopies:repairs.filter(r=>r.applied).map(r=>r.asset.path)};throw error;
      }
    });
  }
  async function removeMissing(input){
    object(input,['expectedRevision','expectedMediaRevision','dryRun','expectedAssetIds']);bool(input.dryRun,'dryRun');
    return runExclusive(async()=>{
      guard(input);const inventory=await assetInventory(current(),directory),assetIds=inventory.assets.filter(a=>a.status==='missing').map(a=>a.id).sort();guard(input);
      if(!Array.isArray(input.expectedAssetIds)||JSON.stringify([...input.expectedAssetIds].sort())!==JSON.stringify(assetIds))fail('MISSING_SET_CHANGED','Missing sources changed. Review the removal list again.',409);
      if(!assetIds.length)return {status:'unchanged',applied:false,removedMissing:{assetIds:[],clipIds:[]}};
      return commitCommand({command:'asset.removeMissing',arguments:{assetIds},expectedRevision:input.expectedRevision,dryRun:Boolean(input.dryRun)},{internal:true});
    });
  }
  return {start,plan,accept,removeMissing,get:id=>publicJob(getJob(id)),stop:id=>{const j=getJob(id);j.search.stop();return publicJob(j);},close:async()=>{disposed=true;for(const j of jobs.values())j.search.stop();await Promise.all([...jobs.values()].map(j=>j.search.done));}};
}
