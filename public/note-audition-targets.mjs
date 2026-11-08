/** Audition the nearest existing onset as a chord, not the whole painted path.
 * Equal-distance ties choose the earlier onset; preview points already carry
 * the gesture's selected-note and channel restrictions. Never truncate chords. */
export function noteAuditionTargets(points,tick,{maxNotes=32}={}){
 if(!Number.isFinite(tick)||!Array.isArray(points))throw new TypeError('Expected preview points and a finite cursor tick.');
 let onset=null,distance=Infinity;
 for(const p of points){const d=Math.abs(p.tick-tick);if(d<distance||d===distance&&(onset===null||p.tick<onset)){onset=p.tick;distance=d;}}
 const chord=onset===null?[]:points.filter(p=>p.tick===onset);
 return {onset,overflow:chord.length>maxNotes,count:chord.length,updates:chord.length>maxNotes?[]:chord.map(({noteId,value})=>({noteId,value}))};
}
