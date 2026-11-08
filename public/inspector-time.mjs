import {compileProjectTimeDisplay} from '/media/time-display.mjs';
import {formatDisplayTicks,parseDisplayTicks} from '/media/display-time-edit.mjs';

/** Inspector edits keep the units, source snapshot and draft together. */
export function setupInspectorTime({host,getContext,readProfile,runCommand,render,notify}) {
  let profile=null,loading=false,generation=0;
  const bindings=new Map(),modes=new Map();
  const identity=c=>`${c.documentId}:${c.project?.id}:${c.track?.id}:${c.clip?.id}:${c.note?.id}`;
  const forms=()=>[...host.querySelectorAll('form[data-display-time]')];
  const sameContext=b=>identity(getContext())===b.identity;
  function status(b) {
    const c=getContext(),stale=b.stale||!sameContext(b)||c.project?.revision!==b.revision;
    b.stale=stale;
    const text=b.form.querySelector('[data-time-status]');
    text.textContent=loading?'시간 설정 읽는 중 · 입력 초안 유지':stale?'프로젝트 또는 표시 설정이 바뀌었습니다. 이전 단위 초안을 보존했습니다. 다시 읽으세요.':!b.profile?'시간 설정을 읽지 못했습니다. 다시 읽으세요.':b.mode==='format'?`${b.format} · ${b.note?'클립 내 위치':'프로젝트 위치'} · 읽은 값은 표시 정밀도로 내림됩니다. 바꾼 시간 칸만 저장하며 길이는 이동 후 시작 기준입니다.`:`표시 PPQ ${b.profile.settings.options.displayPpq} · 저장 PPQ ${b.ppq} · 위치는 0부터, 분수는 1/2 형식`;
    b.form.querySelector('[type="submit"]').disabled=loading||stale||!b.profile||c.busy||!c.connected;
    b.form.querySelector('[data-time-reload]').disabled=loading||c.busy||!c.connected;
    for(const input of b.form.querySelectorAll('[data-display-field]'))input.disabled=!b.profile;
    b.form.querySelector('[data-time-input-mode]').disabled=loading||stale||b.dirty||!b.profile;
    b.form.querySelector('[data-time-rounding]').disabled=loading||stale||!b.profile;
  }
  function fill(b,p) {
    b.profile=p;b.stale=false;
    const display=compileProjectTimeDisplay(b.project,p.settings.options.displayPpq),scope=b.note?'piano':'timeline';b.format=display.formatFor(scope);
    b.form.querySelector('[data-time-input-mode]').value=b.mode;
    b.form.querySelector('[data-time-rounding-label]').hidden=b.mode!=='format';
    for(const input of b.form.querySelectorAll('[data-display-field]')){
      const start=input.name==='startDisplayTick',origin=b.note?b.clip.startTick:0,absolute=origin+b.values.startDisplayTick;
      input.value=b.mode==='ticks'?formatDisplayTicks(b.values[input.name],b.ppq,p.settings.options.displayPpq):start?display.position(b.values[input.name],scope,origin).text:display.duration(absolute,absolute+b.values[input.name],scope).text;
      input.closest('label').firstChild.textContent=`${start?(b.note?'클립 내 시작':'프로젝트 시작'):'길이'} · ${b.mode==='ticks'?'표시 tick':b.format}`;
    }
    b.changedTimes.clear();
    status(b);
  }
  function bind() {
    const c=getContext();bindings.clear();
    if(!c.project)return;
    for(const form of forms()){
      const note=form.id==='note-form';
      const b={form,identity:identity(c),documentId:c.documentId,revision:c.project.revision,ppq:c.project.ppq,project:c.project,mode:modes.get(form.id)??'ticks',changedTimes:new Set(),clip:{id:c.clip.id,startTick:c.clip.startTick},note:note?structuredClone(c.note):null,values:note?{startDisplayTick:c.note.startTick,durationDisplayTicks:c.note.durationTicks}:{startDisplayTick:c.clip.startTick,lengthDisplayTicks:c.clip.lengthTicks},dirty:false,stale:false,profile:null};
      bindings.set(form,b);if(profile)fill(b,profile);else status(b);
    }
  }
  function update(){for(const b of bindings.values())if(b.form.isConnected)status(b);}
  function captureDrafts(){return [...bindings.values()].filter(b=>b.form.isConnected&&sameContext(b)&&(b.dirty||b.stale));}
  function restoreDrafts(drafts){for(const b of drafts){if(!sameContext(b))continue;const fresh=host.querySelector('#'+b.form.id);if(!fresh)continue;bindings.delete(fresh);fresh.replaceWith(b.form);bindings.set(b.form,b);status(b);}}
  function preserve(){return [...bindings.values()].some(b=>b.form.isConnected&&sameContext(b)&&(b.dirty||b.stale));}
  async function refresh({discard=false}={}) {
    const token=++generation,context=identity(getContext());loading=true;update();
    try{
      const next=await readProfile();if(token!==generation)return;
      profile=next;loading=false;
      if(discard&&context===identity(getContext())){bindings.clear();render();return;}
      for(const b of bindings.values()){
        if(!b.form.isConnected)continue;
        if(b.profile&&b.profile.fingerprint!==next.fingerprint){if(b.dirty)b.stale=true;else if(b.revision===getContext().project?.revision&&sameContext(b))fill(b,next);else b.stale=true;}
        else if(!b.profile&&!b.dirty&&sameContext(b)&&b.revision===getContext().project?.revision)fill(b,next);
        status(b);
      }
    }catch(e){if(token===generation){profile=null;for(const b of bindings.values()){b.stale=true;status(b);}notify(`Inspector 시간 설정 오류: ${e.message}`,true);}}
    finally{if(token===generation){loading=false;update();}}
  }
  async function submit(form,data,options={controllers:'none'}) {
    const b=bindings.get(form),c=getContext();
    if(!b||loading||b.stale||!b.profile||!sameContext(b)||b.revision!==c.project?.revision||c.busy||!c.connected){update();return;}
    try {
      let command,args,timeEdit;
      if(b.mode==='format'){
        const formattedTimes={};
        for(const [input,key]of [['startDisplayTick','startTick'],[b.note?'durationDisplayTicks':'lengthDisplayTicks',b.note?'durationTicks':'lengthTicks']])if(b.changedTimes.has(input))formattedTimes[key]=data[input];
        command=b.note?'midi.notes.update':'clip.update';
        args=b.note?{clipId:b.clip.id,noteId:b.note.id,pitch:Number(data.pitch),velocity:Number(data.velocity)}:{clipId:b.clip.id,name:data.name};
        timeEdit={profile:b.profile,formattedTimes,timeOptions:{scope:b.note?'piano':'timeline',rounding:form.querySelector('[data-time-rounding]').value,...(b.note?{controllers:options.controllers??'none'}:{})}};
      }else{
      timeEdit={profile:b.profile,displayTimes:{}};const start=parseDisplayTicks(data.startDisplayTick,b.ppq,b.profile.settings.options.displayPpq);
      if(b.note){
        const pitch=Number(data.pitch),velocity=Number(data.velocity),duration=data.durationDisplayTicks;
        // Parse duration before any request; commit still validates the exact units.
        parseDisplayTicks(duration,b.ppq,b.profile.settings.options.displayPpq);
        if(options.controllers!=='none'&&(start!==b.note.startTick||pitch!==b.note.pitch)){
          command='batch';args={commands:[{command:'midi.notes.move',arguments:{clipId:b.clip.id,noteIds:[b.note.id],deltaPitch:pitch-b.note.pitch,...options,...(options.controllers==='extended'?{anchorNoteId:b.note.id}:{})}},{command:'midi.notes.update',arguments:{clipId:b.clip.id,noteId:b.note.id,velocity}}]};
          timeEdit.displayTimes={'commands.0.arguments.deltaTick':formatDisplayTicks(start-b.note.startTick,b.ppq,b.profile.settings.options.displayPpq),'commands.1.arguments.durationTicks':duration};
        }else{
          command='midi.notes.update';args={clipId:b.clip.id,noteId:b.note.id,pitch,velocity};timeEdit.displayTimes={startTick:data.startDisplayTick,durationTicks:duration};
        }
      }else{command='clip.update';args={clipId:b.clip.id,name:data.name};timeEdit.displayTimes={startTick:data.startDisplayTick,lengthTicks:data.lengthDisplayTicks};}
      }
      const result=await runCommand(command,args,b.revision,timeEdit);
      if(result&&sameContext(b)){
        const other=[...bindings.values()].filter(x=>x!==b&&x.dirty&&sameContext(x));
        bindings.clear();render();
        for(const draft of other){const fresh=host.querySelector('#'+draft.form.id);if(fresh){bindings.delete(fresh);fresh.replaceWith(draft.form);draft.stale=true;bindings.set(draft.form,draft);status(draft);}}
      }
    }catch(e){notify(e.code?`${e.code}: ${e.message}`:e.message,true);}
  }
  host.addEventListener('input',event=>{const b=bindings.get(event.target.closest('form'));if(b&&!event.target.matches('[data-time-input-mode]')){b.dirty=true;if(event.target.matches('[data-display-field]'))b.changedTimes.add(event.target.name);status(b);}});
  host.addEventListener('change',event=>{if(!event.target.matches('[data-time-input-mode]'))return;const b=bindings.get(event.target.closest('form'));if(!b||b.dirty||b.stale||!b.profile)return;b.mode=event.target.value;modes.set(b.form.id,b.mode);fill(b,b.profile);});
  host.addEventListener('click',event=>{if(event.target.closest('[data-time-reload]'))void refresh({discard:true});});
  window.addEventListener('newdaw-timing-settings',()=>{for(const b of bindings.values())if(b.dirty)b.stale=true;void refresh();});
  return {bind,update,preserve,captureDrafts,restoreDrafts,refresh,submit};
}
