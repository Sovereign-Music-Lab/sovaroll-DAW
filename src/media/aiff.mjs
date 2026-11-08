import {encodeWav} from './wav.mjs';
import {requireValue} from './common.mjs';
/** AIFF uncompressed signed big-endian PCM. Quantization/dither are shared with
 * WAV; AIFC and floating-point AIFF are intentionally separate unsupported modes.
 */
export function encodeAiff(options){
 const format=options.sampleFormat??'pcm16';requireValue(['pcm16','pcm24'].includes(format),'INVALID_AIFF_FORMAT','AIFF supports PCM16 or PCM24 output.');
 const wav=encodeWav({...options,sampleFormat:format}),source=new DataView(wav.buffer,wav.byteOffset,wav.byteLength),dataLength=source.getUint32(40,true),sampleBytes=format==='pcm24'?3:2;
 const bytes=new Uint8Array(54+dataLength+dataLength%2),view=new DataView(bytes.buffer),text=(offset,value)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
 text(0,'FORM');view.setUint32(4,bytes.length-8);text(8,'AIFF');text(12,'COMM');view.setUint32(16,18);view.setUint16(20,options.channels.length);view.setUint32(22,options.channels[0].length);view.setUint16(26,sampleBytes*8);
 const exponent=Math.floor(Math.log2(options.sampleRate)),mantissa=BigInt(options.sampleRate)<<BigInt(63-exponent);view.setUint16(28,16383+exponent);view.setBigUint64(30,mantissa);
 text(38,'SSND');view.setUint32(42,dataLength+8);view.setUint32(46,0);view.setUint32(50,0);
 for(let offset=0;offset<dataLength;offset+=sampleBytes)for(let byte=0;byte<sampleBytes;byte++)bytes[54+offset+byte]=wav[44+offset+sampleBytes-1-byte];
 return bytes;
}

/** AIFF/AIFC PCM8/16/24 and AIFC float32 decoder. Unknown compression and
 * precision-losing PCM32/float64 conversions are rejected. Non-audio chunks
 * are not archived by this decoder. */
export function decodeAiff(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(offset,n)=>String.fromCharCode(...bytes.subarray(offset,offset+n));
 requireValue(bytes.length>=12&&text(0,4)==='FORM'&&['AIFF','AIFC'].includes(text(8,4)),'UNSUPPORTED_AIFF','Expected AIFF or AIFC.');
 const aifc=text(8,4)==='AIFC';
 const end=view.getUint32(4)+8;requireValue(end>=12&&end<=bytes.length,'MALFORMED_AIFF','FORM size exceeds available bytes.');let common=null,sound=null;
 for(let offset=12;offset<end;){
  requireValue(offset+8<=end,'MALFORMED_AIFF','Truncated AIFF chunk.');const id=text(offset,4),size=view.getUint32(offset+4),start=offset+8;
  requireValue(start+size<=end,'MALFORMED_AIFF','AIFF chunk exceeds FORM bounds.');
  if(id==='FVER'&&aifc)requireValue(size>=4&&view.getUint32(start)===0xa2805140,'UNSUPPORTED_AIFF','Unsupported AIFC format version.');
  if(id==='COMM'){requireValue(!common&&size>=(aifc?23:18),'MALFORMED_AIFF','AIFF requires one complete COMM chunk.');const exponent=view.getUint16(start+8),mantissa=view.getBigUint64(start+10);common={channels:view.getUint16(start),frames:view.getUint32(start+2),bits:view.getUint16(start+6),sampleRate:Number(mantissa)*2**((exponent&0x7fff)-16383-63),negative:!!(exponent&0x8000),compression:aifc?text(start+18,4):'NONE'};if(aifc)requireValue(23+bytes[start+22]<=size,'MALFORMED_AIFF','Truncated AIFC compression name.');}
  if(id==='SSND'){requireValue(!sound&&size>=8,'MALFORMED_AIFF','AIFF requires one complete SSND chunk.');const displacement=view.getUint32(start);requireValue(displacement<=size-8,'MALFORMED_AIFF','Invalid SSND sample offset.');sound={offset:start+8+displacement,length:size-8-displacement};}
  offset=start+size+size%2;requireValue(offset<=end,'MALFORMED_AIFF','Truncated AIFF chunk padding.');
 }
 requireValue(common&&sound,'MALFORMED_AIFF','Missing COMM or SSND chunk.');
 const floating=['fl32','FL32'].includes(common.compression),little=common.compression==='sowt';
 requireValue(floating?common.bits===32:['NONE','twos','sowt'].includes(common.compression)&&[8,16,24].includes(common.bits),'UNSUPPORTED_AIFF','Supported input: PCM8/16/24 (NONE/twos/sowt) or AIFC float32. PCM32/float64/compressed codecs are unsupported.');
 requireValue(!common.negative&&Number.isSafeInteger(common.sampleRate)&&common.sampleRate>=1&&common.sampleRate<=384000,'UNSUPPORTED_AIFF','AIFF sample rate must be a positive integer up to 384000 Hz.');
 requireValue(common.channels>=1&&common.channels<=8&&common.frames>0&&common.frames*common.channels<=64000000,'AIFF_TOO_LARGE','AIFF needs 1–8 channels and at most 64 million samples.');
 const sampleBytes=common.bits/8;requireValue(common.frames*common.channels*sampleBytes<=sound.length,'MALFORMED_AIFF','AIFF sample data is truncated.');
 const channels=Array.from({length:common.channels},()=>new Float32Array(common.frames));let offset=sound.offset;
 for(let frame=0;frame<common.frames;frame++)for(let channel=0;channel<common.channels;channel++){
  let sample;
  if(floating){sample=view.getFloat32(offset,false);requireValue(Number.isFinite(sample),'INVALID_AIFF_SAMPLE','AIFC contains non-finite float samples.');}
  else if(common.bits===8)sample=view.getInt8(offset)/128;
  else if(common.bits===16)sample=view.getInt16(offset,little)/32768;
  else{sample=little?(bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16):(bytes[offset]<<16|bytes[offset+1]<<8|bytes[offset+2]);if(sample&0x800000)sample-=0x1000000;sample/=8388608;}
  channels[channel][frame]=sample;offset+=sampleBytes;
 }
 return{sampleRate:common.sampleRate,frames:common.frames,channels,bits:common.bits,compression:common.compression,container:aifc?'AIFC':'AIFF'};
}
