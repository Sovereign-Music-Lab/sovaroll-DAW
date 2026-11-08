import test from 'node:test';
import assert from 'node:assert/strict';
import {controllerCurveSchema,controllerLane,controllerValue,withControllerValue,evaluateCurve,validateMidiCurves,materializeMidiCurves,splitMidiCurves,rebaseMidiCurves,reconcileEditedMidiCurves} from '../src/media/midi-curves.mjs';
import {compileMidiStreams} from '../src/media/midi-stream.mjs';
import {parseMidi,writeMidi,writeMidiDetailed} from '../src/media/midi.mjs';
import {renderProject} from '../src/media/render.mjs';
const point=(id,tick,value,curve,cc=11,channel=0,order=tick)=>({id,kind:'channel',status:0xb0|channel,data:[cc,value],tick,order,...(curve?{curve}: {})});
const clip=(events,lengthTicks=100)=>({id:'clip',type:'midi',trackId:'track',startTick:0,lengthTicks,notes:[],events});
const project=c=>({name:'Curves',ppq:100,sampleRate:8000,tempoMap:[{tick:0,bpm:120}],timeSignature:{numerator:4,denominator:4},masterGainDb:0,assets:[],tracks:[{id:'track',type:'midi',name:'Track',gainDb:0,pan:0,instrument:'sine',mute:false,solo:false}],clips:[c]});
const wire=events=>events.map(e=>[e.tick,e.status,e.data]).sort((a,b)=>a[0]-b[0]);
const stats=c=>materializeMidiCurves(c);
const bezier=(a,b)=>({type:'bezier',handles:[{x:1/3,value:a},{x:2/3,value:b}]});
function split(c,delta,chaseControllers=false){const right={...structuredClone(c),id:`${c.id}-right`,startTick:c.startTick+delta,lengthTicks:c.lengthTicks-delta};const changes=splitMidiCurves(c,right,delta,{chaseControllers});c.lengthTicks=delta;c.midiOrderGroup=right.midiOrderGroup='source';return {right,changes};}

test('controller lanes and value writes distinguish CC, bend, pressure, poly pitch and discrete program',()=>{
 const fixtures=[[point('a',0,63),63,'cc'],[{kind:'channel',status:0xe3,data:[127,64]},8319,'pitchBend'],[{kind:'channel',status:0xd2,data:[99]},99,'channelPressure'],[{kind:'channel',status:0xa1,data:[60,42]},42,'polyPressure'],[{kind:'channel',status:0xc5,data:[17]},17,'program']];
 for(const [event,value,kind] of fixtures){const before=structuredClone(event);assert.equal(controllerLane(event).kind,kind);assert.equal(controllerValue(event),value);const changed=withControllerValue(event,controllerLane(event).max);assert.equal(controllerValue(changed),controllerLane(event).max);assert.deepEqual(event,before);}
 assert.equal(controllerLane({kind:'channel',status:0x80,data:[60,0]}),null);assert.equal(controllerLane({kind:'sysex',status:240,data:[1]}),null);
 assert.throws(()=>withControllerValue(point('x',0,0),128),{code:'INVALID_MIDI_CURVE'});assert.equal(controllerCurveSchema.oneOf.length,2);
});

test('one-tick Ramp materialization preserves original endpoints, raw duplicates and input bytes',()=>{
 const c=clip([point('a',0,0,{type:'ramp'}),point('b',10,10),point('same',10,10,undefined,11,0,11)],10),before=structuredClone(c),out=stats(c);
 assert.deepEqual(wire(out.events),Array.from({length:11},(_,i)=>[i,176,[11,i]]).concat([[10,176,[11,10]]]));
 assert.equal(out.stats.generatedEvents,9);assert.deepEqual(c,before);assert.equal(out.events.filter(e=>e.id).length,3);
 out.events[0].data[1]=99;assert.equal(c.events[0].data[1],0);
});

test('Bezier inversion samples an independent cubic and rounds exact positive half values upward',()=>{
 const a=point('a',0,0,bezier(0,0)),b=point('b',100,100),out=stats(clip([a,b]));
 assert.equal(evaluateCurve(a,b,50),12.5);assert.equal(out.events.find(e=>e.tick===50).data[1],13);
 let value=0;const byTick=new Map(out.events.map(e=>[e.tick,e.data[1]]));
 for(let tick=0;tick<=100;tick++){if(byTick.has(tick))value=byTick.get(tick);assert.equal(value,Math.floor(100*(tick/100)**3+.5),`tick ${tick}`);}
});

