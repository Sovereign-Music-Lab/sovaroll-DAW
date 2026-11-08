import {requireValue} from './common.mjs';
import {defaultModifiers,defaultPartModifiers} from './midi-modifiers.mjs';
export function prepareMidiExportProject(project,input={}){
 const options=Object.fromEntries(['includeInspectorPatch','includeInspectorVolumePan','includeModifiers','includeMarkers','includeDelay'].map(key=>{const value=input[key]===undefined?true:input[key];requireValue(typeof value==='boolean','INVALID_MIDI_EXPORT_OPTIONS',`${key} must be boolean.`);return [key,value];}));
 if(Object.values(options).every(Boolean))return {project,options};
 const output=structuredClone(project);
 for(const track of output.tracks){if(!options.includeModifiers&&track.midiModifiers)track.midiModifiers=defaultModifiers();if(track.midiParameters){const p=track.midiParameters;if(!options.includeInspectorPatch)for(const key of ['program','bankMsb','bankLsb'])p[key]=null;if(!options.includeInspectorVolumePan)for(const key of ['volume','pan'])p[key]=null;if(!options.includeDelay)p.delayMs=0;}}
 if(!options.includeModifiers)for(const clip of output.clips)if(clip.midiModifiers)clip.midiModifiers=defaultPartModifiers();
 if(!options.includeMarkers)output.markers=[];
 return {project:output,options};
}
