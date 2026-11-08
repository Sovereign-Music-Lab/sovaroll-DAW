import {planNoteShape} from './note-shapes.mjs';
import {finite,integer,requireValue} from './common.mjs';
import {compileControllerTimeGesture} from './controller-time-gesture.mjs';
import {compileEditorGeometry} from './editor-geometry.mjs';
import {generateControllerShape,quantizedControllerPeriod,translateControllerShape} from './controller-shapes.mjs';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),MAX=Number.MAX_SAFE_INTEGER;
/** One shape drag. Modifier transitions re-anchor the current options to the
 * current pointer. Keyboard events must call update(lastPointer, keys), too.
 * Numeric geometry is cheap per packet; generate the full plan only per frame
 * or finish. Errors poison the gesture: never commit an earlier valid preview.
 */
export function compileControllerShapeGesture(project,{clipId,kind,start,snapEnabled=true,zoom=48,height=116,maxValue=127,quantizeTicks=240,density,periodTicks=960,phase=0,peak=.5,duty=.5,exponent=2,reverse=false,modifiers={},noteTarget}={}){
 const frozen=structuredClone(project),clip=frozen.clips.find(c=>c.id===clipId),editor=compileControllerTimeGesture(frozen,{clipId,snapEnabled}),geometry=compileEditorGeometry(frozen,{zoom,clip}).piano;
 finite(height,1,10000,'Shape display height');integer(quantizeTicks,1,MAX,'Shape Quantize');requireValue([127,16383].includes(maxValue),'INVALID_CONTROLLER_SHAPE','Invalid lane range.');
 const periodic=!['line','parabola'].includes(kind),targetNotes=noteTarget===undefined?null:structuredClone(noteTarget);
 if(targetNotes)requireValue(maxValue===127&&Object.keys(targetNotes).every(k=>['field','channel','selectedNoteIds'].includes(k)),'INVALID_NOTE_SHAPE','Only note field, channel and selected IDs belong in noteTarget.');
 requireValue(kind!=='line'||targetNotes,'INVALID_CONTROLLER_SHAPE','Line gesture here edits existing notes only.');
 function pointer(p){requireValue(p&&typeof p==='object','INVALID_CONTROLLER_SHAPE','Expected a pointer.');finite(p.tick,0,clip.lengthTicks,'Pointer tick');integer(p.value,0,maxValue,'Pointer value');finite(p.x,-MAX,MAX,'Pointer x');finite(p.y,-MAX,MAX,'Pointer y');return {...p};}
 const first=pointer(start),startTick=editor.position(first.tick);
 let options={clipId,kind,startTick,endTick:startTick,startValue:first.value,endValue:first.value,...(targetNotes?targetNotes:{density:structuredClone(density)}),...(periodic?{periodTicks,phase,...(kind==='triangle'?{peak}:kind==='square'?{duty}:{})}:kind==='parabola'?{exponent,reverse}:{})};
 function keyMode(keys){if(kind==='line')return 'draw';const ctrl=!!(keys.ctrlKey||keys.metaKey);if(!periodic)return keys.altKey?'translate':keys.shiftKey?'exponent':'draw';return ctrl&&keys.altKey?'translate':ctrl&&keys.shiftKey&&['triangle','square'].includes(kind)?'width':ctrl?'phase':keys.shiftKey?'period':'draw';}
 let mode=keyMode(modifiers),anchor=first,base=structuredClone(options),failed=false,closed=false,revision=0,cached=null,cachedRevision=-1;
 const open=()=>requireValue(!failed&&!closed,failed?'CONTROLLER_SHAPE_ABORTED':'CONTROLLER_SHAPE_CLOSED','Discard this shape gesture before starting another.');
 function target(point,tick){const x=geometry.tickToX(tick)+point.x-anchor.x;requireValue(x>=0,'CONTROLLER_SHAPE_OUT_OF_BOUNDS','The complete shape must fit inside the clip.');return geometry.xToTick(x);}
 function validateValues(o){integer(o.startValue,0,maxValue,'Start value');integer(o.endValue,0,maxValue,'End value');}
 return Object.freeze({
  update(input,keys={}){open();try{
   const p=pointer(input),nextMode=keyMode(keys);
   if(nextMode!==mode){mode=nextMode;anchor=p;base=structuredClone(options);}
   let next=structuredClone(base);const dx=p.x-anchor.x,dv=p.value-anchor.value;
   if(base.startTick===base.endTick||mode==='draw'||mode==='period'){
    next.endTick=dx===0?base.endTick:editor.position(target(p,base.endTick));next.endValue=base.endValue+dv;validateValues(next);
    if(mode==='period'&&dx!==0&&next.endTick!==next.startTick)next.periodTicks=snapEnabled?quantizedControllerPeriod(next.startTick,next.endTick,quantizeTicks):Math.abs(next.endTick-next.startTick);
    // A held modifier still needs an initial nonzero range. Once established,
    // subsequent motion adjusts that shape rather than inventing an area.
    if(base.startTick===base.endTick&&next.startTick!==next.endTick&&!['draw','period'].includes(mode)){anchor=p;base=structuredClone(next);}
   }else if(mode==='translate'){
    const moved=dx===0?{deltaTick:0}:editor.move({anchorTick:base.startTick,targetTick:target(p,base.startTick),points:[{tick:base.startTick},{tick:base.endTick}]});
    next=translateControllerShape(base,{deltaTick:moved.deltaTick,deltaValue:dv,lengthTicks:clip.lengthTicks,maxValue});
   }else if(mode==='exponent')next.exponent=clamp(base.exponent*2**((anchor.y-p.y)/height*4),.01,1000);
   else if(mode==='phase')next.phase=((base.phase%1+(p.tick-anchor.tick)*(base.endTick>base.startTick?1:-1)/base.periodTicks)%1+1)%1;
   else if(mode==='width'){const key=kind==='triangle'?'peak':'duty';next[key]=clamp(base[key]+(p.tick-anchor.tick)*(base.endTick>base.startTick?1:-1)/base.periodTicks,0,1);}
   if(kind==='parabola')next.reverse=!!reverse!==!!(keys.ctrlKey||keys.metaKey);
   options=next;revision++;return structuredClone(options);
  }catch(e){failed=true;throw e;}},
  snapshot(){return {options:structuredClone(options),mode,failed,closed,revision};},
  preview(){open();try{if(options.startTick===options.endTick)return null;if(cachedRevision!==revision){cached=targetNotes?planNoteShape(frozen,options):generateControllerShape(frozen,{...options,maxValue});cachedRevision=revision;}return structuredClone(cached);}catch(e){failed=true;throw e;}},
  finish(){open();try{requireValue(options.startTick!==options.endTick,'CONTROLLER_SHAPE_COLLAPSED','Drag a nonzero source range for a shape.');const plan=targetNotes?planNoteShape(frozen,options):generateControllerShape(frozen,{...options,maxValue});closed=true;return {arguments:structuredClone(options),plan};}catch(e){failed=true;throw e;}}
 });
}
