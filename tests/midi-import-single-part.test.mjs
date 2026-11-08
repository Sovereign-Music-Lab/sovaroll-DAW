import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeImportedMidiTracks} from '../src/media/midi-import-single-part.mjs';
test('single-part merge preserves channels, bytes and same-tick source order without mutating input',()=>{
 const tracks=[{name:'A',endTick:960,notes:[{pitch:60,channel:0,startTick:0,durationTicks:480,onOrder:1,offOrder:3}],events:[{tick:0,order:0,status:192,data:[40]}]},{name:'B',endTick:720,notes:[{pitch:36,channel:9,startTick:0,durationTicks:0,onOrder:1,offOrder:2}],events:[{tick:0,order:0,status:240,data:[125,247]}]}];
 const before=structuredClone(tracks),result=mergeImportedMidiTracks(tracks,'Combined');
 assert.equal(result.name,'Combined');assert.equal(result.endTick,960);assert.deepEqual(result.notes.map(n=>n.channel),[0,9]);assert.deepEqual(result.events.map(e=>e.data),[[40],[125,247]]);
 assert(result.events[0].order<result.notes[0].onOrder);assert(result.notes[0].onOrder<result.events[1].order);assert(result.events[1].order<result.notes[1].onOrder);assert(result.notes[1].onOrder<result.notes[1].offOrder);
 const orders=[...result.events.map(e=>e.order),...result.notes.flatMap(n=>[n.onOrder,n.offOrder])];assert.equal(new Set(orders).size,orders.length);assert.deepEqual(tracks,before);
 result.events[0].data[0]=1;assert.deepEqual(tracks,before);
});
test('empty MIDI source does not fabricate a part',()=>assert.equal(mergeImportedMidiTracks([]),null));
