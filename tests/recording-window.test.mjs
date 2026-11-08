import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingBlockWindow} from '../public/microphone-recorder.mjs';
const window=(captureFrom,extra={})=>recordingBlockWindow({blockStart:1,blockFrames:480,sampleRate:48000,captureFrom,remainingFrames:1000,...extra});
test('capture discards count-in frames within a block and keeps the exact boundary frame',()=>{
 assert.deepEqual(window(1.005),{offset:240,count:240});
 assert.deepEqual(window(1.01),{offset:480,count:0});
 assert.deepEqual(window(.9),{offset:0,count:480});
 assert.deepEqual(window(Infinity),{offset:0,count:0});
 assert.deepEqual(window(1.005,{remainingFrames:100}),{offset:240,count:100});
 assert.deepEqual(window(1+240.1/48000),{offset:241,count:239});
});
