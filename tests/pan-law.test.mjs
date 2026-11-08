import test from 'node:test';
import assert from 'node:assert/strict';
import {panGains,monoSumGain,PAN_LAW_DB} from '../src/media/pan-law.mjs';
import {prepareMixOutput} from '../src/media/mix-output.mjs';
test('numeric pan laws have specified center attenuation, monotonic sides and unity endpoints',()=>{
 for(const [law,db] of Object.entries(PAN_LAW_DB)){
  const center=panGains(0,law),expected=10**(db/20);assert(Math.abs(center.monoLeft-expected)<1e-12);assert(Math.abs(center.monoRight-expected)<1e-12);assert.equal(center.stereoLeft,1);assert.equal(center.stereoRight,1);
  let left=1,right=0;for(let i=0;i<=100;i++){const g=panGains(-1+i/50,law);assert(g.monoLeft<=left+1e-12);assert(g.monoRight>=right-1e-12);left=g.monoLeft;right=g.monoRight;}assert.equal(left,0);assert.equal(right,1);
  const mono=prepareMixOutput({panLaw:law,channels:[new Float32Array([1]),new Float32Array([1])],warnings:[]},'mono');assert(Math.abs(mono.channels[0][0]-2*monoSumGain(law))<1e-6);
 }
});
test('Equal Power remains constant power and legacy gains match it exactly',()=>{
 for(let i=0;i<=100;i++){const pan=-1+i/50,g=panGains(pan,'equalPower');assert(Math.abs(g.monoLeft**2+g.monoRight**2-1)<1e-12);assert.deepEqual(panGains(pan,'legacy'),g);}
 assert.equal(monoSumGain('legacy'),.5);assert.equal(monoSumGain('equalPower'),Math.SQRT1_2);
});