test('Bezier supports equal-value endpoint humps and stationary time handles without NaN',()=>{
 const a=point('a',0,0,bezier(127,127)),b=point('b',100,0);assert.equal(evaluateCurve(a,b,50),95.25);assert.ok(stats(clip([a,b])).stats.generatedEvents>2);
 a.curve.handles=[{x:1,value:0},{x:0,value:127}];assert.equal(evaluateCurve(a,b,0),0);assert.equal(evaluateCurve(a,b,100),0);for(let tick=0;tick<=100;tick++)assert.ok(Number.isFinite(evaluateCurve(a,b,tick)));
});

test('14-bit bend interpolation carries LSB into MSB and pressure lanes remain isolated',()=>{
 const bend=[{id:'a',kind:'channel',status:0xe2,data:[126,0],tick:0,order:0,curve:{type:'ramp'}},{id:'b',kind:'channel',status:0xe2,data:[2,1],tick:4,order:1}];
 assert.deepEqual(wire(stats(clip(bend,4)).events).map(row=>row[2]),[[126,0],[127,0],[0,1],[1,1],[2,1]]);
 const events=[{id:'a',kind:'channel',status:0xa0,data:[60,0],tick:0,order:0,curve:{type:'ramp'}},{id:'b',kind:'channel',status:0xa0,data:[60,4],tick:4,order:1},{id:'c',kind:'channel',status:0xa0,data:[61,100],tick:2,order:2}];
 assert.deepEqual(wire(stats(clip(events,4)).events).filter(r=>r[2][0]===60).map(r=>r[2][1]),[0,1,2,3,4]);
});

test('same-tick raw points keep all source messages and only the final point starts a nonzero segment',()=>{
 const c=clip([point('first',0,20,{type:'ramp'},11,0,0),point('last',0,0,{type:'ramp'},11,0,1),point('end',10,10)],10);
 const compiled=compileMidiStreams(project(c)).tracks[0].events;
 assert.deepEqual(compiled.filter(e=>e.tick===0).map(e=>e.data),[[11,20],[11,0]]);assert.deepEqual(compiled.find(e=>e.tick===1).data,[11,1]);
});

test('curve source errors reject nonnumeric messages, malformed handles and stale windows',()=>{
 for(const curve of [{type:'step'},{type:'ramp',handles:[]},{type:'bezier',handles:[{x:0,value:0}]},{type:'bezier',handles:[{x:NaN,value:0},{x:1,value:0}]},{type:'bezier',handles:[{x:0,value:128},{x:1,value:0}]},{type:'ramp',unknown:true}])assert.throws(()=>stats(clip([point('a',0,0,curve),point('b',100,100)])),{code:'INVALID_MIDI_CURVE'});
 const a={id:'a',kind:'channel',status:0xc0,data:[1],tick:0,order:0,curve:{type:'ramp'}};assert.throws(()=>stats(clip([a])),{code:'INVALID_MIDI_CURVE'});
 const c=clip([point('a',0,0,{type:'ramp'}),point('b',100,127)]),{right}=split(c,37);right.events.find(e=>e.curve).data[1]++;assert.throws(()=>stats(right),{code:'INVALID_MIDI_CURVE'});
});

test('a final non-Step point holds and reports absent endpoint without inventing a clip-end ramp',()=>{
 const c=clip([point('a',0,45,{type:'ramp'})]),out=stats(c);assert.equal(out.events.length,1);assert.ok(out.diagnostics.some(w=>w.code==='CURVE_WITHOUT_ENDPOINT'));
});

test('materialization rejects event and evaluation limits instead of silently reducing resolution',()=>{
 assert.throws(()=>materializeMidiCurves(clip([point('a',0,0,{type:'ramp'}),point('b',100,100)]),{maxEvents:5}),{code:'MIDI_CURVE_TOO_COMPLEX'});
 const c=clip([point('a',0,0,{type:'ramp'}),point('b',2_000_002,100)],2_000_002);assert.throws(()=>stats(c),{code:'MIDI_CURVE_TOO_COMPLEX'});
 assert.throws(()=>materializeMidiCurves(clip([]),{maxEvaluations:-1}),{code:'INVALID_MIDI_CURVE'});
});

