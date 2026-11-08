import test from 'node:test';import assert from 'node:assert/strict';import {playbackFollowScroll} from '../src/media/editor-geometry.mjs';
const follow=(x,scrollLeft=0)=>playbackFollowScroll({x,scrollLeft,viewportWidth:1000,contentWidth:5000});
test('playback follows page edges, cycle return and content boundaries',()=>{assert.equal(follow(500),0);assert.equal(follow(980),780);assert.equal(follow(10,2000),0);assert.equal(follow(4999,3000),4000);assert.equal(follow(1500,1000),1000);});

test('stationary follow centers continuously and clamps at project edges',()=>{const f=x=>playbackFollowScroll({x,scrollLeft:0,viewportWidth:1000,contentWidth:5000,mode:'stationary'});assert.equal(f(1500),1000);assert.equal(f(100),0);assert.equal(f(4999),4000);});
