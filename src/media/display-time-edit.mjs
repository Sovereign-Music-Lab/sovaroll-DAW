import {midiTickFraction} from './midi-display-time.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
export function formatDisplayTicks(ticks,ppq,displayPpq) {
  if(!Number.isSafeInteger(ticks))fail('INVALID_DISPLAY_TICK','Stored tick must be a safe integer');
  const value=midiTickFraction(Math.abs(ticks),ppq,displayPpq);
  return `${ticks<0?'-':''}${value.numerator}${value.denominator===1?'':`/${value.denominator}`}`;
}
/** Exact editable fractions, never locale decimals or implicit rounding. */
export function parseDisplayTicks(input,ppq,displayPpq,{signed=false}={}) {
  midiTickFraction(0,ppq,displayPpq);
  if(typeof signed!=='boolean')fail('INVALID_DISPLAY_TICK','signed must be boolean');
  if(typeof input==='number'){
    if(!Number.isSafeInteger(input))fail('INVALID_DISPLAY_TICK','Use an integer or an exact numerator/denominator string');
    input=String(input);
  }
  if(typeof input!=='string'||input.length>83)fail('INVALID_DISPLAY_TICK','Display tick must be a bounded integer or fraction');
  const match=/^(-?)([0-9]{1,64})(?:\/([0-9]{1,16}))?$/.exec(input);
  if(!match||match[1]&&!signed)fail('INVALID_DISPLAY_TICK','Use a nonnegative integer/fraction (signed only for deltas)');
  const denominator=BigInt(match[3]??1);
  if(denominator<1n||denominator>MAX)fail('INVALID_DISPLAY_TICK','Fraction denominator must be a positive safe integer');
  const n=BigInt(match[2])*BigInt(ppq),d=denominator*BigInt(displayPpq);
  if(n%d)fail('MIDI_TICK_NOT_REPRESENTABLE','Displayed time does not fall on a stored project tick');
  const value=n/d;
  if(value>MAX)fail('MIDI_TICK_OVERFLOW','Displayed time exceeds safe project tick range');
  return value===0n?0:Number(match[1]?-value:value);
}

// Only explicitly supplied time fields are translated. All other arguments,
// including clipboard offsets and curve geometry, retain source-tick units.
const fields={
  'clip.update':{startTick:false,lengthTicks:false},
  'midi.notes.update':{startTick:false,durationTicks:false},
  'midi.notes.move':{deltaTick:true},
  'midi.events.update':{tick:false},
  'midi.events.add':{},
  'midi.controllers.move':{deltaTick:true},
  'midi.controllers.paste':{atTick:false},
  'midi.controllers.line':{startTick:false,endTick:false,stepTicks:false}
};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function resolveDisplayTimeCommand(command,args,displayTimes,{ppq,displayPpq}={}) {
  if(command!=='batch'&&!Object.hasOwn(fields,command))fail('UNSUPPORTED_DISPLAY_TIME_COMMAND','This command has no supported display-time fields');
  if(!plain(args)||!plain(displayTimes)||!Object.keys(displayTimes).length||Object.keys(displayTimes).length>200000)fail('INVALID_DISPLAY_TIME_FIELDS','Use an arguments object and1–200000 explicit display-time fields');
  midiTickFraction(0,ppq,displayPpq);
  const output=structuredClone(args);
  if(command==='batch'){
    if(!Array.isArray(output.commands)||!output.commands.length||output.commands.length>200000||output.commands.some(c=>!plain(c)||!Object.hasOwn(fields,c.command)||!plain(c.arguments)))fail('INVALID_DISPLAY_TIME_FIELDS','Use one flat batch of supported MIDI time commands');
    const grouped=new Map();
    for(const [path,value]of Object.entries(displayTimes)){
      const match=/^commands\.(0|[1-9][0-9]{0,5})\.arguments\.(.+)$/.exec(path);
      if(!match||Number(match[1])>=output.commands.length)fail('INVALID_DISPLAY_TIME_FIELDS','Use commands.N.arguments.FIELD for an existing command');
      const index=Number(match[1]);if(!grouped.has(index))grouped.set(index,{});
      Object.defineProperty(grouped.get(index),match[2],{value,enumerable:true});
    }
    for(const [index,times]of grouped){const c=output.commands[index];c.arguments=resolveDisplayTimeCommand(c.command,c.arguments,times,{ppq,displayPpq});}
    return output;
  }
  for(const [name,value]of Object.entries(displayTimes)){
    let target=output,key=name,signed=false;
    if(command==='midi.events.add'){
      const match=/^events\.(0|[1-9][0-9]{0,5})\.tick$/.exec(name);
      if(!match||!Array.isArray(output.events)||Number(match[1])>=output.events.length||!plain(output.events[Number(match[1])]))fail('INVALID_DISPLAY_TIME_FIELDS','Use events.N.tick for an existing event object');
      target=output.events[Number(match[1])];key='tick';
    }else{
      if(!Object.hasOwn(fields[command],name))fail('INVALID_DISPLAY_TIME_FIELDS',`Unsupported display-time field ${name}`);
      signed=fields[command][name];
    }
    if(Object.hasOwn(target,key))fail('AMBIGUOUS_TIME_UNITS',`Remove source field ${name} before supplying its display value`);
    target[key]=parseDisplayTicks(value,ppq,displayPpq,{signed});
  }
  return output;
}
