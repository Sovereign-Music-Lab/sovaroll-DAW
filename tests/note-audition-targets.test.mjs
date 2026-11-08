import test from 'node:test';
import assert from 'node:assert/strict';
import {noteAuditionTargets as choose} from '../public/note-audition-targets.mjs';
const points=[{noteId:'a',tick:0,value:50},{noteId:'b',tick:480,value:90},{noteId:'c',tick:480,value:70},{noteId:'d',tick:960,value:80}];
test('Audition follows the nearest onset chord instead of replaying painted history',()=>{assert.deepEqual(choose(points,500).updates,[{noteId:'b',value:90},{noteId:'c',value:70}]);assert.deepEqual(choose(points,950).updates,[{noteId:'d',value:80}]);assert.equal(choose(points,720).onset,480);});
test('Audition preserves original preview including unchanged values and detects oversized whole chords',()=>{const before=structuredClone(points);assert.equal(choose(points,0).updates[0].value,50);assert.deepEqual(points,before);const oversized=Array.from({length:33},(_,i)=>({noteId:String(i),tick:0,value:70}));assert.deepEqual(choose(oversized,0),{onset:0,overflow:true,count:33,updates:[]});assert.deepEqual(choose([],0),{onset:null,overflow:false,count:0,updates:[]});});
