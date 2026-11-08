import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareNotePaste as paste} from '../public/note-clipboard.mjs';
test('Ordinary Paste preserves relative distance and musical data with fresh endpoint ownership',()=>{const notes=[{id:'a',startTick:0,durationTicks:120,pitch:60,velocity:70,releaseVelocity:25,onOrder:1,offOrder:2},{id:'b',startTick:240,durationTicks:60,pitch:64,velocity:90}],before=structuredClone(notes);const p=paste(notes,{atTick:480,lengthTicks:960});assert.deepEqual(p.map(n=>n.startTick),[480,720]);assert.equal(p[0].releaseVelocity,25);assert.equal(p[0].id,undefined);assert.equal(p[0].onOrder,undefined);assert.deepEqual(notes,before);});
test('Ordinary Paste rejects out-of-part notes and unsafe positions before committing',()=>{assert.throws(()=>paste([{startTick:10,durationTicks:100}],{atTick:900,lengthTicks:960}));assert.throws(()=>paste([],{atTick:-1,lengthTicks:960}));});

import {captureNoteClipboard as capture} from '../public/note-clipboard.mjs';
test('Note clipboard capture normalizes a detached selection and preserves source attributes',()=>{const notes=[{id:'a',startTick:120,durationTicks:60,pitch:60,velocity:90},{id:'b',startTick:360,durationTicks:240,pitch:72,velocity:70}],c=capture(notes);assert.equal(c.lengthTicks,480);assert.deepEqual(c.notes.map(n=>n.startTick),[0,240]);c.notes[0].velocity=1;assert.equal(notes[0].velocity,90);assert.throws(()=>capture([]));assert.throws(()=>capture([{startTick:0,durationTicks:0}]));});
