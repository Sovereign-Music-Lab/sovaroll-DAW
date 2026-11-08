import {finite,requireValue} from './common.mjs';
export function resolveTrackEq(settings){
 if(settings===undefined)return null;
 requireValue(settings&&typeof settings.enabled==='boolean'&&Array.isArray(settings.bands)&&settings.bands.length===4,'INVALID_EQ','EQ requires enabled and four bands.');
 return {enabled:settings.enabled,bands:settings.bands.map(b=>{requireValue(b&&typeof b.enabled==='boolean','INVALID_EQ','Band enabled must be boolean.');const type=b.type??'peaking';requireValue(['peaking','lowShelf','highShelf','lowPass','highPass','notch'].includes(type),'INVALID_EQ','Unsupported EQ band type.');return {type,enabled:b.enabled,frequencyHz:finite(b.frequencyHz,20,20000,'EQ frequency'),gainDb:finite(b.gainDb,-24,24,'EQ gain'),q:finite(b.q,.1,10,'EQ Q')};})};
}
export function activeEqBands(settings){const eq=resolveTrackEq(settings);return eq?.enabled?eq.bands.filter(b=>b.enabled&&(['lowPass','highPass','notch'].includes(b.type)||b.gainDb!==0)):[];}
export function eqBandCoefficients(band,sampleRate){
 const w=2*Math.PI*Math.min(band.frequencyHz,sampleRate*.49)/sampleRate,a=10**(band.gainDb/40),alpha=Math.sin(w)/(2*band.q),c=Math.cos(w),type=band.type??'peaking';let b0,b1,b2,a0,a1,a2;
 if(type==='lowPass'||type==='highPass'||type==='notch'){
  a0=1+alpha;a1=-2*c;a2=1-alpha;
  if(type==='lowPass'){b0=(1-c)/2;b1=1-c;b2=b0;}
  else if(type==='highPass'){b0=(1+c)/2;b1=-(1+c);b2=b0;}
  else{b0=1;b1=-2*c;b2=1;}
 }else if(type==='lowShelf'||type==='highShelf'){
  const beta=2*Math.sqrt(a)*Math.sin(w)/Math.SQRT2;
  if(type==='lowShelf'){b0=a*((a+1)-(a-1)*c+beta);b1=2*a*((a-1)-(a+1)*c);b2=a*((a+1)-(a-1)*c-beta);a0=(a+1)+(a-1)*c+beta;a1=-2*((a-1)+(a+1)*c);a2=(a+1)+(a-1)*c-beta;}
  else{b0=a*((a+1)+(a-1)*c+beta);b1=-2*a*((a-1)+(a+1)*c);b2=a*((a+1)+(a-1)*c-beta);a0=(a+1)-(a-1)*c+beta;a1=2*((a-1)-(a+1)*c);a2=(a+1)-(a-1)*c-beta;}
 }else{a0=1+alpha/a;b0=1+alpha*a;b1=-2*c;b2=1-alpha*a;a1=-2*c;a2=1-alpha/a;}
 return {b0:b0/a0,b1:b1/a0,b2:b2/a0,a1:a1/a0,a2:a2/a0};
}
export function estimateTrackEqTail(settings,sampleRate){
 const bands=activeEqBands(settings);if(!bands.length)return 0;finite(sampleRate,8000,192000,'EQ sample rate');
 return bands.reduce((sum,band)=>{const {a1,a2}=eqBandCoefficients(band,sampleRate),d=a1*a1-4*a2,r=d<0?Math.sqrt(a2):Math.max(Math.abs((-a1+Math.sqrt(d))/2),Math.abs((-a1-Math.sqrt(d))/2));requireValue(r<1,'UNSTABLE_EQ','EQ poles must be inside the unit circle.');return sum+(r>0?Math.log(1e-5/Math.max(1,10**(band.gainDb/20)))/Math.log(r)/sampleRate:0);},0);
}
/** Four configurable biquads, transposed direct form II. State starts at the render boundary. */
export function processTrackEq(channels,sampleRate,settings){
 const bands=activeEqBands(settings);if(!bands.length)return;finite(sampleRate,8000,192000,'EQ sample rate');
 for(const band of bands)processBiquad(channels,eqBandCoefficients(band,sampleRate));
}

