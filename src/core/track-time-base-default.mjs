import {resolveTimeDisplay} from '../media/time-display.mjs';
/** Apply only when creating a new track. Copies retain the source track's own setting. */
export function applyNewTrackTimeBase(project,track,explicit){
 const preference=explicit??project.defaultTrackTimeBase;if(!preference)return;
 const mode=preference==='followTransport'?(resolveTimeDisplay(project.timeDisplay).primaryFormat==='bars-beats'?'musical':'linear'):preference;
 track[track.type==='midi'?'midiTimeBase':'audioTimeBase']=mode;
}
