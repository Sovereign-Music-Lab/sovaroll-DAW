import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {inspectExistingProject,prepareExistingProject} from './project-open.mjs';
import {listRecentProjects,recordRecentProject,removeRecentProject,clearRecentProjects} from './recent-projects.mjs';
import {readSidecar} from './session-store.mjs';
import {Engine} from './core/engine.mjs';
import {contentProjectHash,loadSavedCheckpoint,saveExplicitCheckpoint,prepareProjectVersion,previewProjectVersion} from './project-save.mjs';
import {captureMediaOwnership,planRevertMedia,applyRevertMediaPlan,listRevertMediaTrash,restoreRevertMediaTrash} from './revert-media.mjs';

const fail=(code,message,status=422,details)=>{throw Object.assign(new Error(message),{code,status,...(details?{details}:{} )});};
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('INVALID_DOCUMENT_OPTIONS','Unknown or invalid document options.');}
function checkBool(value,name){if(value!==undefined&&typeof value!=='boolean')fail('INVALID_DOCUMENT_OPTIONS',`${name} must be boolean.`);}
const difference=(before,after)=>{
 const report={};for(const key of ['tracks','clips','assets']){const left=new Map(before[key].map(x=>[x.id,x])),right=new Map(after[key].map(x=>[x.id,x]));report[key]={added:[...right.keys()].filter(id=>!left.has(id)).length,removed:[...left.keys()].filter(id=>!right.has(id)).length,changed:[...right].filter(([id,value])=>left.has(id)&&JSON.stringify(left.get(id))!==JSON.stringify(value)).length};}return report;
};

