const choice=values=>({type:'string',enum:values});
const ticks={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
export const stepSettingFields={stepSource:choice(['ticks','pianoGrid','primaryGrid']),lengthSource:choice(['ticks','step','pianoGrid','primaryGrid','noteValue']),stepTicks:ticks,durationTicks:ticks,lengthDenominator:{type:'integer',enum:[1,2,4,8,16,32,64,128]},lengthModifier:choice(['straight','dotted','triplet'])};
export const stepSettingsSchema={type:'object',additionalProperties:false,properties:stepSettingFields,required:Object.keys(stepSettingFields)};
export function resolveStepSettings(project){return{stepSource:'ticks',lengthSource:'ticks',stepTicks:project.ppq,durationTicks:project.ppq,lengthDenominator:16,lengthModifier:'straight',...project.midiStepSettings};}
