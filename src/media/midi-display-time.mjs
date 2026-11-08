/** Display resolution is independent of stored project/SMF PPQ. The manual's
 * default120 ticks/sixteenth corresponds to480 display ticks/quarter. */
export const DEFAULT_MIDI_DISPLAY_PPQ=480;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const integer=(n,min,max,name)=>{if(!Number.isSafeInteger(n)||n<min||n>max)fail('INVALID_MIDI_TICK',`${name} must be an integer in ${min}…${max}`);};
function ratio(ticks,fromPpq,toPpq){
 integer(ticks,0,Number.MAX_SAFE_INTEGER,'ticks');integer(fromPpq,1,32767,'source PPQ');integer(toPpq,1,32767,'target PPQ');
 return [BigInt(ticks)*BigInt(toPpq),BigInt(fromPpq)];
}
/** Exact, JSON-safe rational view. No project quantization is performed. */
export function midiTickFraction(ticks,fromPpq,toPpq){
 let [n,d]=ratio(ticks,fromPpq,toPpq),a=n,b=d;while(b){const r=a%b;a=b;b=r;}n/=a;d/=a;
 return {numerator:n.toString(),denominator:Number(d)};
}
/** Explicit rounding at an editing/output boundary. BigInt prevents precision
 * loss in intermediate multiplication even for safe integer project positions. */
export function convertMidiTicks(ticks,fromPpq,toPpq,rounding='exact'){
 if(!['exact','floor','ceil','nearest'].includes(rounding))fail('INVALID_MIDI_TICK_ROUNDING','Use exact, floor, ceil or nearest');
 const [n,d]=ratio(ticks,fromPpq,toPpq),remainder=n%d;let value=n/d;
 if(rounding==='exact'&&remainder)fail('MIDI_TICK_NOT_REPRESENTABLE','Tick does not fall on the target resolution; choose an explicit rounding policy');
 if(rounding==='ceil'&&remainder||rounding==='nearest'&&2n*remainder>=d)value++;
 if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('MIDI_TICK_OVERFLOW','Converted tick exceeds safe project position range');
 return Number(value);
}
