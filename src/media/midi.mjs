import {prepareMidiExportProject} from './midi-export-options.mjs';
import {projectMidiExportRange} from './midi-export-range.mjs';
import { asBytes, ascii, integer, requireValue } from './common.mjs';
import { compileTempoMap } from './time.mjs';
import { compileMidiStreams, mergeMidiStreams } from './midi-stream.mjs';

const MAX_TRACKS = 256;
const MAX_NOTES = 200000;
const MAX_EVENTS = 1000000;
const MAX_VLQ = 0x0fffffff;
const MAX_RETAINED_EVENTS = 200000;
const MAX_PAYLOAD = 1024 * 1024;
const MAX_PAYLOAD_TOTAL = 4 * 1024 * 1024;
const MAX_BYTES = 64 * 1024 * 1024;

/** Read SMF 0/1 PPQ notes and opaque MIDI events. Retention does not imply synth playback. */
export function parseMidi(input, { ppq = 960,extractMarkers=false,extractSignatures=false } = {}) {
  integer(ppq, 1, 32767, 'Destination MIDI PPQ');
  const bytes = asBytes(input);
  requireValue(bytes.length <= 64 * 1024 * 1024, 'MIDI_TOO_LARGE', 'MIDI files must fit the 64 MiB parser limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireValue(bytes.length >= 14 && ascii(bytes, 0, 4) === 'MThd', 'MALFORMED_MIDI', 'Missing MIDI header.');
  const headerLength = view.getUint32(4);
  requireValue(headerLength >= 6 && headerLength + 8 <= bytes.length, 'MALFORMED_MIDI', 'Truncated MIDI header.');
  const format = view.getUint16(8), trackCount = view.getUint16(10), division = view.getUint16(12);
  requireValue(format === 0 || format === 1, 'UNSUPPORTED_MIDI_FORMAT', 'Only synchronous MIDI formats 0 and 1 are supported; format 2 sequences are not merged.');
  integer(trackCount, 1, MAX_TRACKS, 'MIDI track count');
  requireValue(format !== 0 || trackCount === 1, 'MALFORMED_MIDI', 'MIDI format 0 must have exactly one track.');
  requireValue(division > 0 && !(division & 0x8000), 'UNSUPPORTED_MIDI_TIMEBASE', 'SMPTE MIDI divisions are unsupported; use a PPQ MIDI file.');
  const warnings = new Map();
  const warn = (message, count = 1) => warnings.set(message, (warnings.get(message) ?? 0) + count);
  if (headerLength > 6) warn('Extra MIDI header fields were ignored');
  const scaled = tick => {
    requireValue(Number.isSafeInteger(tick),
      'MALFORMED_MIDI', 'MIDI tick position exceeds the safe numeric range.');
    const numerator = BigInt(tick) * BigInt(ppq), denominator = BigInt(division);
    if (numerator % denominator !== 0n) warn('MIDI timing was rounded to the destination PPQ');
    const rounded = (2n * numerator + denominator) / (2n * denominator);
    requireValue(rounded <= BigInt(Number.MAX_SAFE_INTEGER), 'MALFORMED_MIDI', 'Converted MIDI tick exceeds the safe numeric range.');
    return Number(rounded);
  };
  const tracks = [], tempos = [],markers=[],timeSignatures=[];
  let offset = 8 + headerLength, totalEvents = 0, totalNotes = 0, retainedEvents = 0, payloadBytes = 0;
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
    requireValue(offset + 8 <= bytes.length && ascii(bytes, offset, 4) === 'MTrk',
      'MALFORMED_MIDI', `Missing MIDI track chunk ${trackIndex + 1}.`);
    const length = view.getUint32(offset + 4);
    let cursor = offset + 8;
    const end = cursor + length;
    requireValue(end <= bytes.length, 'MALFORMED_MIDI', `Truncated MIDI track ${trackIndex + 1}.`);
    const need = count => requireValue(cursor + count <= end, 'MALFORMED_MIDI', `Truncated event in MIDI track ${trackIndex + 1}.`);
    const readVLQ = () => {
      let value = 0;
      for (let count = 0; count < 4; count++) {
        need(1);
        const byte = bytes[cursor++];
        value = value * 128 + (byte & 127);
        if (!(byte & 128)) return value;
      }
      requireValue(false, 'MALFORMED_MIDI', 'MIDI variable-length quantities must fit four bytes.');
    };
    let tick = 0, runningStatus = 0, ended = false, name = `Track ${trackIndex + 1}`, nextOrder = 0;
    const notes = [], events = [], pending = new Map();
    const retain = (event, start, size) => {
      requireValue(++retainedEvents <= MAX_RETAINED_EVENTS, 'MIDI_TOO_LARGE', 'MIDI exceeds the 200000 retained event limit.');
      requireValue(size <= MAX_PAYLOAD && (payloadBytes += size) <= MAX_PAYLOAD_TOTAL, 'MIDI_TOO_LARGE', 'Retained MIDI data exceeds the 1 MiB per-event or 4 MiB total payload limit.');
      events.push({ ...event, tick: scaled(tick), data: Array.from(bytes.subarray(start, start + size)) });
    };
    const finishNote = (note, endTick, offOrder, releaseVelocity = 0, noteOffEncoding = 'noteOff') => {
      const startTick = scaled(note.tick), convertedEnd = scaled(endTick);
      const instantaneous = endTick === note.tick;
      if (!instantaneous && convertedEnd <= startTick) warn('Positive sub-tick notes were expanded to one tick');
      notes.push({ pitch: note.pitch, channel: note.channel, velocity: note.velocity,
        startTick, durationTicks: instantaneous ? 0 : Math.max(1, convertedEnd - startTick),
        releaseVelocity, noteOffEncoding, onOrder: note.order, offOrder });
    };
    while (cursor < end) {
      requireValue(++totalEvents <= MAX_EVENTS, 'MIDI_TOO_LARGE', 'MIDI exceeds the one million event limit.');
      const order = nextOrder++;
      tick += readVLQ();
      requireValue(Number.isSafeInteger(tick), 'MALFORMED_MIDI', 'MIDI tick accumulation overflow.');
      need(1);
      let status = bytes[cursor];
      if (status & 128) cursor++;
      else {
        requireValue(runningStatus >= 0x80 && runningStatus <= 0xef,
          'MALFORMED_MIDI', 'MIDI running status has no preceding channel status.');
        status = runningStatus;
      }
      if (status === 0xff) {
        runningStatus = 0;
        need(1);
        const type = bytes[cursor++], size = readVLQ();
        requireValue(type < 128, 'MALFORMED_MIDI', 'MIDI meta event types must fit seven bits.');
        need(size);
        const start = cursor;
        cursor += size;
        if (type === 0x2f) {
          requireValue(size === 0 && cursor === end, 'MALFORMED_MIDI', 'End-of-track must be empty and terminate the track chunk.');
          ended = true;
          break;
        } else if (type === 0x03) {
          requireValue(size <= 65535, 'MIDI_TEXT_TOO_LONG', 'MIDI track names must fit 65535 bytes.');
          try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, cursor)); }
          catch {
            name = new TextDecoder('windows-1252').decode(bytes.subarray(start, cursor));
            warn('Non-UTF-8 track names were decoded as Windows-1252');
          }
          name = name.replace(/\0/g, '').trim() || `Track ${trackIndex + 1}`;
          warn('Track-name metadata is normalized into the track name; its event position and repeated name changes are not retained');
        } else if (type === 0x51) {
          requireValue(size === 3, 'MALFORMED_MIDI', 'MIDI tempo metadata must contain three bytes.');
          const microseconds = bytes[start] * 65536 + bytes[start + 1] * 256 + bytes[start + 2];
          requireValue(microseconds > 0, 'MALFORMED_MIDI', 'MIDI tempo must be greater than zero.');
          const bpm = 60000000 / microseconds;
          if (bpm < 20 || bpm > 300) warn('Tempo outside the supported 20–300 BPM range was omitted');
          else tempos.push({ tick: scaled(tick), bpm });
        } else if(type===0x06&&extractMarkers&&size<=65535){
          requireValue(markers.length<10000,'MIDI_TOO_LARGE','MIDI exceeds the 10000 project marker limit.');
          requireValue((payloadBytes+=size)<=MAX_PAYLOAD_TOTAL,'MIDI_TOO_LARGE','MIDI marker and retained event payload exceeds 4 MiB.');
          let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start,cursor));}catch{text=new TextDecoder('windows-1252').decode(bytes.subarray(start,cursor));warn('Non-UTF-8 marker text was decoded as Windows-1252; original bytes are preserved until renamed');}
          markers.push({tick:scaled(tick),name:text.replace(/\0/g,'').trim().slice(0,256)||'Marker',midiData:Array.from(bytes.subarray(start,cursor))});
        } else if (type === 0x58) {
          requireValue(size === 4, 'MALFORMED_MIDI', 'MIDI time signature metadata must contain four bytes.');
          if(extractSignatures){requireValue(timeSignatures.length<4096,'MIDI_TOO_LARGE','Import supports at most 4096 signature metadata events.');const data=Array.from(bytes.subarray(start,cursor));timeSignatures.push({tick:scaled(tick),numerator:data[0],denominator:data[1]<=6?2**data[1]:null,data});}else warn('Time signature metadata is not imported; the project keeps its existing time signature');
        } else {
          retain({ kind: 'meta', status: 0xff, metaType: type, order }, start, size);
          warn('Opaque MIDI metadata was retained for export but is not applied to project markers or playback');
        }
      } else if (status === 0xf0 || status === 0xf7) {
        runningStatus = 0;
        const size = readVLQ(); need(size);
        retain({ kind: 'sysex', status, order }, cursor, size); cursor += size;
      } else {
        requireValue(status >= 0x80 && status <= 0xef, 'MALFORMED_MIDI', `Unsupported system status 0x${status.toString(16)} in MIDI track.`);
        runningStatus = status;
        const type = status >> 4, channel = status & 15;
        const size = type === 0xc || type === 0xd ? 1 : 2;
        need(size);
        const start = cursor, first = bytes[cursor++], second = size === 2 ? bytes[cursor++] : 0;
        requireValue(first < 128 && second < 128, 'MALFORMED_MIDI', 'MIDI channel data contains an unexpected status byte.');
        if (type === 9 && second !== 0) {
          requireValue(++totalNotes <= MAX_NOTES, 'MIDI_TOO_LARGE', 'MIDI exceeds the 200000 note limit.');
          const key = channel * 128 + first;
          const queue = pending.get(key) ?? { values: [], head: 0 };
          if (queue.head < queue.values.length) warn('Overlapping same-pitch/channel notes were matched to note-offs in FIFO order');
          queue.values.push({ pitch: first, velocity: second, channel, tick, order });
          pending.set(key, queue);
        } else if (type === 8 || (type === 9 && second === 0)) {
          const key = channel * 128 + first, queue = pending.get(key);
          if (queue && queue.head < queue.values.length) {
            finishNote(queue.values[queue.head++], tick, order, second, type === 8 ? 'noteOff' : 'zeroVelocityNoteOn');
            if (queue.head === queue.values.length) pending.delete(key);
          }
          else {
            retain({ kind: 'channel', status, order }, start, size);
            warn('Unmatched MIDI note-offs were retained as raw events');
          }
        } else {
          retain({ kind: 'channel', status, order }, start, size);
        }
      }
    }
    if (!ended) warn('A MIDI track had no end-of-track marker');
    for (const queue of pending.values()) {
      while (queue.head < queue.values.length) {
        finishNote(queue.values[queue.head++], tick, nextOrder++);
        warn('Unclosed MIDI notes were explicitly ended at the track end');
      }
    }
    notes.sort((a, b) => a.startTick - b.startTick || a.channel - b.channel || a.pitch - b.pitch || a.durationTicks - b.durationTicks);
    if (notes.length || events.length) tracks.push({ name, notes, events,
      endTick: notes.reduce((maximum, note) => Math.max(maximum, note.startTick + note.durationTicks), scaled(tick)) });
    offset = end;
  }
  requireValue(offset === bytes.length, 'MALFORMED_MIDI', 'Unexpected bytes after the declared MIDI tracks.');
  tempos.sort((a, b) => a.tick - b.tick);
  const tempoMap = [{ tick: 0, bpm: 120 }];
  const explicitTicks = new Set();
  for (const point of tempos) {
    if (explicitTicks.has(point.tick)) warn('Multiple tempo events at one destination tick were resolved using the last event');
    explicitTicks.add(point.tick);
    if (tempoMap.at(-1).tick === point.tick) tempoMap[tempoMap.length - 1] = point;
    else tempoMap.push(point);
  }
  if (!tracks.length&&!markers.length&&(!extractSignatures||!tempos.length&&!timeSignatures.length)) warn('The MIDI file contained no importable notes, markers or retained MIDI events');
  return { tempoMap, tracks,markers,...(extractSignatures?{sourceFormat:format,sourceTempoEventCount:tempos.length,timeSignatures:timeSignatures.sort((a,b)=>a.tick-b.tick)}:{}), warnings: [...warnings].map(([message, count]) => `${message} (${count}).`) };
}

