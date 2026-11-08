import { validateMidiCurves, splitMidiCurves } from '../media/midi-curves.mjs';
import { fail, MAX_MIDI_EVENTS, MAX_MIDI_EVENT_BYTES, MAX_MIDI_PAYLOAD_BYTES } from './schema.mjs';

export { MAX_MIDI_EVENTS, MAX_MIDI_EVENT_BYTES, MAX_MIDI_PAYLOAD_BYTES };
const own = (value, key) => Object.hasOwn(value, key);
const newId = () => `event-${globalThis.crypto.randomUUID()}`;

export function midiObjectIds(clip) {
  return [clip.id, ...(clip.type === 'midi' ? [...clip.notes.map(note => note.id), ...(clip.events ?? []).map(event => event.id)] : [])];
}

export function hasMidiSourceOrdering(clip) {
  return clip.type === 'midi' && (own(clip, 'midiOrderGroup') || Boolean(clip.events?.length) || clip.notes.some(note => own(note, 'onOrder') || own(note, 'offOrder')));
}

/** Validates an already schema-checked clip, without normalizing old documents. */
export function validateMidiClipEvents(clip, register) {
  try { validateMidiCurves(clip); } catch(error) { fail(error.code??'INVALID_MIDI_CURVE',error.message,error.details); }
  const orders = new Map();
  const order = (tick, value, id, endpoint) => {
    if (value === undefined) return;
    const key = `${tick}:${value}`;
    if (orders.has(key)) fail('MIDI_ORDER_CONFLICT', 'Explicit MIDI order must be unique at each tick within a clip.', { clipId: clip.id, tick, order: value, id, endpoint, previous: orders.get(key) });
    orders.set(key, { id, endpoint });
  };
  for (const note of clip.notes) {
    if (note.durationTicks === 0 && note.offOrder !== undefined && (note.onOrder === undefined || note.onOrder >= note.offOrder)) fail('MIDI_ZERO_NOTE_ORDER', 'An instantaneous note must order note-on before its same-tick note-off.', {clipId:clip.id,noteId:note.id});
    if (note.noteOffEncoding === 'zeroVelocityNoteOn' && (note.releaseVelocity ?? 0) !== 0) fail('INVALID_NOTE_RELEASE', 'A zero-velocity note-on cannot encode nonzero release velocity.', { clipId: clip.id, noteId: note.id });
    order(note.startTick, note.onOrder, note.id, 'on');
    order(note.startTick + note.durationTicks, note.offOrder, note.id, 'off');
  }
  for (const [index, event] of (clip.events ?? []).entries()) {
    register?.(event, index);
    if (event.tick > clip.lengthTicks) fail('MIDI_EVENT_OUT_OF_BOUNDS', 'Raw MIDI events must fit within the clip, including its end tick.', { clipId: clip.id, eventId: event.id });
    if (event.kind === 'channel') {
      const type = event.status >> 4, size = type === 12 || type === 13 ? 1 : 2;
      if (event.data.length !== size || event.data.some(byte => byte > 127) || (type === 9 && event.data[1] !== 0)) fail('INVALID_MIDI_EVENT', 'Channel events require the exact 7-bit payload for their status; positive note-ons use notes.', { clipId: clip.id, eventId: event.id });
    } else if (event.kind === 'meta' && [0x03, 0x2f, 0x51, 0x58].includes(event.metaType)) {
      fail('MANAGED_MIDI_META', 'Track name, end-of-track, tempo and time signature use the managed export policy.', { clipId: clip.id, eventId: event.id, metaType: event.metaType });
    }
    order(event.tick, event.order, event.id, 'event');
  }
}

export function midiEventUsage(project) {
  let count = 0, bytes = 0;
  for (const clip of project.clips) if (clip.type === 'midi') for (const event of clip.events ?? []) {
    count++; bytes += event.data.length;
    if (event.data.length > MAX_MIDI_EVENT_BYTES) fail('MIDI_PAYLOAD_LIMIT', 'One raw MIDI payload may contain at most 1 MiB.', { eventId: event.id, limit: MAX_MIDI_EVENT_BYTES });
  }
  return { count, bytes };
}

export function validateMidiEventBudget(project) {
  const usage = midiEventUsage(project);
  if (usage.count > MAX_MIDI_EVENTS) fail('MIDI_EVENT_LIMIT', 'A project may contain at most 200000 raw MIDI events.', { ...usage, limit: MAX_MIDI_EVENTS });
  if (usage.bytes > MAX_MIDI_PAYLOAD_BYTES) fail('MIDI_PAYLOAD_LIMIT', 'Raw MIDI payloads may contain at most 4 MiB per project.', { ...usage, limit: MAX_MIDI_PAYLOAD_BYTES });
  return usage;
}

/** Copy guards run before allocating any event/clip copies. */
export function checkMidiEventCopies(project, clips, count = 1) {
  const usage = midiEventUsage(project);
  for (const clip of clips) if (clip.type === 'midi') for (const event of clip.events ?? []) {
    usage.count += count; usage.bytes += count * event.data.length;
  }
  if (usage.count > MAX_MIDI_EVENTS || usage.bytes > MAX_MIDI_PAYLOAD_BYTES) fail('COPY_LIMIT', 'Copies would exceed the project raw MIDI event or payload budget.', { events: usage.count, payloadBytes: usage.bytes, maxEvents: MAX_MIDI_EVENTS, maxPayloadBytes: MAX_MIDI_PAYLOAD_BYTES });
}

export function addMidiEvents(clip, inputs) {
  let maximum = -1;
  for (const note of clip.notes) for (const key of ['onOrder', 'offOrder']) if (own(note, key)) maximum = Math.max(maximum, note[key]);
  for (const event of [...(clip.events ?? []), ...inputs]) if (own(event, 'order')) maximum = Math.max(maximum, event.order);
  const added = inputs.map(input => {
    const event = structuredClone(input);
    event.id ??= newId();
    if (!own(event, 'order')) {
      if (maximum === Number.MAX_SAFE_INTEGER) fail('MIDI_ORDER_OVERFLOW', 'No safe source order remains. Supply an explicit unused order at the desired tick.');
      event.order = ++maximum;
    }
    return event;
  });
  clip.events = [...(clip.events ?? []), ...added];
  return added;
}

export function splitMidiEvents(clip, right, delta, options = {}) {
  try { return splitMidiCurves(clip,right,delta,options); }
  catch(error) { fail(error.code??'INVALID_MIDI_CURVE',error.message,error.details); }
}
