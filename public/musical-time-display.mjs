import {compileRulerIntervals} from '/media/ruler-intervals.mjs';
import {compileProjectTimeDisplay,TIME_FORMAT_LABELS} from '/media/time-display.mjs';

/** Readouts only. Refresh never replaces edit forms or commits rounded positions. */
export function setupMusicalTimeDisplay({getContext,readProfile,notify}) {
  let profile=null,generation=0,cache=null,cacheKey='',cachedProject=null,rulerContext='';
  const rulerTicks=new Map(),rulers=[['timeline-ruler','프로젝트','timeline'],['piano-ruler','클립 내','piano']];
  const $=id=>document.getElementById(id);
  let rulerProject=null,rulerZoom=null,rulerCompilers=new Map(),rulerFrame=0;
  function converter(){const {project}=getContext();if(!project||!profile)return null;
    const key=String(profile.settings.options.displayPpq);
    if(project!==cachedProject||key!==cacheKey){cachedProject=project;cache=compileProjectTimeDisplay(project,profile.settings.options.displayPpq);cacheKey=key;}return cache;
  }
  const displayTick=value=>Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER?Math.floor(value):null;
  const safe=fn=>{try{return fn();}catch{return{text:'—',format:'invalid',precision:'out-of-range'};}};
  function position(value){const element=$('position-bars'),time=converter(),tick=displayTick(value);
    if(!time||tick===null){element.textContent='—';element.title='MIDI 시간 설정 확인 중';delete element.dataset.displayPpq;delete element.dataset.timeFormat;return;}
    const point=safe(()=>time.position(value));
    if(point.format==='bars-beats'){const split=point.text.indexOf('.'),tail=document.createElement('span');tail.textContent=point.text.slice(split);element.replaceChildren(document.createTextNode(point.text.slice(0,split)),tail);}else element.textContent=point.text;
    element.dataset.displayPpq=String(time.displayPpq);element.dataset.timeFormat=point.format;
    element.title=`${TIME_FORMAT_LABELS[point.format]??'표시 범위 초과'} · 표시 PPQ ${time.displayPpq} · 현재 저장 tick ${tick} (표시만 내림)`;
  }
  function rulerTitle(id,label,scope,time){const tick=rulerTicks.get(id),ctx=getContext(),origin=scope==='piano'?(ctx.clip?.startTick??0):0;
    $(id).title=!time?'MIDI 시간 설정 확인 중':tick===undefined?`${label} · ${TIME_FORMAT_LABELS[time.formatFor(scope)]} · 표시 PPQ ${time.displayPpq}`:
      `${label} ${safe(()=>time.position(tick,scope,origin)).text} · ${TIME_FORMAT_LABELS[time.formatFor(scope)]} · 표시 PPQ ${time.displayPpq} · 저장 tick ${tick} (표시만 내림)`;
    if(!time)for(const element of $(id).querySelectorAll('[data-ruler-tick]')){element.textContent='—';element.title='시간 설정 확인 중';delete element.dataset.timeFormat;}
    if(time)for(const element of $(id).querySelectorAll('[data-ruler-tick]')){const p=element.dataset.rulerExactLabel?{text:element.dataset.rulerExactLabel,format:time.formatFor(scope)}:safe(()=>time.position(Number(element.dataset.rulerTick),scope,origin));element.textContent=p.format==='bars-beats'?element.dataset.barNumber:p.text;element.title=p.text;element.dataset.timeFormat=p.format;}
  }
  function updateRulers(){
    const ctx=getContext(),time=converter();
    if(ctx.project!==rulerProject||ctx.pxPerBeat!==rulerZoom){rulerCompilers.clear();rulerProject=ctx.project;rulerZoom=ctx.pxPerBeat;}
    for(const [id,label,scope]of rulers){
      const element=$(id);delete element.dataset.rulerError;
      if(time&&time.formatFor(scope)!=='bars-beats'){
        const origin=scope==='piano'?(ctx.clip?.startTick??0):0,key=scope+':'+origin,scroll=$(scope==='piano'?'piano-scroll':'timeline-scroll');
        try{
          if(!rulerCompilers.has(key))rulerCompilers.set(key,compileRulerIntervals(ctx.project,{scope,originTick:origin,zoom:ctx.pxPerBeat}));
          const start=Math.min(scroll.scrollLeft,element.clientWidth),end=Math.min(element.clientWidth,start+scroll.clientWidth);
          const result=rulerCompilers.get(key).range(start,end);
          element.dataset.rulerInterval=result.step;element.dataset.rulerUnit=result.unit;
          element.innerHTML=result.ticks.map((p,i)=>`<span class="bar-number" data-ruler-tick="${p.tick}" data-ruler-unit="${p.unit}" data-ruler-exact-label="${p.label}" style="position:absolute;bottom:0;left:${p.x}px;width:${Math.max(1,(result.ticks[i+1]?.x??p.x+96)-p.x)}px">${p.label}</span>`).join('');
        }catch(error){element.replaceChildren();element.dataset.rulerError=error.code??'RULER_RANGE';delete element.dataset.rulerInterval;delete element.dataset.rulerUnit;}
      }else if(time){delete element.dataset.rulerInterval;delete element.dataset.rulerUnit;}
      rulerTitle(id,label,scope,time);
      if(element.dataset.rulerError)element.title='시간 눈금 표시 범위를 벗어났습니다.';
    }
  }
  function queueRulers(){if(!rulerFrame)rulerFrame=requestAnimationFrame(()=>{rulerFrame=0;updateRulers();});}
  function update(){const ctx=getContext(),time=converter();const contextKey=`${ctx.project?.id}:${ctx.project?.revision}:${ctx.clip?.id}:${ctx.pxPerBeat}`;if(contextKey!==rulerContext){rulerTicks.clear();rulerContext=contextKey;}
    updateRulers();
    if(!time)for(const element of document.querySelectorAll('.midi-note[data-note-id],.timeline-clip[data-clip-id]'))element.title='MIDI 시간 설정 확인 중';
    position(ctx.cursorTick);
    const selection=$('musical-time-selection');if(!ctx.project){selection?.remove();return;}
    let output=selection;if(!output){output=document.createElement('p');output.id='musical-time-selection';output.className='form-help';$('inspector-content').prepend(output);}
    if(!time){output.textContent='MIDI 시간 설정 확인 중';return;}
    const {clip,note}=ctx,origin=clip?.type==='midi'?clip.startTick:0;
    const notePoint=n=>safe(()=>time.position(n.startTick,'piano',origin)).text;
    const noteLength=n=>safe(()=>time.duration(origin+n.startTick,origin+n.startTick+n.durationTicks,'piano')).text;
    output.textContent=note?`${TIME_FORMAT_LABELS[time.formatFor('piano')]} · 클립 내 시작 ${notePoint(note)} · 길이 ${noteLength(note)}`:
      clip?.type==='midi'?`${TIME_FORMAT_LABELS[time.formatFor()]} · 프로젝트 시작 ${safe(()=>time.position(clip.startTick)).text} · 길이 ${safe(()=>time.duration(clip.startTick,clip.startTick+clip.lengthTicks)).text}`:
      clip?.type==='audio'?`${TIME_FORMAT_LABELS[time.formatFor()]} · 프로젝트 시작 ${safe(()=>time.samplePosition(clip.startSample)).text}`:`${TIME_FORMAT_LABELS[time.formatFor()]} · 표시 PPQ ${time.displayPpq}`;
    const notes=new Map((clip?.notes??[]).map(n=>[n.id,n]));for(const element of document.querySelectorAll('.midi-note[data-note-id]')){const n=notes.get(element.dataset.noteId);if(n)element.title=`MIDI ${n.pitch} · 클립 내 ${notePoint(n)} · 길이 ${noteLength(n)} · velocity ${n.velocity}`;}
    const clips=new Map(ctx.project.clips.map(c=>[c.id,c]));for(const element of document.querySelectorAll('.timeline-clip[data-clip-id]')){const c=clips.get(element.dataset.clipId);if(!c)continue;element.title=c.type==='midi'?`${c.name} · 프로젝트 ${safe(()=>time.position(c.startTick)).text} · 길이 ${safe(()=>time.duration(c.startTick,c.startTick+c.lengthTicks)).text}`:`${c.name} · 프로젝트 ${safe(()=>time.samplePosition(c.startSample)).text}`;}
  }
  async function refresh(){const token=++generation;profile=null;cacheKey='';update();try{const value=await readProfile();if(token!==generation)return;profile=value;update();}catch(error){if(token!==generation)return;profile=null;update();notify(`시간 표시 설정을 읽지 못했습니다: ${error.message}`,true);}}
  for(const [id,label,scope]of rulers)$(id).addEventListener('pointermove',event=>{const ctx=getContext(),time=converter();if(!time)return;const tick=displayTick(ctx.geometry[scope].xToTick(Math.max(0,event.clientX-$(id).getBoundingClientRect().left)));if(tick===null){rulerTicks.delete(id);$(id).title='표시 범위를 벗어난 위치';return;}rulerTicks.set(id,tick);rulerTitle(id,label,scope,time);});
  for(const [id,,scope]of rulers){const scroller=$(scope==='piano'?'piano-scroll':'timeline-scroll');scroller.addEventListener('scroll',()=>{rulerTicks.delete(id);queueRulers();},{passive:true});new ResizeObserver(queueRulers).observe(scroller);}
  window.addEventListener('newdaw-timing-settings',()=>void refresh());return{refresh,position,update};
}
