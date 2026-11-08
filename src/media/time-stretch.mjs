import{spawn}from'node:child_process';
import{finite,integer,requireValue,mediaError}from'./common.mjs';
const MAX_BYTES=64*1024*1024;
export function tempoFilterChain(tempo){finite(tempo,.125,8,'Stretch tempo');const factors=[];while(tempo>2){factors.push(2);tempo/=2;}while(tempo<.5){factors.push(.5);tempo/=.5;}factors.push(tempo);return factors.map(n=>`atempo=${n}`).join(',');}
/** External pitch-preserving tempo processing. Original buffers are untouched.
 * FFmpeg's output length is approximate; expose any final trim/zero padding. */
export async function timeStretchAudio(source,{targetFrames,ffmpeg=process.env.NEWDAW_FFMPEG??'ffmpeg',signal,timeoutMs=60000}={}){
 const sampleRate=integer(source.sampleRate,8000,384000,'Source sample rate'),frames=integer(source.frames,1,sampleRate*600,'Source frames');integer(targetFrames,1,sampleRate*600,'Stretched frames');requireValue(Array.isArray(source.channels)&&source.channels.length>=1&&source.channels.length<=2,'INVALID_STRETCH_SOURCE','Use mono or stereo audio.');const count=source.channels.length;
 requireValue(frames*count*4<=MAX_BYTES&&targetFrames*count*4<=MAX_BYTES,'STRETCH_LIMIT','Time stretch supports up to64MiB input and output PCM.');for(const c of source.channels)requireValue(c instanceof Float32Array&&c.length===frames,'INVALID_STRETCH_SOURCE','Channels must match source frame count.');
 const tempo=frames/targetFrames,filter=tempoFilterChain(tempo);for(const c of source.channels)for(const value of c)requireValue(Number.isFinite(value),'INVALID_STRETCH_SOURCE','Audio samples must be finite.');
 if(signal?.aborted)throw mediaError('STRETCH_CANCELLED','Time stretch was cancelled.');
 if(targetFrames===frames)return {...source,channels:source.channels.map(c=>c.slice()),processing:{engine:'identity',tempo:1,inputFrames:frames,rawOutputFrames:frames,targetFrames,paddedFrames:0,trimmedFrames:0}};
 const input=Buffer.allocUnsafe(frames*count*4);for(let i=0;i<frames;i++)for(let c=0;c<count;c++)input.writeFloatLE(source.channels[c][i],(i*count+c)*4);
 const bytes=await new Promise((resolve,reject)=>{
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','f32le','-ar',String(sampleRate),'-ac',String(count),'-i','pipe:0','-af',filter,'-f','f32le','-acodec','pcm_f32le','pipe:1'],{stdio:['pipe','pipe','pipe'],signal});const chunks=[];let size=0,stderr='',failure=null;
  const timer=setTimeout(()=>{failure=mediaError('STRETCH_TIMEOUT','Time stretch exceeded its processing deadline.');child.kill('SIGKILL');},timeoutMs);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){failure=mediaError('STRETCH_LIMIT','Processed audio exceeds64MiB PCM.');child.kill('SIGKILL');return;}chunks.push(chunk);});child.stderr.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk.toString().slice(0,8192-stderr.length);});child.stdin.on('error',()=>{});
  child.on('error',error=>{clearTimeout(timer);reject(mediaError(error.name==='AbortError'?'STRETCH_CANCELLED':'STRETCH_ENGINE_UNAVAILABLE',error.name==='AbortError'?'Time stretch was cancelled.':`Unable to start FFmpeg: ${error.message}`));});
  child.on('close',code=>{clearTimeout(timer);if(failure)return reject(failure);if(code!==0)return reject(mediaError('STRETCH_FAILED',stderr||`FFmpeg exited with code ${code}.`));resolve(Buffer.concat(chunks,size));});child.stdin.end(input);
 });
 requireValue(bytes.length>0&&bytes.length%(count*4)===0,'INVALID_STRETCH_OUTPUT','FFmpeg returned incomplete audio samples.');const rawOutputFrames=bytes.length/(count*4),channels=Array.from({length:count},()=>new Float32Array(targetFrames));for(let i=0;i<Math.min(rawOutputFrames,targetFrames);i++)for(let c=0;c<count;c++){const value=bytes.readFloatLE((i*count+c)*4);requireValue(Number.isFinite(value),'INVALID_STRETCH_OUTPUT','FFmpeg returned invalid samples.');channels[c][i]=value;}
 return {sampleRate,frames:targetFrames,channels,processing:{engine:'ffmpeg-atempo',filter,tempo,inputFrames:frames,rawOutputFrames,targetFrames,paddedFrames:Math.max(0,targetFrames-rawOutputFrames),trimmedFrames:Math.max(0,rawOutputFrames-targetFrames),scope:'Offline tempo processing. Approximate output is trimmed/zero-padded to requested length.'}};
}
