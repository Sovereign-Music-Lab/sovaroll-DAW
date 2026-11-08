import {requireValue} from './common.mjs';
/** Detached render scope, retaining all clip extents for aligned output lengths.
 * Explicit selection bypasses solo isolation, preserves selected mute/gain/pan,
 * and retains master gain. This is not a send/FX-routing stem graph.
 */
export function selectRenderTracks(project,trackIds){
 if(trackIds===undefined)return project;
 requireValue(Array.isArray(trackIds)&&trackIds.length>0&&trackIds.length<=4096&&trackIds.every(id=>typeof id==='string')&&new Set(trackIds).size===trackIds.length,'INVALID_RENDER_TRACKS','Use 1..4096 unique track IDs.');
 const selected=new Set(trackIds),present=new Set(project.tracks.map(t=>t.id));
 for(const id of selected)requireValue(present.has(id),'INVALID_RENDER_TRACKS',`Render track not found: ${id}.`);
 return {...project,tracks:project.tracks.map(track=>({...track,mute:track.mute||!selected.has(track.id),solo:false}))};
}

/** Audition clips without changing stored mute/solo or removing timeline extents.
 * Explicit clip selection bypasses other tracks' solo, but preserves all mutes. */
export function selectRenderClips(project,clipIds){
 if(clipIds===undefined)return project;
 requireValue(Array.isArray(clipIds)&&clipIds.length>0&&clipIds.length<=4096&&clipIds.every(id=>typeof id==='string')&&new Set(clipIds).size===clipIds.length,'INVALID_RENDER_CLIPS','Use 1..4096 unique clip IDs.');
 const selected=new Set(clipIds),clips=new Map(project.clips.map(c=>[c.id,c]));
 for(const id of selected)requireValue(clips.has(id),'INVALID_RENDER_CLIPS',`Render clip not found: ${id}.`);
 const scoped=selectRenderTracks(project,[...new Set(clipIds.map(id=>clips.get(id).trackId))]);
 return {...scoped,clips:scoped.clips.map(clip=>({...clip,mute:clip.mute||!selected.has(clip.id)}))};
}

/** Temporary audition path. Pre, channel gain/pan and master remain active. */
export function bypassRenderEffects(project,bypass){
 requireValue(bypass===undefined||typeof bypass==='boolean','INVALID_EFFECT_BYPASS','Effect bypass must be boolean.');
 if(!bypass)return project;
 return {...project,tracks:project.tracks.map(track=>{const {eq,delay,...dry}=track;return dry;})};
}
