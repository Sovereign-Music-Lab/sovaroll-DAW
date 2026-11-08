import {finite,requireValue} from './common.mjs';
/** Linear channel pre gain/polarity; both stereo channels share the polarity. */
export function trackPreGain(settings){
 if(settings===undefined)return 1;requireValue(settings&&typeof settings.invertPolarity==='boolean','INVALID_PRE','Pre polarity must be boolean.');
 return 10**(finite(settings.gainDb,-48,48,'Track pre gain')/20)*(settings.invertPolarity?-1:1);
}
