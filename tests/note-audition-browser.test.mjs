import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserNoteAudition} from '../public/note-audition-browser.mjs';
const wait=()=>new Promise(r=>setTimeout(r,25));
function setup({fetchImpl,decodeImpl,delayMs=5}={}){let enabled=true,starts=0,stops=0;const calls=[],errors=[],c={documentId:'d',selectedClip:'c',project:{id:'p',revision:1}};const audio={resume:async()=>{},close:async()=>{},decodeAudioData:decodeImpl??(async()=>({})),destination:{},createBufferSource:()=>({connect(){},disconnect(){},start(){starts++;},stop(){stops++;}})};const audition=createBrowserNoteAudition({getContext:()=>c,allowed:()=>enabled,onError:e=>errors.push(e),makeAudioContext:()=>audio,delayMs,fetchAudio:async(url,options)=>{calls.push(JSON.parse(options.body));if(fetchImpl)return fetchImpl(url,options);return new Response(new Uint8Array([1]),{headers:{'Content-Type':'audio/wav'}});}});return {audition,c,calls,errors,get starts(){return starts;},get stops(){return stops;},disable(){enabled=false;}};}
const input=value=>({clipId:'c',field:'velocity',updates:[{noteId:'n',value}]});
test('Browser audition coalesces frequent changes and sends newest detached value',async()=>{const s=setup();s.audition.unlock();for(let i=1;i<=50;i++)s.audition.request(input(i));await wait();assert.equal(s.calls.length,1);assert.equal(s.calls[0].updates[0].value,50);assert.equal(s.starts,1);s.audition.cancel();assert.equal(s.stops,1);assert.deepEqual(s.errors,[]);});
test('Browser audition cancellation and document change suppress queued work',async()=>{const s=setup();s.audition.unlock();s.audition.request(input(30));s.audition.cancel();await wait();assert.equal(s.calls.length,0);s.audition.request(input(80));s.c.documentId='other';await wait();assert.equal(s.calls.length,0);s.audition.dispose();});
test('Browser audition requires opt in and unlock, and suppresses playback after disable',async()=>{const s=setup();s.audition.request(input(30));await wait();assert.equal(s.calls.length,0);s.audition.unlock();s.audition.request(input(60));s.disable();await wait();assert.equal(s.starts,0);s.audition.dispose();});

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const response=()=>new Response(new Uint8Array([1]),{headers:{'Content-Type':'audio/wav'}});
test('Browser audition discards a late response after selection changes without a project revision',async()=>{
 const entered=deferred(),held=deferred();const s=setup({fetchImpl:()=>{entered.resolve();return held.promise;}});s.audition.unlock();s.audition.request(input(30));await entered.promise;s.c.selectedNoteIds=new Set(['other']);held.resolve(response());await wait();assert.equal(s.starts,0);assert.deepEqual(s.errors,[]);s.audition.dispose();
});
test('Browser audition discards audio decoded after document replacement',async()=>{
 const entered=deferred(),held=deferred();const s=setup({decodeImpl:()=>{entered.resolve();return held.promise;}});s.audition.unlock();s.audition.request(input(30));await entered.promise;s.c.documentId='replacement';held.resolve({});await wait();assert.equal(s.starts,0);s.audition.dispose();
});
test('Browser audition newer queued input invalidates older completed audio before throttle fires',async()=>{
 const entered=deferred(),held=deferred(),nextEntered=deferred(),nextHeld=deferred();let requests=0;const s=setup({delayMs:5,fetchImpl:()=>{requests++;if(requests===1){entered.resolve();return held.promise;}nextEntered.resolve();return nextHeld.promise;}});s.audition.unlock();s.audition.request(input(30));await entered.promise;s.audition.request(input(100));held.resolve(response());await nextEntered.promise;assert.equal(s.starts,0);nextHeld.resolve(response());await wait();assert.equal(s.starts,1);assert.equal(s.calls.at(-1).updates[0].value,100);s.audition.dispose();
});
test('Browser audition ignores stale HTTP failures after cancellation',async()=>{
 const entered=deferred(),held=deferred();const s=setup({fetchImpl:()=>{entered.resolve();return held.promise;}});s.audition.unlock();s.audition.request(input(30));await entered.promise;s.audition.cancel();held.reject(new Error('late failure'));await wait();assert.equal(s.starts,0);assert.deepEqual(s.errors,[]);s.audition.dispose();
});
