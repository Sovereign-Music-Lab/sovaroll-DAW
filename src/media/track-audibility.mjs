/** Mixer audibility: explicit mute wins; solo defeat bypasses only solo isolation.
 * This does not model sends, folders, Control Room listen, or external MIDI routes.
 */
export function audibleTrackIds(project){
 const anySolo=project.tracks.some(track=>track.solo===true);
 return new Set(project.tracks.filter(track=>!track.mute&&(!anySolo||track.solo===true||track.soloDefeat===true)).map(track=>track.id));
}