test('risky explicit CC curves materialize with a discrete-effect warning while raw data remains intact',()=>{
 const c=clip([point('a',0,0,{type:'ramp'},64),point('b',100,127,undefined,64)]),before=structuredClone(c),out=stats(c);
 assert.ok(out.diagnostics.some(w=>w.code==='CURVE_DISCRETE_CONTROLLER'&&w.controller===64));assert.deepEqual(c,before);
});

test('fractional Ramp split windows retain every materialized tick and MIDI value without boundary duplication',()=>{
 const c=clip([point('a',0,0,{type:'ramp'}),point('b',100,127)]),before=wire(stats(c).events),{right,changes}=split(c,37);
 assert.equal(right.events.find(e=>e.curve).curve.window.startTick,-37);assert.equal(changes.createdEventIds.length,1);
 assert.deepEqual(wire(stats(c).events.concat(stats(right).events.map(e=>({...e,tick:e.tick+37})))),before);
 const {right:third}=split(right,11);assert.deepEqual(wire(stats(c).events.concat(stats(right).events.map(e=>({...e,tick:e.tick+37})),stats(third).events.map(e=>({...e,tick:e.tick+48})))),before);
});

test('Bezier split windows preserve source geometry across repeated splits and exact endpoint cuts',()=>{
 const c=clip([point('a',0,7,bezier(127,1)),point('b',100,113)]),before=wire(stats(c).events),{right}=split(c,37),{right:third}=split(right,29);
 assert.deepEqual(wire([...stats(c).events,...stats(right).events.map(e=>({...e,tick:e.tick+37})),...stats(third).events.map(e=>({...e,tick:e.tick+66}))]),before);
 const d=clip([point('a',0,0,{type:'ramp'}),point('b',40,40),point('c',100,100)]),prior=wire(stats(d).events),cut=split(d,40);
 assert.equal(cut.changes.createdEventIds.length,0);assert.deepEqual(wire([...stats(d).events,...stats(cut.right).events.map(e=>({...e,tick:e.tick+40}))]),prior);
});

test('Split Controllers chases only nonzero held values and curve continuations distinguish raw versus sample anchors',()=>{
 const c=clip([point('a',0,33),point('zero',0,0,undefined,7,0,1)]),{right}=split(c,50,true);assert.deepEqual(right.events.map(e=>e.data),[[11,33]]);
 const curved=clip([point('a',0,10,{type:'ramp'}),point('b',100,11)]),result=split(curved,20,true);assert.equal(result.right.events.find(e=>e.curve).curve.window.emitStart,'raw');assert.ok(stats(result.right).events.some(e=>e.tick===0&&e.data[1]===10));
 const plain=clip([point('a',0,10,{type:'ramp'}),point('b',100,11)]),silent=split(plain,20);assert.equal(silent.right.events.find(e=>e.curve).curve.window.emitStart,'sample');assert.ok(!stats(silent.right).events.some(e=>e.tick===0));assert.ok(silent.changes.warnings.some(w=>w.code==='MIDI_CURVE_FRAGMENT_NOT_CHASED'));
});

test('intentional point editing rebases only affected windows and reports a new missing local endpoint',()=>{
 const c=clip([point('a',0,0,bezier(127,0)),point('b',100,100)]);split(c,37);const changes=rebaseMidiCurves(c,['a']);
 assert.equal(changes.createdEventIds.length,1);assert.equal(c.events.find(e=>e.id==='a').curve.window,undefined);assert.equal(c.events.at(-1).tick,37);
 c.events[0].data[1]=10;assert.doesNotThrow(()=>validateMidiCurves(c));assert.ok(changes.warnings.some(w=>w.code==='MIDI_CURVE_WINDOW_REBASED'));
});

test('generated messages precede source endpoints within a group while original source order remains unchanged',()=>{
 const c=clip([point('a',0,0,{type:'ramp'},6),point('b',4,4,undefined,6),point('selector',2,0,undefined,101,0,7)],4);c.notes=[{pitch:60,velocity:100,startTick:2,durationTicks:1,onOrder:8,offOrder:9}];
 const events=compileMidiStreams(project(c)).tracks[0].events.filter(e=>e.tick===2);assert.deepEqual(events.map(e=>[e.status,e.data]),[[176,[6,2]],[176,[101,0]],[144,[60,100]]]);
});

