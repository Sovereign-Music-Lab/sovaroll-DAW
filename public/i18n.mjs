// Persisted workspace language. Selector rules cover primary controls; the dictionary
// translator covers every other Korean text node and attribute, including dynamic text.
import {KO_EN,KO_EN_NUMERIC} from './i18n-dictionary.mjs';
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
 ['#workspace-open-button','View open projects'],['#cancel-render','Cancel'],['#notice-dismiss','×'],
 ['#history-dialog .dialog-heading h2','Edit history'],['#history-refresh','Reload'],['#history-dialog > p:nth-of-type(3)','Move the boundary left to undo or right to redo. A new edit after Undo discards the later branch.'],['#history-dialog > p:nth-of-type(4)','Lowering the limit removes older entries. Large projects may retain fewer steps because of the history-file size limit.'],['#history-description-form button','Save description'],['#history-description-form > label','Description · ','label'],['#history-limit-form button','Apply history limit'],['#history-limit-form > label','Maximum steps ','label'],
 ['#backups-dialog .dialog-heading h2','Automatic backup'],['#backups-dialog > p:nth-of-type(1)','Project edits save immediately. Automatic backups retain earlier versions of a changed project at the configured interval. They exclude source WAV; use backup ZIP for project media.'],['#backup-settings-form .backup-enable',' Enable automatic backup','label'],['#backup-settings-form label:has(#backup-interval)','Interval · minutes','label'],['#backup-settings-form label:has(#backup-count)','Maximum retained backups','label'],['#backup-settings-form button','Save automatic-backup settings'],['#backup-now','Back up now'],['#backup-refresh','Check again'],['#backups-dialog > p:nth-of-type(4)','When over the limit, the oldest automatic backup created by this project is replaced first. Keep assets beside a downloaded JSON. CLI recover-backup creates a new project and can collect required sources.']
];
const attributeRules=[
 ['#rewind','aria-label','Go to start'],['#rewind','title','Go to start'],['#play','aria-label','Play'],['#play','title','Play · Space'],['#stop','aria-label','Stop'],['#stop','title','Stop · Space'],
 ['#undo','aria-label','Undo'],['#undo','title','Undo · ⌘/Ctrl Z'],['#redo','aria-label','Redo'],['#redo','title','Redo · ⌘/Ctrl Shift Z'],['#cycle-playback','title','Repeat locator range'],
 ['#project-name','aria-label','Project name'],['#tempo','aria-label','Base tempo BPM'],['#tempo-map-button','title','Edit tempo map / fixed meter'],
 ['#timeline-scroll','aria-label','Timeline'],['#timeline-ruler','title','Click to set playback position'],['#notice-dismiss','aria-label','Dismiss notification'],
 ['#audio-record-device','aria-label','Recording input device'],['#audio-record-channels','aria-label','Recording channels'],['#audio-record-track','aria-label','Recording target track'],['#audio-record-count-in','aria-label','Count-in'],['#audio-record-name','placeholder','Take name'],['#audio-record-level','aria-label','Recording input level'],
 ['#history-dialog [data-close-dialog]','aria-label','Close edit history'],['#backups-dialog [data-close-dialog]','aria-label','Close automatic backup'],['#history-boundary','aria-label','Undo boundary'],
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
const HANGUL=/[가-힣]/,TRANSLATED_ATTRIBUTES=['title','aria-label','placeholder','alt'];
const textRecords=new WeakMap(),attributeRecords=new WeakMap();
let patterns=null,observer=null,translating=false;
function compilePatterns(){
 patterns=[];
 for(const key of Object.keys(KO_EN).filter(key=>/\{\d+\}/.test(key)).sort((a,b)=>b.length-a.length)){
  const order=[],parts=key.split(/(\{\d+\})/);
  const source=greedy=>parts.map(part=>{const slot=/^\{(\d+)\}$/.exec(part);if(slot)return greedy?'([\\s\\S]+)':'([\\s\\S]+?)';return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('');
  for(const part of parts){const slot=/^\{(\d+)\}$/.exec(part);if(slot)order.push(Number(slot[1]));}
  try{patterns.push({regexes:[new RegExp(`^${source(false)}$`),new RegExp(`^${source(true)}$`)],order,english:KO_EN[key],numeric:KO_EN_NUMERIC[key]});}catch{}
 }
}
function translatePhrase(text){
 if(Object.hasOwn(KO_EN,text))return KO_EN[text];
 if(!patterns)compilePatterns();
 // Lazy and greedy splits can divide runtime values differently; prefer the split
 // whose Korean values all translate, otherwise keep the first match.
 let fallback=null;
 for(const {regexes,order,english:text_en,numeric}of patterns)for(const regex of regexes){
  const match=regex.exec(text);if(!match)continue;
  const values=[];order.forEach((slot,index)=>{values[slot]=match[index+1];});
  const english=numeric&&values.every(value=>value===undefined||/^\d+$/.test(value))?numeric:text_en;
  const translated=values.map(value=>value===undefined||!HANGUL.test(value)?value:translateString(value));
  const complete=translated.every(value=>value!==null);
  const result=english.replace(/\{(\d+)\}/g,(_,slot)=>{const index=Number(slot);return (complete?translated[index]:translateValue(values[index]??''))??'';});
  if(complete)return result;
  fallback??=result;
 }
 return fallback;
}
function translateValue(value){return HANGUL.test(value)?translateString(value)??value:value;}
// Exact phrase, then template patterns, then separator- and sentence-level pieces.
export function translateString(text){
 const lead=/^\s*/.exec(text)[0],trail=/\s*$/.exec(text)[0],core=text.trim().replace(/\s+/g,' ');
 if(!core||!HANGUL.test(core))return null;
 let result=translatePhrase(core);
 if(result===null)for(const separator of [' · ',' — ',' / ',' | ']){
  if(!core.includes(separator))continue;
  const pieces=core.split(separator).map(piece=>HANGUL.test(piece)?translatePhrase(piece.trim()):piece);
  if(pieces.every(piece=>piece!==null)){result=pieces.join(separator);break;}
 }
 if(result===null){
  const sentences=core.split(/(?<=[.!?。…)])\s+/);
  if(sentences.length>1){const pieces=sentences.map(piece=>HANGUL.test(piece)?translatePhrase(piece)??translateString(piece):piece);if(pieces.every(piece=>piece!==null))result=pieces.join(' ');}
 }
 return result===null?null:lead+result+trail;
}
function translateTextNode(node){
 const record=textRecords.get(node);
 if(record&&node.nodeValue===record.en)return;
 if(!HANGUL.test(node.nodeValue)){textRecords.delete(node);return;}
 const parent=node.parentElement;if(parent&&(parent.closest('script,style,textarea,[contenteditable="true"],[data-i18n-skip]')))return;
 const english=translateString(node.nodeValue);if(english===null)return;
 textRecords.set(node,{ko:node.nodeValue,en:english});node.nodeValue=english;
}
function translateAttributes(element){
 for(const attribute of TRANSLATED_ATTRIBUTES){
  const value=element.getAttribute(attribute);if(value===null)continue;
  const records=attributeRecords.get(element)??{};
  if(records[attribute]&&value===records[attribute].en)continue;
  if(!HANGUL.test(value))continue;
  const english=translateString(value);if(english===null)continue;
  records[attribute]={ko:value,en:english};attributeRecords.set(element,records);element.setAttribute(attribute,english);
 }
}
function translateTree(root){
 if(root.nodeType===Node.TEXT_NODE){translateTextNode(root);return;}
 if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_NODE)return;
 if(root.nodeType===Node.ELEMENT_NODE)translateAttributes(root);
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
 for(let node=walker.nextNode();node;node=walker.nextNode())node.nodeType===Node.TEXT_NODE?translateTextNode(node):translateAttributes(node);
}
function restoreTree(root){
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
 for(let node=walker.nextNode();node;node=walker.nextNode()){
  if(node.nodeType===Node.TEXT_NODE){const record=textRecords.get(node);if(record){if(node.nodeValue===record.en)node.nodeValue=record.ko;textRecords.delete(node);}continue;}
  const records=attributeRecords.get(node);if(!records)continue;
  for(const [attribute,record]of Object.entries(records))if(node.getAttribute(attribute)===record.en)node.setAttribute(attribute,record.ko);
  attributeRecords.delete(node);
 }
}
function observeDocument(){
 if(observer||typeof MutationObserver==='undefined')return;
 observer=new MutationObserver(mutations=>{
  if(language!=='en'||translating)return;translating=true;
  try{for(const mutation of mutations){
   if(mutation.type==='characterData')translateTextNode(mutation.target);
   else if(mutation.type==='attributes')translateAttributes(mutation.target);
   else for(const node of mutation.addedNodes)translateTree(node);
  }}finally{translating=false;}
 });
 observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:TRANSLATED_ATTRIBUTES});
}
// Native dialogs cannot be observed, so translate their messages at the call.
for(const name of ['alert','confirm','prompt']){
 if(typeof window==='undefined'||typeof window[name]!=='function')continue;
 const original=window[name].bind(window);
 window[name]=(message,...rest)=>original(language==='en'&&typeof message==='string'?translateString(message)??message:message,...rest);
}
export function currentLanguage(){return language;}
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
 translating=true;
 try{if(language==='en'){translateTree(document.documentElement);document.title=translateString(document.title)??document.title;}else restoreTree(document.documentElement);}catch(error){console.error('i18n',error);}finally{translating=false;}
 observeDocument();
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
