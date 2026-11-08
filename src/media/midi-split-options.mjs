export const defaultMidiSplitOptions=()=>({splitNotes:true,chaseControllers:false});
export function resolveMidiSplitOptions(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['splitNotes','chaseControllers'].includes(k))||Object.values(input).some(v=>typeof v!=='boolean'))throw Object.assign(new Error('MIDI split options must be known boolean fields'),{code:'INVALID_SPLIT_OPTIONS'});
 return {...defaultMidiSplitOptions(),...input};
}