test('SMF 0/1 both flatten the identical curve stream while detailed export reports editable-shape loss',()=>{
 const c=clip([point('a',0,0,bezier(127,0)),point('b',100,100)]),p=project(c),before=structuredClone(p);
 for(const format of [0,1]){const result=writeMidiDetailed(p,{format});assert.deepEqual(result.bytes,writeMidi(p,{format}));assert.ok(result.warnings.some(w=>w.includes('not editable curve handles')));const parsed=parseMidi(result.bytes,{ppq:p.ppq});const raw=parsed.tracks.flatMap(t=>t.events??[]).filter(e=>e.status===176);assert.deepEqual(wire(raw),wire(stats(c).events));}
 assert.deepEqual(p,before);
});

test('repeated curve split preserves complete SMF bytes for contiguous shared-lineage fragments',()=>{
 for(const curve of [{type:'ramp'},bezier(127,0)]){const c=clip([point('a',0,0,curve),point('b',100,127)]),p=project(c),bytes=writeMidi(p),{right}=split(c,37);p.clips.push(right);assert.deepEqual(writeMidi(p),bytes);const {right:third}=split(right,11);p.clips.push(third);assert.deepEqual(writeMidi(p),bytes);}
});

test('controller curve PCM equals the same explicitly sampled messages through tempo changes',()=>{
 const c=clip([point('a',0,0,{type:'ramp'}),point('b',100,127)]);c.notes=[{id:'note',pitch:69,velocity:127,startTick:0,durationTicks:100,channel:0}];
 const p=project(c);p.tempoMap=[{tick:0,bpm:120},{tick:43,bpm:83}];const explicit=structuredClone(p);explicit.clips[0].events=stats(c).events.map((e,i)=>{const r=structuredClone(e);delete r.curve;delete r.curveGenerated;delete r.curveSourceId;delete r.curveLane;r.id=`event-${i}`;return r;});
 const a=renderProject(p),b=renderProject(explicit);assert.deepEqual(a.channels,b.channels);assert.ok(a.warnings.some(w=>w.includes('sampled at integer ticks')));
});

test('unsupported pressure curves export sampled values but do not pretend to change oscillator timbre',()=>{
 const c=clip([{id:'a',kind:'channel',status:0xd0,data:[0],tick:0,order:0,curve:{type:'ramp'}},{id:'b',kind:'channel',status:0xd0,data:[127],tick:100,order:1}]);c.notes=[{pitch:69,velocity:100,startTick:0,durationTicks:100}];
 const p=project(c),plain=structuredClone(p);delete plain.clips[0].events[0].curve;
 const a=renderProject(p),b=renderProject(plain);assert.deepEqual(a.channels,b.channels);assert.ok(a.warnings.some(w=>w.includes('pressure')));assert.ok(a.warnings.some(w=>w.includes('sampled')));
});

test('curve expansion evaluation budgets accumulate across clips and selected-track rendering remains bounded',()=>{
 const a=clip([point('a',0,0,{type:'ramp'}),point('b',1_100_001,127)],1_100_001),p=project(a),b=structuredClone(a);b.id='second';b.events.forEach(e=>e.id+='-2');p.clips.push(b);
 assert.throws(()=>compileMidiStreams(p),{code:'MIDI_CURVE_TOO_COMPLEX'});
});

test('direct curve helpers reject malformed times and inconsistent interior window endpoints',()=>{
 const c=clip([point('a',-1,0,{type:'ramp'},11,0,0),point('b',100,127)]);assert.throws(()=>stats(c),{code:'MIDI_EVENT_OUT_OF_BOUNDS'});
 c.events[0].tick=0;c.events[0].curve={type:'ramp',window:{startTick:0,endTick:80,startValue:0,endValue:127,emitStart:'raw'}};c.events.pop();assert.throws(()=>stats(c),{code:'INVALID_MIDI_CURVE'});
 assert.throws(()=>evaluateCurve(point('a',0,0,{type:'bezier',handles:[{x:NaN,value:0},{x:1,value:1}]}),point('b',100,100),50),{code:'INVALID_MIDI_CURVE'});
});

test('200000 coincident raw curve points preserve order without quadratic next-point scans',()=>{
 const events=Array.from({length:200000},(_,i)=>point(`event-${i}`,0,i%128,{type:'ramp'},11,0,i)),out=stats(clip(events,1));
 assert.equal(out.events.length,200000);assert.equal(out.stats.evaluations,0);assert.equal(out.stats.generatedEvents,0);assert.equal(out.events[0].id,'event-0');assert.equal(out.events.at(-1).id,'event-199999');
});