/** Analytic magnitude response from the same coefficients as the audio DSP. */
export function trackEqResponse(settings,sampleRate,frequencies,{pre}={}){
 finite(sampleRate,8000,192000,'EQ sample rate');requireValue(Array.isArray(frequencies)&&frequencies.length<=2048,'INVALID_EQ','Use at most2048 response frequencies.');
 const coefficients=[...preFilterSections(pre,sampleRate),...activeEqBands(settings).map(b=>eqBandCoefficients(b,sampleRate))];
 return frequencies.map(frequencyHz=>{finite(frequencyHz,0,sampleRate/2,'Response frequency');const w=2*Math.PI*frequencyHz/sampleRate,c1=Math.cos(w),s1=Math.sin(w),c2=Math.cos(2*w),s2=Math.sin(2*w);let gainDb=0;for(const{b0,b1,b2,a1,a2}of coefficients){const nr=b0+b1*c1+b2*c2,ni=-b1*s1-b2*s2,dr=1+a1*c1+a2*c2,di=-a1*s1-a2*s2;gainDb+=10*Math.log10(Math.max(1e-30,nr*nr+ni*ni)/Math.max(1e-30,dr*dr+di*di));}return{frequencyHz,gainDb};});
}

/** Graph deltas use the 300x160 SVG coordinate system, logarithmic frequency. */
export function eqGraphDrag({frequencyHz,gainDb,dx,dy,sampleRate,fine=false,gainEditable=true}){
 finite(frequencyHz,20,20000,'EQ drag frequency');finite(gainDb,-24,24,'EQ drag gain');finite(dx,-1e9,1e9,'EQ drag horizontal delta');finite(dy,-1e9,1e9,'EQ drag vertical delta');finite(sampleRate,8000,192000,'EQ drag sample rate');
 const scale=fine?.1:1,high=Math.min(20000,sampleRate*.49);
 return {frequencyHz:Math.round(Math.max(20,Math.min(high,frequencyHz*(high/20)**(dx*scale/276)))),gainDb:gainEditable?Math.round(Math.max(-24,Math.min(24,gainDb-dy*scale/64*24))*10)/10:gainDb};
}

