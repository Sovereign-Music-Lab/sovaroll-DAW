import {compileTempoMap} from './time.mjs';
import {finite,requireValue} from './common.mjs';
export function resolveTrackDelay(settings){
 if(settings===undefined)return null;
 requireValue(settings&&typeof settings==='object'&&typeof settings.enabled==='boolean','INVALID_DELAY','Delay requires enabled, timeMs, feedback and wet.');
 const timeMs=finite(settings.timeMs,1,2000,'Delay milliseconds'),feedback=finite(settings.feedback,0,.9,'Delay feedback'),wet=finite(settings.wet,0,1,'Delay wet');
 for(const key of ['sync','lowCutEnabled','highCutEnabled'])if(settings[key]!==undefined)requireValue(typeof settings[key]==='boolean','INVALID_DELAY','Delay filter enabled must be boolean.');
 const lowCutHz=finite(settings.lowCutHz??120,10,20000,'Delay low cut Hz'),highCutHz=finite(settings.highCutHz??8000,10,20000,'Delay high cut Hz');
 const division=settings.division??'1/4',rhythm=settings.rhythm??'straight';requireValue(['1/1','1/2','1/4','1/8','1/16','1/32'].includes(division)&&['straight','dotted','triplet'].includes(rhythm),'INVALID_DELAY','Invalid delay rhythm.');
 return {...settings,timeMs,feedback,wet,lowCutHz,highCutHz,division,rhythm};
}
/** Independent stereo feedback delay. Step-tempo sync has abrupt read-position changes; no tape glide or cross-feedback. */
export function processTrackDelay(channels,sampleRate,settings,{tempoMap,ppq=960,startSeconds=0}={}){
 const config=resolveTrackDelay(settings);if(!config?.enabled||config.wet===0)return;
 finite(sampleRate,1,192000,'Delay sample rate');
 let segments=[{time:0,frames:Math.max(1,Math.round(sampleRate*config.timeMs/1000))}];
 if(config.sync){requireValue(Array.isArray(tempoMap),'INVALID_DELAY','Synced delay requires the project tempo map.');const map=compileTempoMap(tempoMap,ppq),quarters=4/Number(config.division.split('/')[1])*(config.rhythm==='dotted'?1.5:config.rhythm==='triplet'?2/3:1);segments=tempoMap.map(point=>({time:map.tickToSeconds(point.tick),frames:Math.max(1,Math.round(sampleRate*60/point.bpm*quarters))}));}
 finite(startSeconds,0,Number.MAX_SAFE_INTEGER,'Delay start seconds');
 const capacity=segments.reduce((max,s)=>Math.max(max,s.frames),1)+1,hp=Math.exp(-2*Math.PI*Math.min(config.lowCutHz,sampleRate*.49)/sampleRate),lp=Math.exp(-2*Math.PI*Math.min(config.highCutHz,sampleRate*.49)/sampleRate);
 for(const channel of channels){const ring=new Float32Array(capacity);let hpInput=0,hpOutput=0,lpOutput=0,segment=0;for(let i=0;i<channel.length;i++){while(segment+1<segments.length&&startSeconds+i/sampleRate>=segments[segment+1].time)segment++;const at=i%capacity,read=(i-segments[segment].frames+capacity)%capacity,dry=channel[i],echo=ring[read];let feedbackSignal=echo;if(config.lowCutEnabled){const filtered=hp*(hpOutput+feedbackSignal-hpInput);hpInput=feedbackSignal;hpOutput=filtered;feedbackSignal=filtered;}if(config.highCutEnabled){lpOutput=(1-lp)*feedbackSignal+lp*lpOutput;feedbackSignal=lpOutput;}ring[at]=dry+feedbackSignal*config.feedback;channel[i]=dry*(1-config.wet)+echo*config.wet;}}
}

/** Conservative unity-input repeat estimate to -80dB, before the export cap. */
export function estimateTrackDelayTail(settings,tempoMap){
 const config=resolveTrackDelay(settings);if(!config?.enabled||config.wet<=1e-4)return 0;
 const quarters=4/Number(config.division.split('/')[1])*(config.rhythm==='dotted'?1.5:config.rhythm==='triplet'?2/3:1);
 const seconds=config.sync?60/tempoMap.reduce((min,p)=>Math.min(min,p.bpm),300)*quarters:config.timeMs/1000;
 const repeats=config.feedback===0?1:Math.max(1,1+Math.ceil(Math.log(1e-4/config.wet)/Math.log(config.feedback)));
 return seconds*repeats;
}