// Working edits remain crash-safe in the project JSON. An explicit Save has a
// separate durable baseline, so a useful Revert is possible despite autosave.
export function createDocumentSession({getContext,runExclusive,emit,commitRevert,activateVersion,activateExisting,saveFirst,prepareAssets,inspectAssets,reserveTarget,mediaChanged,isClosed}){
 let saved=null,documentId=randomUUID();const plans=new Map(),openPlans=new Map();let recentWarnings=[];
 const context=()=>getContext();
 const invalidatePlans=()=>{plans.clear();openPlans.clear();};
 async function stateKey(filename){const result=[];for(const suffix of ['.history.json','.saved.json','.autobackups.json','.media-ownership.json'])try{result.push([suffix,createHash('sha256').update(await readSidecar(filename+suffix)).digest('hex')]);}catch(error){result.push([suffix,error.code??'UNREADABLE']);}return JSON.stringify(result);}

 const baselineKey=point=>JSON.stringify(point?{saveId:point.saveId,projectHash:point.projectHash,mediaOwnershipIds:point.mediaOwnershipIds}:null);
 async function remember(){
  const c=context();if(c.draft)return [];for(let attempt=0;attempt<3;attempt++)try{
   const list=await listRecentProjects(c.recentPath,{inspect:false});
   if(list.revision===null)throw Object.assign(new Error('Recent project registry needs attention; original file was preserved.'),{code:'RECENT_UNAVAILABLE'});
   const recorded=await recordRecentProject(c.recentPath,c.projectPath,{expectedRegistryRevision:list.revision});recentWarnings=recorded.warnings??[];return recentWarnings;
  }catch(error){if(error.status===409&&attempt<2)continue;recentWarnings=[{code:'RECENT_NOT_UPDATED',message:error.message}];return recentWarnings;}
 }
 async function recent(){const value=await listRecentProjects(context().recentPath);return {...value,storePath:context().recentPath,warnings:[...(value.warnings??[]),...recentWarnings]};}
 async function changeRecent(input){object(input,['expectedRevision','expectedDocumentId','expectedRegistryRevision','entryId','clear','dryRun']);checkBool(input.dryRun,'dryRun');checkBool(input.clear,'clear');
  if(input.clear===true?input.entryId!==undefined:typeof input.entryId!=='string')fail('INVALID_RECENT_OPTIONS','Select an entry or explicitly clear the recent list.');
  return runExclusive(async()=>{guard(input);const options={expectedRegistryRevision:input.expectedRegistryRevision,dryRun:Boolean(input.dryRun)};return input.clear===true?clearRecentProjects(context().recentPath,options):removeRecentProject(context().recentPath,input.entryId,options);});
 }

 function guard(input){const c=context();if(isClosed())fail('SESSION_CLOSING','Session is closing.',503);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||typeof input.expectedDocumentId!=='string')fail('EXPECTED_DOCUMENT_REQUIRED','Provide expectedRevision and expectedDocumentId from the current document.');
  if(input.expectedRevision!==c.engine.project.revision||input.expectedDocumentId!==documentId)fail('REVISION_CONFLICT','The active document changed. Refresh before continuing.',409);
 }
 function snapshot(){const c=context();if(!c.engine)return null;const point=saved?.checkpoint;return {id:documentId,projectPath:c.draft?null:c.projectPath,fileName:c.draft?null:path.basename(c.projectPath),neverSaved:Boolean(c.draft),draftId:c.draft?.id??null,displayName:c.draft?.name??path.basename(c.projectPath),projectFolder:c.directory,available:!c.draft&&Boolean(saved?.available),dirty:c.draft?true:point?contentProjectHash(c.engine.project)!==contentProjectHash(point.project):null,saveId:point?.saveId??null,savedAt:point?.savedAt??null,origin:point?.origin??null,recentStore:context().recentPath,recentWarnings,persistence:saved?.persistence??{status:'loading',warnings:[]}};}
 async function initialize(){const c=context(),ownership=await captureMediaOwnership(c.projectPath);saved=await loadSavedCheckpoint(c.projectPath,c.engine.project,{ownershipIds:ownership.ownershipIds});await remember();return snapshot();}
 async function save(input){object(input,['expectedRevision','expectedDocumentId','outputPath','dryRun']);checkBool(input.dryRun,'dryRun');return runExclusive(async()=>{guard(input);const c=context();
  if(c.draft)return saveFirst(input);
  if(input.outputPath!==undefined)fail('SAVE_AS_REQUIRED','Use Save As to select a different path for an already named project.');
  const ownership=await captureMediaOwnership(c.projectPath);
  if(input.dryRun)return {status:'validated',applied:false,document:snapshot()};
  saved=await saveExplicitCheckpoint(c.projectPath,c.engine.project,{ownershipIds:ownership.ownershipIds});invalidatePlans();emit();return {status:'saved',applied:true,projectChanged:false,document:snapshot()};
 });}
 async function saveVersion(input){object(input,['expectedRevision','expectedDocumentId','mode','outputPath','dryRun']);checkBool(input.dryRun,'dryRun');if(!['version','saveAs'].includes(input.mode))fail('INVALID_SAVE_MODE','Use version or saveAs.');
  return runExclusive(async()=>{guard(input);const c=context();
   if(c.draft){if(input.mode==='version')fail('FIRST_SAVE_REQUIRED','Choose a filename with Save before saving a numbered version.');return saveFirst(input);}
   if(c.engine.project.revision===Number.MAX_SAFE_INTEGER)fail('REVISION_OVERFLOW','Project revision cannot be incremented safely.',409);
   if(input.mode==='saveAs'&&(typeof input.outputPath!=='string'||!input.outputPath.trim()))fail('OUTPUT_REQUIRED','Save As requires an output path.');
   // File activation increments revision without adding a musical undo entry.
   const checkpoint=c.engine.checkpoint();checkpoint.project.revision++;checkpoint.history.projectRevision=checkpoint.project.revision;
   if(input.dryRun){const preview=await previewProjectVersion(c.projectPath,{checkpoint,mode:input.mode,outputPath:input.outputPath});const inspected=await inspectAssets({project:checkpoint.project,sourceDirectory:path.dirname(c.projectPath),directory:path.dirname(preview.projectPath)});return {status:'validated',applied:false,mode:input.mode,outputPath:preview.projectPath,document:snapshot(),warnings:[...preview.warnings,...inspected.warnings]};}
   const prepared=await prepareProjectVersion(c.projectPath,{checkpoint,settings:c.settings,mode:input.mode,outputPath:input.outputPath,ownershipIds:[],prepareAssets,reserveTarget});
   // The new filename is durable before the in-memory session is redirected.
   const adoptMetadata=()=>{documentId=randomUUID();invalidatePlans();saved={available:true,checkpoint:prepared.savedCheckpoint,persistence:{status:'saved',warnings:prepared.warnings??[]}};};
   let warnings;try{warnings=await activateVersion(prepared,adoptMetadata);}catch(error){
    if(context().projectPath!==prepared.projectPath){await prepared.releaseLock?.().catch(()=>{});error.details={...error.details,activated:false,preparedProjectPath:prepared.projectPath};throw error;}
    warnings=[{code:'ACTIVATED_WITH_WARNING',message:`The new document is active, but finalization reported: ${error.message}`}];
   }warnings=[...(warnings??[]),...await remember()];emit();
   return {status:'saved',applied:true,projectChanged:false,activated:true,document:snapshot(),warnings:[...(prepared.warnings??[]),...(warnings??[])]};
  });
 }
 async function planOpen(input){object(input,['expectedRevision','expectedDocumentId','projectPath','recentId']);
  if((typeof input.projectPath==='string')===(typeof input.recentId==='string'))fail('OPEN_TARGET_REQUIRED','Select exactly one project path or recent entry.');
  return runExclusive(async()=>{guard(input);if(context().draft)fail('DRAFT_WORKSPACE_REQUIRED','Use workspace Open to retain or save the Untitled project before switching.',409);let filename=input.projectPath;
   if(input.recentId!==undefined){const list=await listRecentProjects(context().recentPath,{inspect:false}),entry=list.entries.find(e=>e.id===input.recentId);if(!entry)fail('RECENT_ENTRY_NOT_FOUND','The recent entry no longer exists.',404);filename=entry.projectPath;}
   saved=await loadSavedCheckpoint(context().projectPath,context().engine.project,{initialize:false});
   const target=await inspectExistingProject(filename),c=context(),active=await inspectExistingProject(c.projectPath);guard(input);
   const sameDocument=target.projectPath===active.projectPath;
   const point=snapshot(),id=randomUUID(),value={id,documentId,projectRevision:c.engine.project.revision,saveId:point.saveId,sameDocument,
    current:{projectPath:c.projectPath,name:c.engine.project.name,dirty:point.dirty,available:point.available,savedAt:point.savedAt},requiresCurrentPolicy:!sameDocument&&point.dirty!==false,
    target:{projectPath:target.projectPath,projectId:target.project.id,name:target.project.name,revision:target.project.revision,tracks:target.project.tracks.length,clips:target.project.clips.length,assets:target.project.assets.length,savedAvailable:target.saved.available,dirty:target.saved.dirty,willInitializeSavedCheckpoint:target.willInitializeSavedCheckpoint,historyEntries:target.checkpoint.history.entries?.length??0,media:target.media.assets.map(a=>({id:a.id,name:a.name,status:a.status}))},warnings:target.warnings};
   while(openPlans.size>=16)openPlans.delete(openPlans.keys().next().value);
   openPlans.set(id,{value,fingerprint:target.fingerprint,sourceFingerprint:active.fingerprint,targetState:await stateKey(target.projectPath),baseline:baselineKey(saved.checkpoint)});return value;
  });
 }
 async function open(input){object(input,['expectedRevision','expectedDocumentId','planId','currentPolicy','dryRun']);checkBool(input.dryRun,'dryRun');
  if(input.currentPolicy!==undefined&&!['preserve','save'].includes(input.currentPolicy))fail('CURRENT_POLICY_REQUIRED','Choose preserve or save for the current project.');
  return runExclusive(async()=>{guard(input);const plan=openPlans.get(input.planId);if(!plan)fail('OPEN_PLAN_NOT_FOUND','Inspect a project before opening it.',404);
   saved=await loadSavedCheckpoint(context().projectPath,context().engine.project,{initialize:false});
   if(plan.value.documentId!==documentId||plan.value.projectRevision!==context().engine.project.revision||plan.baseline!==baselineKey(saved.checkpoint))fail('REVISION_CONFLICT','The current project or saved checkpoint changed. Inspect again.',409);
   if(plan.value.requiresCurrentPolicy&&!input.currentPolicy)fail('CURRENT_POLICY_REQUIRED','Choose whether to preserve working changes or explicitly save before switching.');
   const source=await inspectExistingProject(context().projectPath);
   if(JSON.stringify(source.fingerprint)!==JSON.stringify(plan.sourceFingerprint))fail('PROJECT_FILE_CHANGED','The current working file changed outside this session. Inspect again before switching.',409);
   const fresh=await inspectExistingProject(plan.value.target.projectPath);
   if(JSON.stringify(fresh.fingerprint)!==JSON.stringify(plan.fingerprint))fail('PROJECT_FILE_CHANGED','The selected project changed after preview. Inspect it again.',409);
   if(input.dryRun)return {status:'validated',applied:false,plan:plan.value,warnings:fresh.warnings};
   if(plan.value.sameDocument)return {status:'unchanged',applied:false,document:snapshot(),warnings:[]};
   const targetUpdated=await stateKey(fresh.projectPath)!==plan.targetState;
   const prepared=await prepareExistingProject(fresh.projectPath,{expectedFingerprint:plan.fingerprint,reserveTarget});let currentSaved=false,warnings=[];
   try{
    if(input.currentPolicy==='save'){const c=context(),ownership=await captureMediaOwnership(c.projectPath);saved=await saveExplicitCheckpoint(c.projectPath,c.engine.project,{ownershipIds:ownership.ownershipIds});currentSaved=true;invalidatePlans();}
    const adoptMetadata=()=>{documentId=randomUUID();invalidatePlans();saved=prepared.saved;};
    warnings=await activateExisting(prepared,adoptMetadata);
   }catch(error){
    if(context().projectPath!==prepared.projectPath){await prepared.releaseLock?.().catch(()=>{});error.details={...error.details,activated:false,currentSaved,targetPrepared:true,preparedProjectPath:prepared.projectPath};if(currentSaved)emit();throw error;}
    warnings=[{code:'ACTIVATED_WITH_WARNING',message:error.message}];
   }
   warnings=[...prepared.warnings,...warnings,...(targetUpdated?[{code:'TARGET_SESSION_UPDATED',message:'The target history, saved checkpoint or backups changed after preview; the latest validated state was opened.'}]:[]),...await remember()];emit();
   return {status:'opened',applied:true,activated:true,currentSaved,document:snapshot(),projectRevision:context().engine.project.revision,warnings};
  });
 }
 async function planRevert(input){object(input,['expectedRevision','expectedDocumentId']);return runExclusive(async()=>{guard(input);if(context().draft)fail('NO_SAVED_CHECKPOINT','This Untitled project has no saved checkpoint. Choose a filename with Save first.');saved=await loadSavedCheckpoint(context().projectPath,context().engine.project,{initialize:false});guard(input);if(!saved?.available)fail('NO_SAVED_CHECKPOINT','No verified explicit/opened save checkpoint is available. Save first.');
  const c=context(),point=saved.checkpoint,frozen=c.engine.project;
  const mediaPlan=await planRevertMedia(c.projectPath,frozen,point.project,{savedOwnershipIds:point.mediaOwnershipIds});guard(input);
  if(saved.checkpoint.saveId!==point.saveId)fail('SAVE_POINT_CHANGED','The saved checkpoint changed. Review a new Revert plan.',409);
  const id=randomUUID(),value={id,documentId,projectRevision:frozen.revision,saveId:point.saveId,savedAt:point.savedAt,origin:point.origin,dirty:contentProjectHash(frozen)!==contentProjectHash(point.project),changes:difference(frozen,point.project),historyWillReset:true,media:mediaPlan};
  while(plans.size>=16)plans.delete(plans.keys().next().value);plans.set(id,{value,mediaPlan,saved:structuredClone(point)});return value;
 });}
 async function revert(input){object(input,['expectedRevision','expectedDocumentId','planId','confirm','mediaPolicy','dryRun']);checkBool(input.dryRun,'dryRun');checkBool(input.confirm,'confirm');
  if(!['keep','trash'].includes(input.mediaPolicy))fail('MEDIA_POLICY_REQUIRED','Choose keep or trash for newly created owned media.');
  return runExclusive(async()=>{guard(input);saved=await loadSavedCheckpoint(context().projectPath,context().engine.project,{initialize:false});guard(input);const plan=plans.get(input.planId);if(!plan)fail('REVERT_PLAN_NOT_FOUND','Review a Revert plan first.',404);
   if(plan.value.documentId!==documentId||plan.value.projectRevision!==context().engine.project.revision||plan.value.saveId!==saved?.checkpoint?.saveId||plan.saved.projectHash!==saved?.checkpoint?.projectHash||JSON.stringify(plan.saved.mediaOwnershipIds)!==JSON.stringify(saved?.checkpoint?.mediaOwnershipIds))fail('REVISION_CONFLICT','Revert plan is stale. Review a new plan.',409);
   if(input.confirm!==true)fail('REVERT_CONFIRMATION_REQUIRED','Confirm that edits after the saved checkpoint will be discarded.',409);
   const c=context();if(c.engine.project.revision===Number.MAX_SAFE_INTEGER)fail('REVISION_OVERFLOW','Project revision cannot be incremented safely.',409);
   const target=structuredClone(plan.saved.project);target.revision=c.engine.project.revision+1;const next=new Engine(target),history=next.exportHistory();history.maxSteps=c.engine.historyView.maxSteps;next.restoreHistory(history);
   const inspection=await applyRevertMediaPlan(plan.mediaPlan,{policy:input.mediaPolicy,dryRun:true});
   if(input.dryRun)return {status:'validated',applied:false,plan:plan.value,media:inspection};
   await commitRevert(next);invalidatePlans();let media;
   try{media=await applyRevertMediaPlan(plan.mediaPlan,{policy:input.mediaPolicy});}
   catch(error){media={status:'failed',moved:[],failures:[{code:error.code??'MEDIA_CLEANUP_FAILED',message:error.message}],warnings:['Project reverted; media cleanup did not finish. Files are retained or recorded in the recovery manifest.']};}
   mediaChanged();emit();return {status:'reverted',applied:true,projectCommitted:true,projectRevision:context().engine.project.revision,document:snapshot(),media,historyReset:true};
  });
 }
 async function listTrash(){return listRevertMediaTrash(context().projectPath);}
 async function restoreTrash(operationId,input){object(input,['expectedRevision','expectedDocumentId','dryRun']);checkBool(input.dryRun,'dryRun');return runExclusive(async()=>{guard(input);const result=await restoreRevertMediaTrash(context().projectPath,operationId,{dryRun:Boolean(input.dryRun)});if(!input.dryRun){mediaChanged();emit();}return result;});}
 // Saved metadata follows its open document. Activation gets a fresh request
 // identity, including A -> B -> A, so delayed work cannot cross activations.
 function restoreState(state){saved=state?.saved??null;recentWarnings=state?.recentWarnings??[];documentId=state?randomUUID():null;invalidatePlans();}
 function acceptSaved(value){saved=value;invalidatePlans();}
 return {initialize,snapshot,identity:()=>documentId,exportState:()=>({saved,recentWarnings}),restoreState,acceptSaved,save,saveVersion,planOpen,open,recent,changeRecent,planRevert,revert,listTrash,restoreTrash};
}