function vlq(value) {
  integer(value, 0, MAX_VLQ, 'MIDI delta time');
  const result = [value & 127];
  while ((value = Math.floor(value / 128)) > 0) result.unshift((value & 127) | 128);
  return result;
}

function u32(value) { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function chunk(id, body) { return [...id].map(char => char.charCodeAt(0)).concat(u32(body.length), body); }
function textEvent(text) {
  const encoded = new TextEncoder().encode(String(text ?? ''));
  requireValue(encoded.length <= 65535, 'MIDI_TEXT_TOO_LONG', 'MIDI track names must fit 65535 UTF-8 bytes.');
  return [0xff, 3].concat(vlq(encoded.length), Array.from(encoded));
}

function streamEventBytes(event) {
  if (event.kind === 'raw' && event.rawKind === 'sysex') return [event.status].concat(vlq(event.data.length), event.data);
  if (event.kind === 'raw' && event.rawKind === 'meta') return [0xff, event.metaType].concat(vlq(event.data.length), event.data);
  return [event.status].concat(event.data);
}

/** SMF 0/1 export consumes the same ordered performance streams as playback. */
export function writeMidi(project, options = {}) {
  return writeMidiDetailed(project, options).bytes;
}

/** Export diagnostics keep editable-source versus sampled-SMF loss explicit. */
export function writeMidiDetailed(project, { format = 1,trackIds,outputPpq,range,includeChase=true,includeInspectorPatch=true,includeInspectorVolumePan=true,includeModifiers=true,includeMarkers=true,includeDelay=true } = {}) {
  requireValue(format === 0 || format === 1, 'UNSUPPORTED_MIDI_FORMAT', 'MIDI export format must be 0 or 1.');
  requireValue(project && Array.isArray(project.tracks) && Array.isArray(project.clips), 'INVALID_MIDI_PROJECT', 'Expected a project with tracks and clips.');
  const prepared=prepareMidiExportProject(project,{includeInspectorPatch,includeInspectorVolumePan,includeModifiers,includeMarkers,includeDelay});project=prepared.project;
  const ppq = integer(project.ppq ?? 960, 1, 32767, 'MIDI PPQ');
  const destinationPpq=outputPpq===undefined?ppq:integer(outputPpq,24,960,'MIDI output PPQ');
  const scaleTick=tick=>{if(destinationPpq===ppq)return tick;const scaled=(BigInt(tick)*BigInt(destinationPpq)+BigInt(Math.floor(ppq/2)))/BigInt(ppq);requireValue(scaled<=BigInt(Number.MAX_SAFE_INTEGER),'MIDI_TIME_OVERFLOW','Rescaled MIDI tick exceeds safe integer range.');return Number(scaled);};
  compileTempoMap(project.tempoMap, ppq);
  requireValue(trackIds===undefined||Array.isArray(trackIds),'INVALID_MIDI_PROJECT','Selected track IDs must be an array.');
  const midiTrackCount = project.tracks.filter(track => track.type === 'midi'&&(trackIds===undefined||trackIds.includes(track.id))).length;
  requireValue(format === 0 || midiTrackCount + 1 <= MAX_TRACKS, 'MIDI_TOO_LARGE', 'Format 1 export supports at most 255 musical tracks plus a tempo track.');
  let compiled = compileMidiStreams(project,{trackIds});
  const projection=range?projectMidiExportRange(project,compiled,range,{includeChase}):null;if(projection){compiled=projection.compiled;project=projection.metadata;}
  let outputCount = compiled.eventCount, lastTick = compiled.endTick;
  const managedEvent = (tick, rank, bytes) => {
    requireValue(++outputCount <= MAX_EVENTS, 'MIDI_TOO_LARGE', 'MIDI export exceeds the one million event limit.');
    return { tick, rank, bytes };
  };
  const conductor = [managedEvent(0, 0, textEvent(format === 0 ? project.name : 'Tempo'))];
  for (const point of project.tempoMap) {
    const value = Math.round(60000000 / point.bpm);
    conductor.push(managedEvent(point.tick, 1, [0xff, 0x51, 3, (value >> 16) & 255, (value >> 8) & 255, value & 255]));
    lastTick = Math.max(lastTick, point.tick);
  }
  for(const marker of project.markers??[]){
    integer(marker.tick,0,Number.MAX_SAFE_INTEGER,'Marker tick');
    const data=marker.midiData??Array.from(new TextEncoder().encode(marker.name));
    requireValue(data.length<=65535,'MIDI_TEXT_TOO_LONG','Marker text exceeds 65535 bytes.');
    conductor.push(managedEvent(marker.tick,3,[0xff,0x06,...vlq(data.length),...data]));lastTick=Math.max(lastTick,marker.tick);
  }
  const signature = project.timeSignature ?? { numerator: 4, denominator: 4 };
  integer(signature.numerator, 1, 255, 'Time signature numerator');
  integer(signature.denominator, 1, 128, 'Time signature denominator');
  requireValue(Number.isInteger(Math.log2(signature.denominator)), 'INVALID_MIDI_PROJECT', 'MIDI time signature denominator must be a power of two.');
  conductor.push(managedEvent(0, 2, [0xff, 0x58, 4, signature.numerator, Math.log2(signature.denominator), 24, 8]));
  function serialize(stream, managed, minimumEnd = 0) {
    // The scheduler owns all performance order. Only managed metadata is merged here.
    const events = stream.map((event, index) => ({ tick: scaleTick(event.tick), priority: 1, rank: 0, index, bytes: streamEventBytes(event) }))
      .concat(managed.map((event, index) => ({ ...event,tick:scaleTick(event.tick), priority: 0, index })));
    events.sort((a, b) => a.tick - b.tick || a.priority - b.priority || a.rank - b.rank || a.index - b.index);
    const body = [];
    const append = bytes => {
      requireValue(body.length + bytes.length <= MAX_BYTES, 'MIDI_TOO_LARGE', 'MIDI output exceeds 64 MiB.');
      // Large F0/F7 payloads must never be passed as variadic push arguments.
      for (const byte of bytes) body.push(byte);
    };
    let previous = 0;
    for (const event of events) { append(vlq(event.tick - previous)); append(event.bytes); previous = event.tick; }
    append(vlq(Math.max(previous, scaleTick(minimumEnd)) - previous)); append([0xff, 0x2f, 0]);
    return chunk('MTrk', body);
  }
  const outputTracks = [];
  if (format === 0) outputTracks.push(serialize(mergeMidiStreams(compiled), conductor, lastTick));
  else {
    outputTracks.push(serialize([], conductor, lastTick));
    for (const target of compiled.tracks) {
      const name = project.tracks[target.sourceTrack].name;
      outputTracks.push(serialize(target.events, [managedEvent(0, 0, textEvent(name))], target.endTick));
    }
  }
  const chunks = [chunk('MThd', [0, format, outputTracks.length >> 8, outputTracks.length & 255, destinationPpq >> 8, destinationPpq & 255]), ...outputTracks];
  const size = chunks.reduce((sum, item) => sum + item.length, 0);
  requireValue(size <= MAX_BYTES, 'MIDI_TOO_LARGE', 'MIDI output exceeds 64 MiB.');
  const result = new Uint8Array(size);
  let cursor = 0;
  for (const item of chunks) { result.set(item, cursor); cursor += item.length; }
  return { bytes: result,exportOptions:prepared.options,range:projection?.range??null, timingResolution:{sourcePpq:ppq,outputPpq:destinationPpq,rounding:'nearest-ties-up'}, warnings: [...new Set([...(projection?.warnings??[]),...(destinationPpq!==ppq?['SMF tick positions and endpoints were rounded to the selected PPQ; short notes may collapse to zero ticks.']:[]),...(project.markers?.some(m=>m.endTick!==undefined)?['SMF exports cycle marker starts only; cycle ends, object IDs, human numbers and marker-track assignment are not preserved.']:[]),...(compiled.curveWarnings ?? []).map(item => item.message),...(compiled.modifierWarnings??[])])], curveStats: compiled.curveStats ?? null };
}
