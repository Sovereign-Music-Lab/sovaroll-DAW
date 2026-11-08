export const MIDI_INPUT_TYPES=['note','cc','pitchBend','program','channelPressure','polyPressure'];
export const midiInputFilterSchema={type:'object',additionalProperties:false,properties:{channels:{type:'array',items:{type:'integer',minimum:0,maximum:15},uniqueItems:true,maxItems:16},messageTypes:{type:'array',items:{type:'string',enum:MIDI_INPUT_TYPES},uniqueItems:true,maxItems:6}}};
export function allowsMidiInput(data,filter={}){
 const status=data?.[0];if(!Number.isInteger(status)||status<128||status>=240)return false;
 const type=({8:'note',9:'note',10:'polyPressure',11:'cc',12:'program',13:'channelPressure',14:'pitchBend'})[status>>4];
 return (!filter.channels||filter.channels.includes(status&15))&&(!filter.messageTypes||filter.messageTypes.includes(type));
}
