import {requireValue} from './common.mjs';
export const PAN_LAW_DB=Object.freeze({'-3dB':-3,'-4.5dB':-4.5,'-6dB':-6});
export function resolvePanLaw(value='legacy'){requireValue(['legacy','equalPower','0dB',...Object.keys(PAN_LAW_DB)].includes(value),'INVALID_PAN_LAW','Unsupported project pan law.');return value;}
export function panGains(pan,law='legacy'){
 resolvePanLaw(law);requireValue(Number.isFinite(pan)&&pan>=-1&&pan<=1,'INVALID_PAN','Pan must be -1..1.');
 if(law==='0dB')return {monoLeft:Math.min(1,1-pan),monoRight:Math.min(1,1+pan),stereoLeft:Math.min(1,1-pan),stereoRight:Math.min(1,1+pan)};
 const angle=(pan+1)*Math.PI/4,exponent=Object.hasOwn(PAN_LAW_DB,law)?PAN_LAW_DB[law]/(20*Math.log10(Math.SQRT1_2)):1,shape=x=>exponent===1?x:x**exponent;return {monoLeft:pan===1?0:shape(Math.cos(angle)),monoRight:pan===-1?0:shape(Math.sin(angle)),stereoLeft:pan===1?0:Math.cos(Math.max(0,pan)*Math.PI/2),stereoRight:pan===-1?0:Math.cos(Math.max(0,-pan)*Math.PI/2)};
}
export function monoSumGain(law='legacy'){resolvePanLaw(law);return Object.hasOwn(PAN_LAW_DB,law)?10**(PAN_LAW_DB[law]/20):law==='0dB'?1:law==='equalPower'?Math.SQRT1_2:.5;}