test('more than 128000 curve diagnostics are collected without variadic argument overflow',()=>{
 const events=Array.from({length:131072},(_,i)=>point(`event-${i}`,i,0,i<131071?{type:'ramp'}:undefined,64,0,i)),compiled=compileMidiStreams(project(clip(events,131071)));
 assert.equal(compiled.rawEventCount,131072);assert.equal(compiled.curveStats.evaluations,0);assert.equal(compiled.curveWarnings.length,131072);
});

test('suppressing a continuation sample cannot bypass the original stored payload budget',()=>{
 const events=Array.from({length:4},(_,i)=>({id:`opaque-${i}`,tick:0,order:i,kind:'sysex',status:240,data:new Array(1024*1024).fill(0)}));
 events.push(point('boundary',0,0,{type:'ramp',window:{startTick:-50,endTick:50,startValue:0,endValue:0,emitStart:'sample'}},11,0,4));
 assert.throws(()=>compileMidiStreams(project(clip(events,1))),{code:'MIDI_TOO_LARGE'});
});

test('explicit pasted-window reconciliation retargets only its own destination endpoint and preserves another source lane',()=>{
 for(const shape of [{type:'ramp'},bezier(127,0)]){
  const c=clip([point('source',0,0,shape),point('source-end',1000,100)],1000);split(c,333);
  const sourceBefore=structuredClone(c.events[0]),copy=structuredClone(c.events[0]);copy.id='copied';copy.order=10;copy.data[0]=7;
  const destination=point('destination',200,90,undefined,7,0,11);c.events.push(copy,destination);
  assert.throws(()=>validateMidiCurves(c),{code:'INVALID_MIDI_CURVE'});
  const changes=reconcileEditedMidiCurves(c,['copied']);assert.deepEqual(changes.updatedEventIds,['copied']);assert.deepEqual(changes.createdEventIds,[]);assert.equal(changes.warnings[0].code,'MIDI_CURVE_EDIT_RECONCILED');
  assert.deepEqual(c.events.find(e=>e.id==='source'),sourceBefore);assert.deepEqual(c.events.find(e=>e.id==='destination'),destination);assert.equal(copy.curve.window,undefined);assert.equal(evaluateCurve(copy,destination,200),90);assert.doesNotThrow(()=>validateMidiCurves(c));
 }
});

test('valid copied windows remain byte-identical while reconciliation still rejects malformed selected geometry',()=>{
 const c=clip([point('source',0,0,{type:'ramp'}),point('end',1000,100)],1000);split(c,333);
 const copy=structuredClone(c.events[0]);copy.id='copied';copy.order=10;copy.data[0]=7;c.events.push(copy);
 const before=JSON.stringify(c),changes=reconcileEditedMidiCurves(c,['copied']);assert.deepEqual(changes,{createdEventIds:[],updatedEventIds:[],warnings:[]});assert.equal(JSON.stringify(c),before);
 const bad=structuredClone(c);bad.events.find(e=>e.id==='copied').curve.window.startValue=5;const malformed=JSON.stringify(bad);
 assert.throws(()=>reconcileEditedMidiCurves(bad,['copied']),{code:'INVALID_MIDI_CURVE'});assert.equal(JSON.stringify(bad),malformed);
});

test('explicit copied-window reconciliation adds a missing interior endpoint without reshaping the source window or replacing later points',()=>{
 const event=point('copied',0,0,bezier(127,0));event.curve.window={startTick:0,endTick:1000,startValue:0,endValue:100,emitStart:'raw'};
 const later=point('later',1200,70),c=clip([event,later],1500),windowBefore=structuredClone(event.curve),laterBefore=structuredClone(later);
 assert.throws(()=>validateMidiCurves(c),{code:'INVALID_MIDI_CURVE'});const changes=reconcileEditedMidiCurves(c,['copied']);
 assert.equal(changes.createdEventIds.length,1);assert.deepEqual(changes.updatedEventIds,['copied']);assert.deepEqual(event.curve,windowBefore);assert.deepEqual(later,laterBefore);
 const added=c.events.find(e=>e.id===changes.createdEventIds[0]);assert.equal(added.tick,1000);assert.deepEqual(added.data,[11,100]);assert.equal(added.curve,undefined);assert.doesNotThrow(()=>validateMidiCurves(c));
});