/** EQ note convention: A3=440Hz, distinct from MIDI display octave labels. */
export function parseEqFrequency(value){
 if(typeof value==='number')return finite(value,20,20000,'EQ frequency');
 requireValue(typeof value==='string'&&value.length<=64,'INVALID_EQ_FREQUENCY','Use Hz or a note with optional space and cents (A3=440Hz).');
 const text=value.trim();let hz;
 if(/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*(?:hz)?$/i.test(text))hz=Number(text.replace(/\s*hz$/i,''));
 else{const match=/^([a-g])([#b♯♭]?)(-?\d+)(?:\s+([+-]?\d+(?:\.\d+)?))?$/i.exec(text);requireValue(match,'INVALID_EQ_FREQUENCY','Use Hz or note+space+cents, for example A3 or A5 -23.');const base={c:0,d:2,e:4,f:5,g:7,a:9,b:11}[match[1].toLowerCase()],accidental=['#','♯'].includes(match[2])?1:['b','♭'].includes(match[2].toLowerCase())?-1:0,midi=(Number(match[3])+2)*12+base+accidental;hz=440*2**((midi-69+(Number(match[4]??0)/100))/12);}
 return finite(hz,20,20000,'EQ frequency');
}
export function invertTrackEqGains(settings){const eq=resolveTrackEq(settings);if(!eq)return null;for(const band of eq.bands)if(!['lowPass','highPass','notch'].includes(band.type))band.gainDb=band.gainDb===0?0:-band.gainDb;return eq;}

/** Manual gesture modifiers: Ctrl/Cmd gain-only, Alt frequency-only, Shift Q. */
export function eqGraphGesture(options){
 const {frequencyHz,gainDb,q=1,dy,shiftKey=false,altKey=false,ctrlKey=false,metaKey=false,qEditable=true}=options;finite(q,.1,10,'EQ Q');
 if(shiftKey)return {frequencyHz,gainDb,q:qEditable?Math.round(Math.max(.1,Math.min(10,q*2**(-dy/64)))*1000)/1000:q};
 const gainOnly=ctrlKey||metaKey,frequencyOnly=altKey,values=eqGraphDrag({...options,dx:gainOnly?0:options.dx,dy:frequencyOnly?0:dy,fine:false});
 return {frequencyHz:gainOnly?frequencyHz:values.frequencyHz,gainDb:frequencyOnly?gainDb:values.gainDb,q};
}

/** Pre cuts: bilinear first-order or cascaded Butterworth biquads. */
export function preFilterSections(settings,sampleRate){
 if(!settings)return [];finite(sampleRate,8000,192000,'Pre filter sample rate');const sections=[];
 for(const[key,type,min]of[['lowCut','highPass',20],['highCut','lowPass',50]]){const filter=settings[key];if(!filter)continue;requireValue(typeof filter.enabled==='boolean'&&[6,12,24,36,48].includes(filter.slope),'INVALID_PRE','Invalid pre filter enable/slope.');if(filter.bypass!==undefined)requireValue(typeof filter.bypass==='boolean','INVALID_PRE','Pre filter bypass must be boolean.');const hz=finite(filter.frequencyHz,min,20000,'Pre cutoff');if(!filter.enabled||filter.bypass)continue;const frequencyHz=Math.min(hz,sampleRate*.49);
  if(filter.slope===6){const k=Math.tan(Math.PI*frequencyHz/sampleRate),b0=type==='lowPass'?k/(1+k):1/(1+k);sections.push({b0,b1:type==='lowPass'?b0:-b0,b2:0,a1:(k-1)/(k+1),a2:0});}
  else{const order=filter.slope/6;for(let index=0;index<order/2;index++)sections.push(eqBandCoefficients({type,frequencyHz,gainDb:0,q:1/(2*Math.cos((2*index+1)*Math.PI/(2*order)))},sampleRate));}
 }return sections;
}
export function processBiquad(channels,{b0,b1,b2,a1,a2}){for(const channel of channels){let z1=0,z2=0;for(let i=0;i<channel.length;i++){const input=channel[i],output=b0*input+z1;z1=b1*input-a1*output+z2;z2=b2*input-a2*output;channel[i]=output;}}}
export function processPreFilters(channels,sampleRate,settings){for(const section of preFilterSections(settings,sampleRate))processBiquad(channels,section);}
export function estimatePreFilterTail(settings,sampleRate){return preFilterSections(settings,sampleRate).reduce((sum,{a1,a2})=>{const d=a1*a1-4*a2,r=d<0?Math.sqrt(a2):Math.max(Math.abs((-a1+Math.sqrt(d))/2),Math.abs((-a1-Math.sqrt(d))/2));requireValue(r<1,'UNSTABLE_PRE','Pre filter poles must be stable.');return sum+(r>0?Math.log(1e-5)/Math.log(r)/sampleRate:0);},0);}

export function eqGraphReadout({x,y,sampleRate}){
 finite(x,-1e9,1e9,'EQ graph x');finite(y,-1e9,1e9,'EQ graph y');finite(sampleRate,8000,192000,'EQ graph sample rate');
 const high=Math.min(20000,sampleRate*.49),frequencyHz=20*(high/20)**(Math.max(0,Math.min(276,x-12))/276),gainDb=Math.max(-24,Math.min(24,(76-y)/64*24)),pitch=69+12*Math.log2(frequencyHz/440),nearest=Math.round(pitch),note=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((nearest%12)+12)%12]+(Math.floor(nearest/12)-2),cents=Math.round((pitch-nearest)*100);
 return {frequencyHz,gainDb,note,cents};
}
