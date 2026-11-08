import {fail} from './schema.mjs';
export function orderedArrangementSiblings(project,parent=null){return [...(project.trackFolders??[]),...project.tracks].filter(n=>(n.parentFolderId??null)===parent).sort((a,b)=>(a.arrangementOrder??Number.MAX_SAFE_INTEGER)-(b.arrangementOrder??Number.MAX_SAFE_INTEGER));}
const find=(items,id,label)=>{const item=items.find(x=>x.id===id);if(!item)fail('NOT_FOUND',`${label} does not exist.`,{id});return item;};
export function applyTrackFolders(project,command,args){
 if(!['folder.fold','folder.add','folder.update','folder.move','folder.remove','folder.tracksState','arrangement.reorder','tracks.moveToFolder'].includes(command))return null;
 const folders=project.trackFolders??[],changes={created:[],updated:[],removed:[]};let targets=[];
 const setParent=(item,parent)=>{if((item.parentFolderId??null)!==(parent??null))delete item.arrangementOrder;if(parent===null||parent===undefined)delete item.parentFolderId;else item.parentFolderId=parent;};
 const parent=args.parentFolderId;if(parent!==undefined&&parent!==null)find(folders,parent,'Parent folder');
 if(command==='folder.fold'){
  const ids=new Set(args.folderIds);for(const id of ids)find(folders,id,'Folder');
  if(args.deep){let grew=true;while(grew){grew=false;for(const child of folders)if(ids.has(child.parentFolderId)&&!ids.has(child.id)){ids.add(child.id);grew=true;}}}
  for(const f of folders)if(ids.has(f.id)){const value=args.mode==='flip'?!f.collapsed:args.mode==='fold';if(f.collapsed!==value){f.collapsed=value;changes.updated.push(f.id);}}
  targets=[...ids];
 }else if(command==='arrangement.reorder'){
  const item=find([...folders,...project.tracks],args.itemId,'Arrangement item'),parent=item.parentFolderId??null,items=orderedArrangementSiblings(project,parent);
  if(args.beforeId===item.id)fail('INVALID_ARGUMENT','An item cannot be placed before itself.');
  const before=args.beforeId===null?null:find(items,args.beforeId,'Sibling');
  const reordered=items.filter(n=>n.id!==item.id),index=before?reordered.indexOf(before):reordered.length;reordered.splice(index,0,item);
  for(const [order,node]of reordered.entries()){if(node.arrangementOrder!==order){node.arrangementOrder=order;changes.updated.push(node.id);}}targets=[item.id];
 }else if(command==='folder.add'){
  if(folders.length>=512)fail('FOLDER_LIMIT','At most 512 track folders are supported.');const tracks=(args.trackIds??[]).map(id=>find(project.tracks,id,'Track')),folder={id:args.id??`folder-${crypto.randomUUID()}`,name:args.name??'Folder',color:args.color??'#97adba',collapsed:false};setParent(folder,parent);project.trackFolders=[...folders,folder];for(const track of tracks){setParent(track,folder.id);changes.updated.push(track.id);}changes.created.push(folder.id);targets=[folder.id,...tracks.map(t=>t.id)];
 }else if(command==='tracks.moveToFolder'){
  for(const id of args.trackIds){const track=find(project.tracks,id,'Track');setParent(track,parent);changes.updated.push(id);}targets=[...args.trackIds];
 }else{
  const folder=find(folders,args.folderId,'Folder');targets=[folder.id];
  if(command==='folder.tracksState'){
   if(args.mute===undefined&&args.solo===undefined)fail('INVALID_ARGUMENT','Specify mute or solo for descendant tracks.');
   if(args.exclusiveSolo&&args.solo!==true)fail('INVALID_ARGUMENT','Exclusive solo requires solo:true.');
   const ids=new Set([folder.id]);let grew=true;while(grew){grew=false;for(const child of folders)if(ids.has(child.parentFolderId)&&!ids.has(child.id)){ids.add(child.id);grew=true;}}
   const descendants=project.tracks.filter(t=>ids.has(t.parentFolderId)),selected=new Set(descendants.map(t=>t.id));
   for(const track of project.tracks){let changed=false;if(selected.has(track.id)){for(const key of ['mute','solo'])if(args[key]!==undefined&&track[key]!==args[key]){track[key]=args[key];changed=true;}}else if(args.exclusiveSolo&&track.solo){track.solo=false;changed=true;}if(changed)changes.updated.push(track.id);}
   targets=[folder.id,...descendants.map(t=>t.id)];
  }else if(command==='folder.update'){for(const key of ['name','color','collapsed'])if(Object.hasOwn(args,key))folder[key]=args[key];changes.updated.push(folder.id);}
  else if(command==='folder.move'){setParent(folder,parent);changes.updated.push(folder.id);}
  else if(!args.deleteContents){for(const item of [...folders,...project.tracks])if(item.parentFolderId===folder.id){setParent(item,folder.parentFolderId);changes.updated.push(item.id);}project.trackFolders=folders.filter(f=>f.id!==folder.id);changes.removed.push(folder.id);}
  else{const ids=new Set([folder.id]);let grew=true;while(grew){grew=false;for(const f of folders)if(ids.has(f.parentFolderId)&&!ids.has(f.id)){ids.add(f.id);grew=true;}}const trackIds=new Set(project.tracks.filter(t=>ids.has(t.parentFolderId)).map(t=>t.id));const clips=project.clips.filter(c=>trackIds.has(c.trackId));changes.removed=[...ids,...trackIds,...clips.flatMap(c=>[c.id,...(c.notes??[]).map(n=>n.id),...(c.events??[]).map(e=>e.id)])];project.trackFolders=folders.filter(f=>!ids.has(f.id));project.tracks=project.tracks.filter(t=>!trackIds.has(t.id));project.clips=project.clips.filter(c=>!trackIds.has(c.trackId));}
 }
 return{changes,resolvedTargets:targets};
}
export function validateTrackFolders(project,register){
 const folders=project.trackFolders??[],byId=new Map(folders.map(f=>[f.id,f]));for(const [i,f]of folders.entries()){register(f,`$.trackFolders[${i}]`);let current=f,depth=0;const seen=new Set();while(current){if(seen.has(current.id))fail('FOLDER_CYCLE','Track folder nesting cannot contain cycles.');seen.add(current.id);if(++depth>32)fail('FOLDER_DEPTH','At most 32 nested folder levels are supported.');if(current.parentFolderId!==undefined){const parent=byId.get(current.parentFolderId);if(!parent)fail('NOT_FOUND','Folder parent is missing.');current=parent;}else current=null;}}
 for(const track of project.tracks)if(track.parentFolderId!==undefined&&!byId.has(track.parentFolderId))fail('NOT_FOUND','Track parent folder is missing.',{trackId:track.id});
}
