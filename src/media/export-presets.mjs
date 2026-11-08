import {requireValue} from './common.mjs';
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
export const exportPresetOptionsSchema={type:'object',additionalProperties:false,properties:{autoEffectTail:{type:'boolean'},fileFormat:{type:'string',enum:['wav','aiff']},dither:{type:'string',enum:['none','tpdf']},ditherSeed:integer(1,0xffffffff),outputSampleRate:{oneOf:[{const:null},integer(8000,96000)]},sampleFormat:{type:'string',enum:['pcm16','pcm24','float32']},channelMode:{type:'string',enum:['stereo','mono','left','right']},tailSeconds:{type:'number',minimum:0,maximum:10},stemSplitChannels:{type:'boolean'}},required:['outputSampleRate','sampleFormat','channelMode','tailSeconds','stemSplitChannels']};
export const exportPresetSchema={type:'object',additionalProperties:false,properties:{id:{type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]*$'},name:{type:'string',minLength:1,maxLength:120,pattern:'\\S'},options:exportPresetOptionsSchema},required:['id','name','options']};

/** Explicit render options override format-preset defaults. Track/range/path
 * remain the caller's choices. Retain provenance without claiming an exact
 * preset match after explicit overrides.
 */
export function resolveExportPresetOptions(project,options){
 if(options.exportPresetId===undefined)return options;
 const preset=project.exportPresets?.find(p=>p.id===options.exportPresetId);
 requireValue(preset,'EXPORT_PRESET_NOT_FOUND','Export preset was not found in this project.');
 const defaults={...preset.options};if(defaults.outputSampleRate===null)delete defaults.outputSampleRate;if(!defaults.stemSplitChannels)delete defaults.stemSplitChannels;
 const resolved={...defaults,...options,exportPresetId:preset.id,exportPresetName:preset.name};if(resolved.outputSampleRate===null)delete resolved.outputSampleRate;
 requireValue(!resolved.stemSplitChannels||resolved.stemBatch,'INVALID_PRESET_SCOPE','L/R split preset requires a stem batch export.');
 requireValue(!resolved.stemSplitChannels||(resolved.channelMode??'stereo')==='stereo','INVALID_PRESET_SCOPE','L/R split requires stereo channel mode.');
 return resolved;
}
