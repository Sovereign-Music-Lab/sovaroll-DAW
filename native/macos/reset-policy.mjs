/** MIDI Reset wire policy. This module emits no I/O. Manual reset, reset on stop,
 * and preserving chased controllers are separate settings.
 * MIDI CC121 is the controller reset
 * message; CC120 silences voices without resetting ordinary controller values.
 *
 * The caller must cancel/serialize transport before sending these batches, freeze
 * endpoint identities and report partial/uncertain sends. Those owner guarantees
 * are NOT provided by this compiler or by an array of successfully built bytes.
 */
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export const MIDI_RESET_POLICY_VERSION=1;

export function compileMidiReset(input){
 if(!exact(input,['reason','destinations','preferences'])||!['manual','stop','locate','shutdown','failure'].includes(input.reason))fail('MIDI_RESET_OPTIONS','Reset requires reason, explicit destinations and preferences');
 const {reason,destinations,preferences}=input;
 if(!exact(preferences,['resetOnStop','neverResetChasedControllers'])||Object.values(preferences).some(x=>typeof x!=='boolean'))fail('MIDI_RESET_PREFERENCES','Reset preferences must be explicit booleans; defaults are a separate profile decision');
 if(!Array.isArray(destinations)||destinations.length>64||Array.from(destinations).some(id=>!Number.isInteger(id)||id < -2147483648||id > 2147483647)||new Set(destinations).size!==destinations.length)fail('MIDI_RESET_DESTINATIONS','Use at most64 unique signed32 destination IDs; names and fallback ports are not accepted');
 // Emergency/teardown cleanup remains the backend's owned-note release contract.
 // It must not unexpectedly reset every channel on unrelated/shared instruments.
 const requested=reason==='manual'||reason==='locate'||reason==='stop'&&preferences.resetOnStop;
 if(requested&&!destinations.length)fail('MIDI_RESET_DESTINATIONS','Select at least one explicit output destination for Reset');
 const resetControllers=requested&&(reason==='manual'||!preferences.neverResetChasedControllers);
 const batches=[];
 if(requested)for(const destinationId of destinations)for(let channel=0;channel<16;channel++){
  const messages=Array.from({length:128},(_,pitch)=>[0x80|channel,pitch,0]);
  // Explicit per-key offs cover unknown voices. All Notes Off and All Sound Off
  // also cover receiver voice stacks and pedal-held notes, without changing CC64.
  messages.push([0xb0|channel,123,0],[0xb0|channel,120,0]);
  if(resetControllers)messages.push([0xb0|channel,121,0]);
  // A channel batch stays below the existing native1024-message request limit.
  batches.push({destinationId,channel,messages});
 }
 return {policyVersion:MIDI_RESET_POLICY_VERSION,reason,preferences:{...preferences},destinations:[...destinations],requested,resetControllers,
  messageCount:batches.reduce((sum,b)=>sum+b.messages.length,0),batches,
  scope:'all16-channels-of-explicit-destinations',
  cleanupRequired:true,
  warnings:requested?[{code:'MIDI_RESET_SHARED_CHANNELS',message:'Reset affects all16 channels on the selected destinations, including voices from other applications. Physical device response is not established by successful MIDI transmission.'}]:[]};
}
