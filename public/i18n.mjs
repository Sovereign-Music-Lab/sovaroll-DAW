// Persisted primary-workspace language. Advanced dialogs retain their existing scope.
const STORAGE_KEY='sovaroll.language.v1';
let language='ko';
const originals=new WeakMap(),attributeOriginals=new WeakMap();
const textRules=[
 ['#projects-button','Open project'],['#document-button','Save · versions'],['#history-button','Edit history'],['#backups-button','Auto backup'],['#media-pool-button','Media pool'],
 ['#bundle-download','Backup ZIP ↗'],['#help-button','Help <span class="keycap">?</span>','html'],['#project-download','Project JSON <span aria-hidden="true">↗</span>','html'],
 ['#cycle-playback','↻ Cycle'],['#midi-export-open','Export MIDI'],['#render-button','Export WAV mix <span aria-hidden="true">↗</span>','html'],
 ['#import-button','<span aria-hidden="true">↥</span> Import <span class="small-label">WAV / AIFF / MIDI</span>','html'],['#cancel-import-batch','Stop after current file'],['#import-batch-report','Import report'],
 ['#recording-panel > summary','Recording'],['#audio-record-refresh','Input list'],['#audio-record','● Record audio'],['#audio-record-stop','Save recording'],['#audio-record-cancel','Cancel'],['#audio-record-download','Keep recorded WAV'],
 ['#audio-record-monitor','Monitor · headphones','label'],['#audio-record-backing','Listen to existing tracks','label'],['#audio-record-gain','Input dB','label'],
 ['#audio-record-count-in option[value="0"]','No count-in'],['#audio-record-count-in option[value="1"]','1-bar count-in'],['#audio-record-count-in option[value="2"]','2-bar count-in'],['#audio-record-track option[value=""]','New audio track'],
 ['#timeline-select-tool','Select tool'],['#timeline-range-mode','Range select','label'],['#track-folders-open','Track folders'],['#project-markers-open','Markers'],
 ['#arrangement-edit-menu > summary','Clip actions'],['#clip-tools-button','Edit clip'],['#clear-all-mute','Clear mute'],['#clear-all-solo','Clear solo'],['#remove-empty-tracks','Delete empty tracks'],
 ['#add-track','＋ Track'],['#add-clip','＋ Clip'],['#empty-add','Create MIDI track'],['#timeline-empty h2','Add your first idea.'],['#timeline-empty p','Add a MIDI track or import WAV · MIDI files.'],
 ['#timeline-fit-project','Fit project'],['#timeline-fit-selection','Fit selection'],['#editing-tools-menu > summary','Editing tools','label'],['#timeline-follow','Follow playback','label'],['#timeline-follow-resume','Resume follow · paused for editing'],
 ['#workspace-open-button','View open projects'],['#cancel-render','Cancel'],['#notice-dismiss','×']
];
const attributeRules=[
 ['#rewind','aria-label','Go to start'],['#rewind','title','Go to start'],['#play','aria-label','Play'],['#play','title','Play · Space'],['#stop','aria-label','Stop'],['#stop','title','Stop · Space'],
 ['#undo','aria-label','Undo'],['#undo','title','Undo · ⌘/Ctrl Z'],['#redo','aria-label','Redo'],['#redo','title','Redo · ⌘/Ctrl Shift Z'],['#cycle-playback','title','Repeat locator range'],
 ['#project-name','aria-label','Project name'],['#tempo','aria-label','Base tempo BPM'],['#tempo-map-button','title','Edit tempo map / fixed meter'],
 ['#timeline-scroll','aria-label','Timeline'],['#timeline-ruler','title','Click to set playback position'],['#notice-dismiss','aria-label','Dismiss notification'],
 ['#audio-record-device','aria-label','Recording input device'],['#audio-record-channels','aria-label','Recording channels'],['#audio-record-track','aria-label','Recording target track'],['#audio-record-count-in','aria-label','Count-in'],['#audio-record-name','placeholder','Take name'],['#audio-record-level','aria-label','Recording input level'],
 ['#track-mix-mode','aria-label','Track mixer adjustment mode'],['#track-row-height','aria-label','Global track height'],['#metronome-volume','aria-label','Metronome volume'],['#snap','aria-label','Note entry grid']
];
function setText(element,english,mode){
 if(!element)return;
 const property=mode==='html'?'innerHTML':'textContent';
 if(mode==='label'){
  const node=[...element.childNodes].find(child=>child.nodeType===Node.TEXT_NODE&&child.nodeValue.trim());
  if(!node)return;
  if(!originals.has(node))originals.set(node,node.nodeValue);
  node.nodeValue=language==='en'?english:originals.get(node);return;
 }
 if(!originals.has(element))originals.set(element,element[property]);
 element[property]=language==='en'?english:originals.get(element);
}
function applyDynamic(){
 const selection=document.querySelector('#track-selection-count');
 if(selection)selection.textContent=language==='en'?selection.textContent.replace(/(\d+) 선택/,'$1 selected'):selection.textContent.replace(/(\d+) selected/,'$1 선택');
 const workspace=document.querySelector('#workspace-status');
 if(workspace)workspace.textContent=language==='en'?workspace.textContent.replace(/열린 프로젝트 (\d+)개 · 활성: /,'Open projects $1 · Active: ').replace(/열린 프로젝트 (\d+)개 · 활성 없음/,'Open projects $1 · No active project'):workspace.textContent.replace(/Open projects (\d+) · Active: /,'열린 프로젝트 $1개 · 활성: ').replace(/Open projects (\d+) · No active project/,'열린 프로젝트 $1개 · 활성 없음');
 const playback=document.querySelector('#playback-status');
 if(playback)playback.textContent=language==='en'?playback.textContent.replace(/^정지$/,'Stopped').replace(/재생 준비 중/g,'Preparing playback').replace(/재생 중/g,'Playing'):playback.textContent.replace(/^Stopped$/,'정지').replace(/Preparing playback/g,'재생 준비 중').replace(/Playing/g,'재생 중');
 const connection=document.querySelector('#connection-status');
 if(connection)connection.textContent=language==='en'?connection.textContent.replace(/동기화됨/g,'Synchronized').replace(/서버 연결 중/g,'Connecting to server'):connection.textContent.replace(/Synchronized/g,'동기화됨').replace(/Connecting to server/g,'서버 연결 중');
}
export function applyLanguage(next=language){
 language=next==='en'?'en':'ko';document.documentElement.lang=language;
 for(const [selector,english,mode]of textRules)setText(document.querySelector(selector),english,mode);
 for(const [selector,attribute,english]of attributeRules){
  const element=document.querySelector(selector);if(!element)continue;
  const key=`${attribute}`;
  if(!attributeOriginals.has(element))attributeOriginals.set(element,{});
  const record=attributeOriginals.get(element);if(!Object.hasOwn(record,key))record[key]=element.getAttribute(attribute);
  element.setAttribute(attribute,language==='en'?english:record[key]);
 }
 applyDynamic();
 const select=document.querySelector('#language-select');if(select&&select.value!==language)select.value=language;
}
export function setupI18n({onChange=()=>{}}={}){
 try{const saved=localStorage.getItem(STORAGE_KEY);if(saved==='en'||saved==='ko')language=saved;}catch{}
 const select=document.querySelector('#language-select');
 if(select)select.addEventListener('change',()=>{
  language=select.value==='en'?'en':'ko';try{localStorage.setItem(STORAGE_KEY,language);}catch{}
  applyLanguage();onChange();
 });
 applyLanguage();
}
