import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderProject } from '../src/media/render.mjs';
import { encodeWav } from '../src/media/wav.mjs';

function fixture(kind){
 const p={name:'legacy',ppq:960,sampleRate:8000,tempoMap:[{tick:0,bpm:120},{tick:180,bpm:83}],timeSignature:{numerator:4,denominator:4},masterGainDb:-3,tracks:[{id:'a',type:'midi',instrument:'triangle',gainDb:-2,pan:.31},{id:'audio',type:'audio',gainDb:-6,pan:-.22},{id:'b',type:'midi',instrument:'sawtooth',gainDb:-4,pan:-.1}],clips:[],assets:[]};
 p.clips=[{id:'c1',trackId:'a',type:'midi',startTick:0,lengthTicks:400,notes:[{pitch:67,startTick:120,durationTicks:190,velocity:119,channel:3},{pitch:60,startTick:7,durationTicks:250,velocity:63,channel:0},{pitch:60,startTick:80,durationTicks:97,velocity:111,channel:0},{pitch:64,startTick:0,durationTicks:360,velocity:127,channel:2}]},{id:'c2',trackId:'b',type:'midi',startTick:11,lengthTicks:380,notes:[{pitch:70,startTick:1,durationTicks:340,velocity:90,channel:2},{pitch:65,startTick:30,durationTicks:200,velocity:100,channel:4}]}];
 const assets=new Map();
 if(kind==='mixed'||kind==='audio'){
  const channels=[Float32Array.from({length:2048},(_,i)=>Math.sin(i*.081)*.3),Float32Array.from({length:2048},(_,i)=>Math.cos(i*.033)*.1)];
  assets.set('wav',{sampleRate:11025,frames:2048,channels});p.assets=[{id:'wav',sampleRate:11025,frames:2048,channels:2}];p.clips.splice(1,0,{id:'ac',trackId:'audio',type:'audio',assetId:'wav',startSample:19,offsetFrames:31,lengthFrames:1301,gainDb:-1});
 }
 if(kind==='audio'){p.clips=p.clips.filter(c=>c.type==='audio');p.tracks=p.tracks.filter(t=>t.type==='audio');}
 return {p,assets};
}

// These nine hashes were captured from v0.11 render.mjs before the state renderer
// was connected. Unsorted notes, overlapping pitches, tempo changes and audio
// between MIDI clips exercise Float32 accumulation order as well as oscillator math.
const golden={
 legacy:['e8e2d67edc9a5a83e146d6590300bb704e9d8a6d62a5d4dea45097941fcf9edb','5490542df5363c62b37b581ef4477d681175b80ad0390cd7b4becaa6ed642d2f','a6fdc21598cde97c0b8a181abfa9a84d50a3223fb579038f4a9ca0e6f663c312'],
 mixed:['11f8f336048e21c93a951463c805894c998b5b38fe9de31d91c2978b33906466','7ea1a2516cba31cc42af7ad78a217b3f314e2e698d816e906d9d128a7cc6d818','9d4f7d7dc4e65e658e1a3755fedd0008c2070862530bbec4d0733c5db44cfbd9'],
 audio:['14bc0f62af6eb2ba6b225e3cd4231e9de0e6a1b2480550f8e56fc6ff10ff0fd6','8abdc7d9327318b5561975644da4b8a5065fa0e9c6486bf2c7f9cb95c5ee7727','02355614bd0c2f4695971195bac708e3c82bfb024cc04024351cdcddb1e5a7c2'],
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('independent pre-v12 legacy, mixed WAV/MIDI and audio-only goldens retain both Float32 channels and PCM WAV bytes',()=>{
 for(const kind of ['legacy','mixed','audio']){
  const {p,assets}=fixture(kind),before=structuredClone(p),result=renderProject(p,assets,{durationSeconds:.4});
  assert.equal(result.frames,3200);const actual=result.channels.map(channel=>hash(new Uint8Array(channel.buffer,channel.byteOffset,channel.byteLength)));
  actual.push(hash(encodeWav({sampleRate:result.sampleRate,channels:result.channels})));assert.deepEqual(actual,golden[kind],kind);assert.deepEqual(p,before);
 }
});

test('independent exact-time phase integral retains two distinct bend changes inside one output sample',()=>{
 const ppq=32767,sampleRate=8000,ticks=[5041,5042],values=[16383,0],times=ticks.map(tick=>tick/(2*ppq)),factors=values.map(value=>2**(((value-8192)/8192)*2/12));
 assert.equal(Math.ceil(times[0]*sampleRate),Math.ceil(times[1]*sampleRate));
 const p={ppq,sampleRate,tempoMap:[{tick:0,bpm:120}],masterGainDb:0,tracks:[{id:'t',type:'midi',instrument:'sine',gainDb:0,pan:0}],assets:[],clips:[{id:'c',trackId:'t',type:'midi',startTick:0,lengthTicks:65534,notes:[{id:'n',pitch:69,channel:0,velocity:100,startTick:0,durationTicks:50000}],events:[{kind:'channel',tick:ticks[0],status:0xe0,data:[127,127],order:0},{kind:'channel',tick:ticks[0],status:0xb0,data:[7,63],order:1},{kind:'channel',tick:ticks[1],status:0xe0,data:[0,0],order:2}]}]};
 const result=renderProject(p,new Map(),{durationSeconds:1}),boundary=Math.ceil(times[1]*sampleRate),amplitude=100/127*.2*Math.cos(Math.PI/4);
 for(const frame of [boundary-1,boundary,boundary+1,1000]){
  const time=frame/sampleRate;
  // Independent analytical integral: old frequency until first timestamp,
  // first bend only for its exact sub-sample interval, then second bend.
  const integral=Math.min(time,times[0])+Math.max(0,Math.min(time,times[1])-times[0])*factors[0]+Math.max(0,time-times[1])*factors[1];
  const gain=frame<boundary?1:63/127,expected=Math.fround(Math.sin(2*Math.PI*440*integral)*amplitude*gain);
  assert.ok(Math.abs(result.channels[0][frame]-expected)<1e-7,`frame ${frame}: ${result.channels[0][frame]} versus ${expected}`);
 }
 const wrongIntegral=times[0]+(boundary/sampleRate-times[0])*factors[1];
 const wrong=Math.fround(Math.sin(2*Math.PI*440*wrongIntegral)*amplitude*(63/127));
 assert.ok(Math.abs(result.channels[0][boundary]-wrong)>1e-5,'The first same-sample bend must contribute to phase, not be discarded.');
});
