import { asBytes, ascii, finite, integer, requireValue } from './common.mjs';

const MAX_SAMPLES = 64_000_000;

/** Little-endian RIFF WAVE: integer PCM16/24/32 and IEEE float32, up to eight channels. */
export function decodeWav(input) {
  const bytes = asBytes(input);
  requireValue(bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE',
    'UNSUPPORTED_WAV', 'Expected a little-endian RIFF/WAVE file (RIFX and RF64 are unsupported).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  requireValue(end >= 12 && end <= bytes.length, 'MALFORMED_WAV', 'The RIFF length exceeds the available WAV bytes.');
  let format, data;
  for (let offset = 12; offset < end;) {
    requireValue(offset + 8 <= end, 'MALFORMED_WAV', 'Truncated WAV chunk header.');
    const id = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    requireValue(start + length <= end, 'MALFORMED_WAV', `Truncated WAV ${id} chunk.`);
    if (id === 'fmt ') {
      requireValue(!format && length >= 16, 'MALFORMED_WAV', 'WAV needs one valid format chunk.');
      format = {
        encoding: view.getUint16(start, true), count: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
        align: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true)
      };
    } else if (id === 'data') {
      requireValue(!data, 'UNSUPPORTED_WAV', 'WAV files with multiple data chunks are unsupported.');
      data = { start, length };
    }
    const next = start + length + (length % 2);
    requireValue(next <= end, 'MALFORMED_WAV', 'Missing WAV chunk padding byte.');
    offset = next;
  }
  requireValue(format && data, 'MALFORMED_WAV', 'WAV requires both fmt and data chunks.');
  const { encoding, count, sampleRate, bits, align, byteRate } = format;
  integer(count, 1, 8, 'WAV channels');
  integer(sampleRate, 1, 384000, 'WAV sample rate');
  requireValue((encoding === 1 && [16, 24, 32].includes(bits)) || (encoding === 3 && bits === 32),
    'UNSUPPORTED_WAV_ENCODING', `WAV encoding ${encoding}, ${bits}-bit is unsupported; use PCM16/24/32 or IEEE float32.`);
  const sampleBytes = bits / 8;
  requireValue(align === count * sampleBytes && byteRate === sampleRate * align,
    'MALFORMED_WAV', 'WAV block alignment or byte rate disagrees with its format.');
  requireValue(data.length % align === 0, 'MALFORMED_WAV', 'WAV data ends in a partial sample frame.');
  const frames = data.length / align;
  requireValue(frames * count <= MAX_SAMPLES, 'WAV_TOO_LARGE', 'Decoded WAV exceeds the 64 million sample memory limit.');
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let frame = 0, position = data.start; frame < frames; frame++) {
    for (let channel = 0; channel < count; channel++, position += sampleBytes) {
      let value;
      if (encoding === 3) value = view.getFloat32(position, true);
      else if (bits === 16) value = view.getInt16(position, true) / 32768;
      else if (bits === 24) {
        const packed = bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16);
        value = ((packed << 8) >> 8) / 8388608;
      } else value = view.getInt32(position, true) / 2147483648;
      requireValue(Number.isFinite(value), 'MALFORMED_WAV', 'WAV contains a non-finite floating-point sample.');
      channels[channel][frame] = value;
    }
  }
  return { sampleRate, channels, frames };
}

/** Encode PCM16/24 or IEEE float32; integer PCM clamps headroom without normalization or dither. */
export function encodeWav({ sampleRate, channels,sampleFormat='pcm16',dither='none',ditherSeed=0x6d2b79f5,ditherChannelOffset=0 } = {}) {
  integer(sampleRate, 1, 384000, 'WAV sample rate');
  requireValue(Array.isArray(channels) && channels.length >= 1 && channels.length <= 8,
    'INVALID_WAV_CHANNELS', 'WAV needs 1–8 planar channels.');
  const frames = channels[0]?.length;
  integer(frames, 0, MAX_SAMPLES, 'WAV frame count');
  requireValue(frames * channels.length <= MAX_SAMPLES, 'WAV_TOO_LARGE', 'WAV exceeds the 64 million sample memory limit.');
  for (const channel of channels) {
    requireValue((Array.isArray(channel) || ArrayBuffer.isView(channel)) && channel.length === frames,
      'INVALID_WAV_CHANNELS', 'All WAV channels must contain the same number of samples.');
  }
  requireValue(['pcm16','pcm24','float32'].includes(sampleFormat),'INVALID_WAV_FORMAT','Use pcm16, pcm24 or float32.');
  requireValue(['none','tpdf'].includes(dither),'INVALID_DITHER','Use none or tpdf dither.');
  integer(ditherSeed,1,0xffffffff,'Dither seed');integer(ditherChannelOffset,0,7,'Dither channel offset');
  requireValue(sampleFormat!=='float32'||dither==='none','INVALID_DITHER','Float32 export does not apply integer PCM dither.');
  const random=channels.map((_,channel)=>{let state=(ditherSeed^Math.imul(channel+ditherChannelOffset+1,0x9e3779b9))>>>0;if(!state)state=0x6d2b79f5;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};});
  const bits=sampleFormat==='pcm16'?16:sampleFormat==='pcm24'?24:32,sampleBytes=bits/8,floating=sampleFormat==='float32',dataStart=floating?56:44;
  const dataLength = frames * channels.length * sampleBytes,padding=dataLength%2;
  const bytes = new Uint8Array(dataStart + dataLength+padding);
  const view = new DataView(bytes.buffer);
  const label = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
  label(0, 'RIFF'); view.setUint32(4, bytes.length-8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, floating?3:1, true);
  view.setUint16(22, channels.length, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * sampleBytes, true);
  view.setUint16(32, channels.length * sampleBytes, true); view.setUint16(34, bits, true);
  if(floating){label(36,'fact');view.setUint32(40,4,true);view.setUint32(44,frames,true);}
  label(dataStart-8, 'data'); view.setUint32(dataStart-4, dataLength, true);
  for (let frame = 0, position = dataStart; frame < frames; frame++) {
    for (const [channelIndex,channel] of channels.entries()) {
      const value = channel[frame];
      finite(value, -Number.MAX_VALUE, Number.MAX_VALUE, 'WAV sample');
      const bounded = Math.max(-1, Math.min(1, value));
      if(floating){requireValue(Number.isFinite(Math.fround(value)),'WAV_SAMPLE_OVERFLOW','Sample exceeds finite float32 range.');view.setFloat32(position,value,true);}
      else{
        const scale=bits===24?8388608:32768,noise=dither==='tpdf'?random[channelIndex]()-random[channelIndex]():0;
        const sample=Math.max(-scale,Math.min(scale-1,Math.round(bounded*(bounded<0?scale:scale-1)+noise)));
        if(bits===24){bytes[position]=sample&255;bytes[position+1]=(sample>>8)&255;bytes[position+2]=(sample>>16)&255;}
        else view.setInt16(position,sample,true);
      }
      position += sampleBytes;
    }
  }
  return bytes;
}
