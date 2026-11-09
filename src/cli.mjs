#!/usr/bin/env node
import {planTapTempo} from './media/tap-tempo.mjs';
import {selectProjectClips,parseClipClipboard,planAudioSlip,planAudioTrim,planZeroCrossingSplits,planZeroCrossingBoundarySplits,refineZeroCrossingTrims,repeatedSplitTicks,planMidiPartEndResize,planMidiPartStartResize,sortProjectMarkers} from './media/editor-geometry.mjs';
import {resolveExportPresetOptions} from './media/export-presets.mjs';
import {createHash} from 'node:crypto';
import {MAX_WAV_FILE_BYTES} from './media/asset-limits.mjs';
import {compileTempoMap} from './media/time.mjs';
import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { startServer } from './server.mjs';
import { createProject, validateProject } from './core/engine.mjs';
import { createDemoProject } from './demo.mjs';
import { atomicWrite } from './storage.mjs';
import { collectProject, recoverProject, recoverAutoBackup } from './project-files.mjs';

const HELP=`Sovereign DAW / SovaRoll 0.129.0 — GUI + CLI, shared native MIDI transport and offline preview

Usage: node src/cli.mjs <action> [arguments] [options]

  serve                       Start local GUI and headless command server
    --project PATH --port N    Open a different project (default sessions/First-Light.newdaw.json)
  init PATH [--demo]           Create a new project; refuses to overwrite an existing file
  audition OUTPUT.wav JSON    Render temporary note values via the shared GUI API; no project edits
                              JSON: {clipId,field?,updates:[{noteId,value}]}
                              --duration 0.05..2 --revision N --force; muted targets write no file
  status                      Read project state; does not change revision or selection
  projects                    List open projects and the active project (may be none)
  project-open-plan PATH [--inactive]
                              Inspect a file to add to the workspace; keep other projects open
  project-open-recent-plan ENTRY_ID [--inactive]
  project-open PLAN_ID [--current preserve|save] [--dry-run]
  project-activate-plan DOCUMENT_ID
  project-activate PLAN_ID [--current preserve|save] [--dry-run]
  project-close-plan DOCUMENT_ID
  project-close PLAN_ID [--current preserve|save] [--dry-run]
                              Close only the reviewed document; never auto-activate another
  drafts                      List Untitled recovery records across project folders
  native-ports                List actual macOS MIDI source/destination IDs (no output)
  native-status               Read the shared server's native MIDI transport
  native-settings [JSON]      Read/update this project's mode/routes; explicit profile CAS
  native-play [--start-tick N] Start routed MIDI only; audio clips are not played
  native-stop [JOB_ID]        Stop the shared current job (older job IDs are rejected)
  midi-reset                  Cancel native playback and Reset configured ports on all16 channels
  remove-dc CLIP_ID            Nondestructive per-channel DC correction (--dry-run)
  commit-midi-take FILE.json  Commit timestamped events as editable MIDI (--dry-run)
  audio-statistics CLIP_ID [raw|event]  Source-sample peak/RMS/DC analysis
  normalize-audio CLIP_ID [DBFS]  Nondestructive source-sample peak normalization
  split-settings [JSON]       Read/update common MIDI split preferences (revision/fingerprint CAS)
  timing-settings [JSON]      Read/update shared display PPQ and Length Adjustment
  display-command CMD JSON TIMES  Edit explicit time fields in shared display ticks
  time-command CMD JSON TIMES [OPTIONS]  Edit MIDI note/clip formatted times; explicit rounding
  time-display JSON          Read project time in primary/timeline/piano format
  copy-clips OUTPUT.newdaw-clips.json JSON  Save a read-only selection snapshot
  paste-clips INPUT.newdaw-clips.json JSON  Paste with {atTick|atSample|original:true,trackMode?,createMissingTracks?}
  split-zero JSON            {atTick,clipIds?}; atomic split, supports --dry-run
  stretch-audio-batch JSON   [{clipId,targetFrames,startSample?},...]; --dry-run
  stretch-audio CLIP_ID JSON  {targetFrames,startSample?}; supports --dry-run
  restore-audio-processing CLIP_ID  Restore source settings; supports --dry-run
  audio-processing CLIP_ID   Read processing provenance from verified event WAV
  zero-crossing CLIP_ID AT_SAMPLE  Read-only nearest zero crossing query (10ms)
  markers [JSON]            Read sorted marker list; {sortBy?,direction?}; no project changes
  tap-tempo JSON            {tapTimesMs,mode?,cursorTick?,selectionStartTick?,lastPlaybackStartTick?,playing?,tempoTrackEnabled?}; --dry-run
  resize-midi-parts JSON    {clipIds,deltaTicks,edge?:left|right}; default right, preserves source; --dry-run
  trim-clips JSON            {clipIds,edge:left|right,seconds}; supports --dry-run
  slip-clips JSON            {clipIds,seconds}; source-only grouped slip, supports --dry-run
  select-clips JSON          Query {mode,selectedIds?,trackIds?,cursorTick?}; no edits
  time-snap JSON             Query saved primary/piano snap; localTick and optional clipId/cell
  time-ruler JSON            Read bounded elapsed-format ruler intervals (pixels)
  time-convert JSON          Read exact musical position/duration using current profile
  note-time CLIP NOTE JSON    Edit displayed start/length using the current timing profile
  reset-settings [JSON]       Read/update shared Reset preferences (revision + fingerprint CAS)
  chase-settings [JSON]      Read/update shared Chase types (revision + fingerprint CAS)
  controller-settings [JSON] Read shared CC menu / presets / New Event Type; JSON updates
                              require expectedRevision and expectedFingerprint; --dry-run supported
  project-locations           Read shared default/prompt location preferences
  project-location-settings JSON [--location-revision N] [--dry-run]
                              Save {locationMode,defaultLocation} with a profile revision guard
  project-folders [PATH] [--cursor N]
                              Browse actual local folders without creating or reading files
  project-new-plan [FOLDER] [--sample-rate N] [--inactive]
    --folder-name NAME        With profile default mode: child name; empty means Untitled
    --chosen-folder PATH      With profile prompt mode: this project's final folder
    --location-revision N     Expected shared preference revision (otherwise read current)
  project-new PLAN_ID [--current preserve|save] [--save-output PATH]
  project-recover-plan DRAFT_ID [--inactive]
  project-recover PLAN_ID [--current preserve|save] [--save-output PATH]
                              Create or recover an Untitled project, retaining other open documents
  document                    Show active filename and explicit Save checkpoint
  recent                      List recent projects and missing/changed-file diagnostics
  open-plan PATH              Inspect an existing project without changing it
  open-recent-plan ENTRY_ID    Inspect a selected recent project
  open PLAN_ID --current preserve|save
                              Legacy replacement: close the old file and activate the inspected file
  recent-remove ENTRY_ID      Remove only a recent-list entry, not the project
  recent-clear --confirm       Clear only the recent list
    --recent-store PATH       With serve: choose a shared recent-list file
  save [--output PATH]        Set explicit Save; Untitled first Save requires a new named path
  save-new-version            Save and activate the next numbered filename
  save-as OUTPUT.json         Save and activate another new filename; collect WAV for another folder
  revert-plan                 Preview changes discarded and newly created owned media
  revert PLAN_ID --confirm --media keep|trash
                              Return to explicit Save; reset undo; choose media retention
  revert-trash                List recoverable media from past Reverts
  restore-revert-media ID     Restore one recorded Revert trash operation without overwriting media
  history                     List edit actions, descriptions and current undo/redo boundary
  backups                     List automatic project backups and settings
  backup-now                  Save a changed project backup now (--force also saves unchanged state)
  backup-settings JSON        Set {enabled,intervalMinutes,maxCount}; supports --dry-run
  recover-backup INPUT.json BACKUP_ID --output NEWFILE.json
                              Recover a managed automatic backup, collecting media for a new folder
  source-archives             List original source container archive status
  source-archive-download ID OUTPUT   Download and verify original container
  source-archive-restore ID SOURCE    Restore missing exact original; no overwrite
  assets                      Verify shared-session media hashes and show clip references
  restore-asset ASSET_ID SOURCE.wav
                              Restore exact SHA-256 source bytes; project revision is unchanged
    --dry-run                 Check the candidate and repair plan without writing files
  media-search JSON           Start {assetId,location,mode,queryName?,caseSensitive?} search
  media-search-status ID      Read progress and candidates without changing the project
  media-search-stop ID        Stop a search and retain discovered candidates
  media-plan JSON             Preview {searchId,candidateId,autoMap?,framePolicy?}
  media-accept PLAN_ID        Apply reviewed source mappings (--allow-replacement for changed content)
  remove-missing             Remove all currently missing Pool sources and referencing clips
                              Supports --dry-run; never deletes physical media files
  guide [TOPIC|all]           Routine-based bilingual usage guide (offline; no server needed)
  commands                    Show runtime command schemas and help
  command NAME JSON           Apply one command; JSON is its arguments object
  batch FILE.json             Apply an array of commands atomically, one undo step
  import-many FILE...         Import up to 32 files; --placement parallel|serial
  --no-effect-tail           Disable automatic delay tail (whole-song render only)
  --midi-single-part          Combine MIDI source tracks into one editable part
  --midi-position start|left-locator   Choose MIDI insertion position
  --midi-auto-dissolve         Split format-0 channels into new MIDI tracks
  --midi-extract-patch / --midi-extract-volume-pan   Move first MIDI setup into Inspector
  --midi-tempo auto|preserve|replace / --midi-signature preserve|initial / --midi-no-markers
  import FILE.wav|FILE.aiff|FILE.mid     Import into the shared session; print loss warnings
  render OUTPUT.wav           Render a frozen session revision and write metadata sidecar
    --duration SECONDS        Explicit output duration (max 600), otherwise whole session + tail
    --tail SECONDS            Auto-duration or locator tail (default 0.2)
    --channel-mode MODE       stereo (default) or mono; mono = (L+R)/2
    --at-sample N               Audio import position in project samples; --track-id selects target
  --file-format wav|aiff      Output container; AIFF supports PCM16/24
  --export-preset ID          Project format preset; explicit flags override its defaults
  --dither none|tpdf          Optional deterministic TPDF for integer PCM
  --dither-seed N             Reproducible noise seed, 1..4294967295
  --output-sample-rate N      Post-mix sample-rate conversion, 8000..96000 Hz
  --split-channels            Separate stereo L/R mono WAVs in a stem batch
  --mixdown                   One mix WAV per range instead of one per track
  --cycle-marker-id ID        Stem range selection (repeatable); creates per-range folders
  --track-id ID                Render only these tracks (repeatable); bypass solo, retain mute/master
  --sample-format FORMAT    pcm16 (default), pcm24 or float32; no dither
    --locators                Export saved Locator range, plus tail; no --start-tick/--duration
  render-stems OUTPUT.zip      Export aligned per-track WAVs plus manifest (128 MiB ZIP)
  offline-render-stems-dir INPUT.json NEW_DIR  Write one WAV at a time; no aggregate ZIP cap
  offline-render-stems INPUT.json OUTPUT.zip  Read-only stem batch without server
  offline-render INPUT.json OUTPUT.wav   Headless read-only render without running server
  export-musicxml OUT.musicxml  Export MIDI tracks as MusicXML score; repeat --track-id ID; --key-fifths -7..7
  export-midi OUTPUT.mid      Export MIDI; --midi-format 0|1; --midi-ppq 24..960; repeat --track-id ID; --locators [--midi-no-chase]
  export-project OUTPUT.json  Export project JSON; assets are relative references, not bundled
  export-bundle OUTPUT.zip    Collect a frozen live-session snapshot and verified assets (64 MiB)
  collect INPUT.json DEST_DIR Copy a validated snapshot and every asset into a new directory
    --dry-run                 Check source hashes and destination without writing anything
  recover INPUT.json --output NEWFILE.json
                              Recover INPUT.json.bak without replacing the source or backup
                              A different output directory must be new; assets are collected

Shared options:
  --url URL                   Server URL (default http://127.0.0.1:4317)
  --revision N                Optimistic project revision guard (otherwise fetch current revision)
  --workspace-revision N      Workspace membership/activation revision guard
  --start-tick N              Render from this MIDI tick with Chase (up to 600s output from any project position)
  --timing-options JSON        Offline-render only: explicit displayPpq/lengthAdjustmentTicks
  --chase-options JSON         One-render override; requires --start-tick
  --midi-no-patch / --midi-no-volume-pan / --midi-no-modifiers
  --midi-no-markers / --midi-no-delay   Omit these stored settings from export-midi
  --dry-run                   Validate commands, collection, recovery or media repair without writes
  --force                     Replace an existing export file
  --help                      Show this help

Examples:
  npm start
  npm run cli -- status
  npm run cli -- command track.add '{"type":"midi","name":"Piano"}'
  npm run cli -- command track.update '{"trackId":"track-keys","gainDb":-9}' --dry-run
  npm run cli -- render sessions/mix.wav

GUI: http://127.0.0.1:4317  •  All edits auto-save. Undo history is saved beside the project and restored on reopen.
MIDI interchange preserves notes, release velocity and stored channel/SysEx/meta events.
Controller curves stay editable in project JSON. midi.controllers.setValues edits existing
point values without creating, moving or reordering stored events; see commands for schema.
midi.controllers.bend {clipId,eventId,deltaValue} bends a Ramp/Bezier midpoint;
  endpoints stay fixed and handle values clamp within the MIDI domain.
midi.mergeLoop merges [leftTick,rightTick) to first selectedTrackIds or a new track.
  Options: includeInserts, eraseDestination, includeChase and chaseOptions.
  chaseOptions selects notes/polyPressure/controllers/program/aftertouch/pitchbend/sysex
  and controllersOutsideParts. These are per-merge options, not global transport preferences.
  Same-tick note-on/off pairs use durationTicks:0 and preserve explicit source ordering.
  Sends/VST3 are unsupported.
  Source mute/solo is respected; output settings on the destination are not reset.
midi.modifiers.set / midi.trackParameters.set / midi.partModifiers.set preserve source notes.
midi.modifiers.freeze bakes supported output settings and curves; native input, inserts,
sends and Hermode tuning remain unsupported. Use --dry-run to inspect a change.
The built-in oscillator plays CC7/10/11/64/66, pitch bend, RPN 0 and CC120/121/123.
Each track/channel has independent state. Original patches, pressure and SysEx are not
played; unsupported messages remain preserved for MIDI export. Audio and mixer
state are not encoded in MIDI. Format 0 merges tracks. Import returns explicit loss warnings.
`;
const print=value=>process.stdout.write(`${JSON.stringify(value,null,2)}\n`);
async function ensureOutput(filename,force){if(!force){try{await fs.access(filename);throw new Error(`Output exists: ${filename} (use --force to replace)`);}catch(e){if(e.code!=='ENOENT')throw e;}}}

export async function main(args=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{help:{type:'boolean'},url:{type:'string',default:'http://127.0.0.1:4317'},project:{type:'string'},output:{type:'string'},port:{type:'string'},revision:{type:'string'},'dry-run':{type:'boolean'},demo:{type:'boolean'},'file-format':{type:'string'},'export-preset':{type:'string'},dither:{type:'string'},'dither-seed':{type:'string'},'split-channels':{type:'boolean'},mixdown:{type:'boolean'},'cycle-marker-id':{type:'string',multiple:true},placement:{type:'string'},'at-sample':{type:'string'},'track-id':{type:'string',multiple:true},'channel-mode':{type:'string'},'sample-format':{type:'string'},locators:{type:'boolean'},duration:{type:'string'},tail:{type:'string'},'no-effect-tail':{type:'boolean'},'start-tick':{type:'string'},'chase-options':{type:'string'},'timing-options':{type:'string'},force:{type:'boolean'},'allow-replacement':{type:'boolean'},confirm:{type:'boolean'},media:{type:'string'},current:{type:'string'},'recent-store':{type:'string'},inactive:{type:'boolean'},'workspace-revision':{type:'string'},'output-sample-rate':{type:'string'},'sample-rate':{type:'string'},'save-output':{type:'string'},'location-revision':{type:'string'},'folder-name':{type:'string'},'chosen-folder':{type:'string'},cursor:{type:'string'},'midi-single-part':{type:'boolean'},'midi-position':{type:'string'},'midi-auto-dissolve':{type:'boolean'},'midi-extract-patch':{type:'boolean'},'midi-extract-volume-pan':{type:'boolean'},'midi-tempo':{type:'string'},'midi-signature':{type:'string'},'midi-no-patch':{type:'boolean'},'midi-no-volume-pan':{type:'boolean'},'midi-no-modifiers':{type:'boolean'},'midi-no-markers':{type:'boolean'},'midi-no-delay':{type:'boolean'},'midi-no-chase':{type:'boolean'},'midi-ppq':{type:'string'},'midi-format':{type:'string'},'key-fifths':{type:'string'}}});
  const [action,...rest]=positionals;
  if(values['split-channels']&&!['render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--split-channels applies only to stem batch exports');
  if(values.mixdown&&!['render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--mixdown applies only to stem batch exports');
  if(values['cycle-marker-id']&&!['render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--cycle-marker-id applies only to stem exports');
  if(values['cycle-marker-id']&&(values.locators||values['start-tick']!==undefined||values.duration!==undefined))throw new Error('--cycle-marker-id cannot combine with Locator/start/duration');
  if(values['file-format']!==undefined&&!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--file-format applies only to render exports');
  if(values['export-preset']!==undefined&&!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--export-preset applies only to render exports');
  if((values.dither!==undefined||values['dither-seed']!==undefined)&&!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('Dither options apply only to render exports');
  if(values.placement!==undefined&&action!=='import-many')throw new Error('--placement applies only to import-many');
  if(values['at-sample']!==undefined&&!['import','import-many'].includes(action))throw new Error('--at-sample applies only to audio import');
  if(values['output-sample-rate']!==undefined&&!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--output-sample-rate applies only to render exports');
  if(values['track-id']&&!['export-musicxml','export-midi','import','import-many','render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--track-id applies to imports, renders, or export-midi');
  if(values['channel-mode']!==undefined&&(!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action)||!['mono','stereo','left','right'].includes(values['channel-mode'])))throw new Error('--channel-mode requires render/offline-render and stereo, mono, left or right');
  if(values['no-effect-tail']&&!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--no-effect-tail applies only to audio render');
  if(values['sample-format']!==undefined&&(!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action)||!['pcm16','pcm24','float32'].includes(values['sample-format'])))throw new Error('--sample-format requires render/offline-render and pcm16, pcm24 or float32');
  if(values.locators&&(!['export-midi','render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action)||values['start-tick']!==undefined||values.duration!==undefined))throw new Error('--locators requires render/offline-render and cannot combine with --start-tick or --duration');
  if(values['start-tick']!==undefined&&!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir','native-play'].includes(action))throw new Error('--start-tick only applies to render, offline-render or native-play');
  if(values['timing-options']!==undefined&&!['offline-render','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--timing-options applies only to offline-render; server render uses timing-settings');
  if(values['chase-options']!==undefined&&!['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action))throw new Error('--chase-options only applies to render or offline-render');
  if(values.help||!action){console.log(HELP);return;}
  if(action==='guide'){if(rest.length>1)throw new Error('Usage: guide [TOPIC|all]');const {renderGuide}=await import('./cli-guide.mjs');console.log(renderGuide(rest[0]));return;}
  if(values['dry-run']&&!['command','batch','collect','recover','recover-backup','backup-settings','restore-asset','media-accept','remove-missing','save','save-new-version','save-as','revert','restore-revert-media','open','recent-remove','recent-clear','project-open','project-activate','project-close','project-new','project-recover','project-location-settings','controller-settings','chase-settings','reset-settings','timing-settings','split-settings','stretch-audio-batch','restore-audio-processing','stretch-audio','split-zero','tap-tempo','resize-midi-parts','trim-clips','slip-clips','copy-clips','paste-clips','note-time','display-command','time-command','native-settings'].includes(action))throw new Error('This action does not support --dry-run; no action was performed');
  if(values.media!==undefined&&action!=='revert')throw new Error('--media is only supported for revert');
  if(values.confirm&&!['revert','recent-clear'].includes(action))throw new Error('--confirm is only supported for revert or recent-clear');
  if(values.current!==undefined&&!['open','project-open','project-activate','project-close','project-new','project-recover'].includes(action))throw new Error('--current is only supported for open/activate/close apply actions');
  if(values.inactive&&!['project-open-plan','project-open-recent-plan','project-new-plan','project-recover-plan'].includes(action))throw new Error('--inactive is only supported for workspace open plans');
  if(values['workspace-revision']!==undefined&&!['project-open-plan','project-open-recent-plan','project-open','project-activate-plan','project-activate','project-close-plan','project-close','project-new-plan','project-new','project-recover-plan','project-recover','project-location-settings','recent-remove','recent-clear'].includes(action))throw new Error('--workspace-revision is only supported for workspace actions');
  if(values['location-revision']!==undefined&&!['project-new-plan','project-location-settings'].includes(action))throw new Error('--location-revision is only supported for creation plans and location settings');
  if((values['folder-name']!==undefined||values['chosen-folder']!==undefined)&&action!=='project-new-plan')throw new Error('--folder-name and --chosen-folder are only supported for project-new-plan');
  if(values['midi-single-part']&&values['midi-auto-dissolve'])throw new Error('Choose --midi-single-part or --midi-auto-dissolve, not both.');
  if(values['midi-position']!==undefined&&(!['import','import-many'].includes(action)||!['start','left-locator'].includes(values['midi-position'])))throw new Error('--midi-position start|left-locator requires import/import-many');
  if((values['midi-single-part']||values['midi-auto-dissolve']||values['midi-extract-patch']||values['midi-extract-volume-pan'])&&!['import','import-many'].includes(action))throw new Error('MIDI Inspector extraction requires import/import-many');
  if(values['midi-tempo']!==undefined&&(!['import','import-many'].includes(action)||!['auto','preserve','replace'].includes(values['midi-tempo'])))throw new Error('--midi-tempo auto|preserve|replace requires import/import-many');
  if(values['midi-signature']!==undefined&&(!['import','import-many'].includes(action)||!['preserve','initial'].includes(values['midi-signature'])))throw new Error('--midi-signature preserve|initial requires import/import-many');
  if(values['midi-no-markers']&&!['import','import-many','export-midi'].includes(action))throw new Error('--midi-no-markers requires MIDI import/export');
  if(action!=='export-midi'&&['midi-no-patch','midi-no-volume-pan','midi-no-modifiers','midi-no-delay'].some(key=>values[key]))throw new Error('MIDI export option flags require export-midi');
  if(values['midi-no-chase']&&(action!=='export-midi'||!values.locators))throw new Error('--midi-no-chase requires export-midi --locators');
  if(values['midi-ppq']!==undefined&&(action!=='export-midi'||!/^\d+$/.test(values['midi-ppq'])||Number(values['midi-ppq'])<24||Number(values['midi-ppq'])>960))throw new Error('--midi-ppq requires export-midi and an integer 24..960');
  if(values['key-fifths']!==undefined&&(action!=='export-musicxml'||!/^-?\d$/.test(values['key-fifths'])||Math.abs(Number(values['key-fifths']))>7))throw new Error('--key-fifths requires export-musicxml and an integer -7..7');
  if(values['midi-format']!==undefined&&(action!=='export-midi'||!['0','1'].includes(values['midi-format'])))throw new Error('--midi-format 0|1 is only supported for export-midi');
  if(values.cursor!==undefined&&action!=='project-folders')throw new Error('--cursor is only supported for project-folders');
  if(values['sample-rate']!==undefined&&action!=='project-new-plan')throw new Error('--sample-rate is only supported for project-new-plan');
  if(values['save-output']!==undefined&&!['project-open','project-activate','project-close','project-new','project-recover'].includes(action))throw new Error('--save-output is only supported for workspace apply actions');
  if(values['recent-store']!==undefined&&action!=='serve')throw new Error('--recent-store is only supported for serve');
  if(values['allow-replacement']&&action!=='media-accept')throw new Error('--allow-replacement is only supported for media-accept');
  if(values.force&&['media-search','media-plan','media-accept','remove-missing'].includes(action))throw new Error('Media resolution does not support --force; review a plan and use --allow-replacement only for changed content');
  if(action==='collect'||action==='recover'||action==='recover-backup') {
    if(values.force)throw new Error('Collection and recovery never overwrite existing targets; --force is not supported');
    if(args.some(value=>value==='--url'||value.startsWith('--url=')))throw new Error('collect/recover read a disk snapshot. For a live session, download /api/project/bundle instead');
    if(action==='collect') {
      if(rest.length!==2)throw new Error('Usage: collect INPUT.json DESTINATION_DIR [--dry-run]');
      print(await collectProject(rest[0],rest[1],{dryRun:values['dry-run']??false}));
    } else if(action==='recover-backup') {
      if(rest.length!==2||!values.output)throw new Error('Usage: recover-backup INPUT.json BACKUP_ID --output NEWFILE.json [--dry-run]');
      print(await recoverAutoBackup(rest[0],rest[1],{output:values.output,dryRun:values['dry-run']??false}));
    } else {
      if(rest.length!==1||!values.output)throw new Error('Usage: recover INPUT.json --output NEWFILE.json [--dry-run]');
      print(await recoverProject(rest[0],{output:values.output,dryRun:values['dry-run']??false}));
    }
    return;
  }
  const endpoint=values.url.replace(/\/$/,'');let requestDocumentId=null,initialState=null;
  async function request(route,options={}) {
    let response;
    try{response=await fetch(`${endpoint}${route}`,{...options,...(options.method==='POST'&&requestDocumentId?{headers:{...options.headers,'X-Newdaw-Document':requestDocumentId}}:{})});}catch(e){throw new Error(`Cannot connect to ${endpoint}. Start npm start first. ${e.cause?.message??e.message}`);}
    const type=response.headers.get('content-type')??'';
    if(!response.ok){const error=type.includes('json')?await response.json():await response.text();throw Object.assign(new Error(typeof error==='string'?error:JSON.stringify(error)),{status:response.status});}
    return response;
  }
  const query=async route=>(await request(route)).json();
  const post=async(route,data)=>(await request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
  const revision=async()=>{const state=initialState??await query('/api/state');if(!state.project)throw new Error('NO_ACTIVE_DOCUMENT: Open or activate a project first.');const r=values.revision===undefined?state.project.revision:Number(values.revision);if(!Number.isSafeInteger(r)||r<0)throw new Error('--revision must be a nonnegative integer');return r;};
  if(action==='serve'){
    const port=values.port===undefined?4317:Number(values.port);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
    const session=await startServer({port,...(values.project?{projectPath:values.project}:{}),...(values['recent-store']?{recentPath:values['recent-store']}:{})});
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;await session.close();};
    process.once('SIGINT',()=>{stop().then(()=>process.exit(0));});process.once('SIGTERM',()=>{stop().then(()=>process.exit(0));});return session;
  }
  if(action==='init'){
    if(!rest[0])throw new Error('Provide a project filename');const filename=path.resolve(rest[0]);await ensureOutput(filename,false);
    const project=values.demo?await createDemoProject(path.dirname(filename)):createProject({name:path.basename(filename,'.newdaw.json'),fixedTempo:true});await atomicWrite(filename,JSON.stringify(project,null,2)+'\n',{noClobber:true});print({created:filename,projectId:project.id,revision:project.revision});return;
  }
  if(!['offline-render','offline-render-stems','offline-render-stems-dir'].includes(action)){initialState=await query('/api/state');requestDocumentId=initialState.session?.document?.id??null;}
  if(action==='audition'){
    if(rest.length!==2)throw new Error('Usage: audition OUTPUT.wav JSON [--duration 0.05..2] [--revision N] [--force]');
    if(values.tail!==undefined)throw new Error('Audition does not support --tail');
    const output=path.resolve(rest[0]),input=JSON.parse(rest[1]);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['clipId','field','updates'].includes(k)))throw new Error('Audition JSON accepts clipId, field and updates only');
    if(path.extname(output).toLowerCase()!=='.wav')throw new Error('Audition output must use a .wav filename');
    await ensureOutput(output,values.force);
    const expectedRevision=await revision(),response=await request('/api/midi/audition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,expectedRevision,...(values.duration!==undefined?{durationSeconds:Number(values.duration)}:{})})});
    if(response.headers.get('content-type')?.includes('application/json')){const result=await response.json();if(result.silent!==true)throw new Error('Unexpected audition response');print({...result,output:null,written:false});return;}
    if(response.headers.get('content-type')!=='audio/wav'||Number(response.headers.get('X-NewDAW-Revision'))!==expectedRevision)throw new Error('Unexpected audition audio or revision');
    await atomicWrite(output,new Uint8Array(await response.arrayBuffer()),{noClobber:!values.force});
    print({output,written:true,revision:expectedRevision,engine:response.headers.get('X-NewDAW-Audition'),warnings:['Built-in oscillator preview; original plugin instruments and release-velocity timbre are not rendered.']});return;
  }
  if(action==='remove-dc'){if(rest.length!==1||values.force)throw new Error('Usage: remove-dc CLIP_ID [--dry-run]');print(await post('/api/audio/remove-dc',{clipId:rest[0],expectedRevision:await revision(),dryRun:values['dry-run']??false}));return;}
  if(action==='commit-midi-take'){if(rest.length!==1||values.force)throw new Error('Usage: commit-midi-take FILE.json [--dry-run]');const argumentsValue=JSON.parse(await fs.readFile(path.resolve(rest[0]),'utf8'));print(await post('/api/command',{command:'midi.record.take',arguments:argumentsValue,expectedRevision:await revision(),dryRun:values['dry-run']??false}));return;}
  if(action==='stretch-audio-batch'){
    if(rest.length!==1||values.force)throw new Error('Usage: stretch-audio-batch JSON_ARRAY [--dry-run]');if(!initialState.capabilities.audioTimeStretchBatch)throw new Error('Batch time stretch requires a refreshed server');const clips=JSON.parse(rest[0]);if(!Array.isArray(clips))throw new Error('Provide an array of clip plans');print(await post('/api/audio/time-stretch-batch',{clips,expectedRevision:await revision(),dryRun:values['dry-run']??false}));return;
  }
  if(action==='stretch-audio'){
    if(rest.length!==2||values.force)throw new Error('Usage: stretch-audio CLIP_ID JSON {targetFrames,startSample?} [--dry-run]');if(!initialState.capabilities.audioTimeStretchProcessing)throw new Error('Time stretch requires a refreshed server');const options=JSON.parse(rest[1]);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['targetFrames','startSample'].includes(k)))throw new Error('Use targetFrames and optional startSample');print(await post('/api/audio/time-stretch',{...options,clipId:rest[0],expectedRevision:await revision(),dryRun:values['dry-run']??false}));return;
  }
  if(action==='restore-audio-processing'){if(rest.length!==1||values.force)throw new Error('Usage: restore-audio-processing CLIP_ID [--dry-run]');print(await post('/api/audio/restore-processing',{clipId:rest[0],expectedRevision:await revision(),dryRun:values['dry-run']??false}));return;}
  if(action==='audio-processing'){if(rest.length!==1||values.force)throw new Error('Usage: audio-processing CLIP_ID');print(await post('/api/audio/processing',{clipId:rest[0],expectedRevision:await revision()}));return;}
  if(action==='split-zero'){
    if(rest.length!==1||values.force)throw new Error('Usage: split-zero JSON {atTick|ticks,clipIds?} [--dry-run]');const options=JSON.parse(rest[0]);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['atTick','ticks','clipIds','range','intervalTicks'].includes(k))||Number(options.atTick!==undefined)+Number(options.ticks!==undefined)+Number(options.intervalTicks!==undefined)!==1||options.range!==undefined&&options.intervalTicks===undefined)throw new Error('Choose atTick, ticks or intervalTicks (with optional range), plus optional clipIds');const expectedRevision=await revision();if(expectedRevision!==initialState.project.revision)throw new Error('Split revision does not match project snapshot');const resolve=(clip,atSample)=>post('/api/audio/zero-crossing',{clipId:clip.id,atSample,expectedRevision});let plan;if(options.intervalTicks!==undefined){options.ticks=repeatedSplitTicks(options.range??initialState.project.locators,options.intervalTicks);}if(options.ticks!==undefined){if(!initialState.capabilities.explicitSplitClipIds)throw new Error('Multi-boundary split requires a refreshed server');plan=await planZeroCrossingBoundarySplits(initialState.project,options,resolve);}else plan=await planZeroCrossingSplits(initialState.project,options,resolve);print({...await post('/api/command',{command:'batch',arguments:{commands:plan.commands},expectedRevision,dryRun:values['dry-run']??false}),zeroCrossings:plan.zeroCrossings});return;
  }
  if(action==='zero-crossing'){if(rest.length!==2||values.force)throw new Error('Usage: zero-crossing CLIP_ID AT_SAMPLE');const atSample=Number(rest[1]);if(!Number.isSafeInteger(atSample)||atSample<0)throw new Error('AT_SAMPLE must be a nonnegative safe integer');print(await post('/api/audio/zero-crossing',{clipId:rest[0],atSample,expectedRevision:await revision()}));return;}
  if(action==='audio-statistics'){if(rest.length<1||rest.length>2||values.force||values['dry-run'])throw new Error('Usage: audio-statistics CLIP_ID [raw|event]');print(await post('/api/audio/statistics',{clipId:rest[0],expectedRevision:await revision(),mode:rest[1]??'event'}));return;}
  if(action==='normalize-audio'){if(rest.length<1||rest.length>2||values.force)throw new Error('Usage: normalize-audio CLIP_ID [DBFS]');print(await post('/api/audio/normalize',{clipId:rest[0],expectedRevision:await revision(),targetDb:rest[1]===undefined?-1:Number(rest[1])}));return;}
  if(action==='split-settings'){
    if(rest.length>1||values.force||(!rest.length&&values['dry-run']))throw new Error('Usage: split-settings [JSON] [--dry-run]');
    if(!rest.length)print(await query('/api/workspace/split-settings'));else print(await post('/api/workspace/split-settings',{...JSON.parse(rest[0]),...(values['dry-run']?{dryRun:true}:{})}));return;
  }
  if(action==='status'){print(initialState);return;}
  if(action==='copy-clips'){
    if(rest.length!==2)throw new Error('Usage: copy-clips OUTPUT.newdaw-clips.json SELECTION_JSON');
    const output=path.resolve(rest[0]);if(!output.endsWith('.newdaw-clips.json'))throw new Error('Clipboard output must end with .newdaw-clips.json');
    const activePath=initialState.session?.document?.projectPath;if(activePath&&output===path.resolve(activePath))throw new Error('Clipboard output cannot replace the active project');
    if(await revision()!==initialState.project.revision)throw new Error('Clipboard revision does not match the selected project snapshot');
    const selection=JSON.parse(rest[1]);if(!selection||typeof selection!=='object'||Array.isArray(selection))throw new Error('Selection must be an object');
    const selected=new Set(selectProjectClips(initialState.project,selection)),clips=initialState.project.clips.filter(c=>selected.has(c.id));if(!clips.length)throw new Error('Selection contains no clips');
    if(clips.length>4096||clips.reduce((sum,c)=>sum+(c.notes?.length??0),0)>200000)throw new Error('Clipboard exceeds4096 clips or200000 notes');
    const payload={format:'newdaw-clip-clipboard',version:1,sourceProjectId:initialState.project.id,sourceRevision:initialState.project.revision,clips,sourceTracks:initialState.project.tracks.filter(t=>clips.some(c=>c.trackId===t.id))},bytes=JSON.stringify(payload,null,2)+'\n';if(Buffer.byteLength(bytes)>64*1024*1024)throw new Error('Clipboard exceeds64 MiB');await ensureOutput(output,values.force);if(!values['dry-run'])await atomicWrite(output,bytes,{noClobber:!values.force});print({output,revision:payload.sourceRevision,clips:clips.length,media:'references-only',projectUnchanged:true,dryRun:values['dry-run']??false});return;
  }
  if(action==='paste-clips'){
    if(rest.length!==2)throw new Error('Usage: paste-clips INPUT.newdaw-clips.json OPTIONS_JSON');if(!initialState.capabilities.clipSnapshotPaste)throw new Error('Clip paste requires a refreshed server');
    const filename=path.resolve(rest[0]),stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw new Error('Clipboard must be a regular file up to64 MiB');
    const bytes=await fs.readFile(filename);if(bytes.length>64*1024*1024)throw new Error('Clipboard exceeds64 MiB');const payload=parseClipClipboard(bytes.toString('utf8')),options=JSON.parse(rest[1]);
    if(payload?.format!=='newdaw-clip-clipboard'||payload.version!==1)throw new Error('Unsupported clipboard format');if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['atTick','atSample','original','alignSnapPoint','trackMode','createMissingTracks'].includes(k)))throw new Error('Invalid paste options');
    print(await post('/api/command',{command:'clips.paste',arguments:{sourceProjectId:payload.sourceProjectId,clips:payload.clips,sourceTracks:payload.sourceTracks,...options},expectedRevision:await revision(),dryRun:values['dry-run']??false}));return;
  }
  if(action==='markers'){if(rest.length>1||values.force)throw new Error('Usage: markers [{sortBy,direction}]');const options=rest.length?JSON.parse(rest[0]):{};print({revision:initialState.project.revision,markers:sortProjectMarkers(initialState.project.markers??[],options),projectUnchanged:true});return;}
  if(action==='tap-tempo'){
    if(rest.length!==1||values.force)throw new Error('Usage: tap-tempo JSON [--dry-run]');const options=JSON.parse(rest[0]);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['tapTimesMs','mode','cursorTick','selectionStartTick','lastPlaybackStartTick','playing','tempoTrackEnabled'].includes(k)))throw new Error('Invalid tap tempo options');
    const expectedRevision=await revision();if(expectedRevision!==initialState.project.revision)throw new Error('Tap revision does not match selected snapshot');const plan=planTapTempo(initialState.project,options);
    if(!plan.commands.length){print({status:'unchanged',revision:expectedRevision,plan,dryRun:values['dry-run']??false});return;}
    const result=await post('/api/command',{...plan.commands[0],expectedRevision,dryRun:values['dry-run']??false});print({...result,plan});return;
  }
  if(action==='resize-midi-parts'){
    if(rest.length!==1||values.force)throw new Error('Usage: resize-midi-parts JSON {clipIds,deltaTicks} [--dry-run]');
    const options=JSON.parse(rest[0]);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['clipIds','deltaTicks','edge'].includes(k)))throw new Error('Resize requires only clipIds and deltaTicks');
    const expectedRevision=await revision();if(expectedRevision!==initialState.project.revision)throw new Error('Resize revision does not match the selected project snapshot');
    if(options.edge!==undefined&&!['left','right'].includes(options.edge))throw new Error('edge must be left or right');
    if(options.edge==='left'&&!initialState.capabilities.midiPartStartResize)throw new Error('MIDI start resize requires a refreshed server');
    const commands=(options.edge==='left'?planMidiPartStartResize:planMidiPartEndResize)(initialState.project,options.clipIds,options.deltaTicks);
    if(!commands.length){print({status:'unchanged',revision:expectedRevision,dryRun:values['dry-run']??false});return;}
    print(await post('/api/command',{command:'batch',arguments:{commands},expectedRevision,dryRun:values['dry-run']??false}));return;
  }
  if(action==='trim-clips'){
    if(rest.length!==1||values.force)throw new Error('Usage: trim-clips JSON {clipIds,edge,seconds} [--dry-run]');
    if(!initialState.capabilities.audioTrim)throw new Error('Audio trim requires a refreshed server');
    const options=JSON.parse(rest[0]);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['clipIds','edge','seconds','mode','zeroCrossing'].includes(k)))throw new Error('Trim requires clipIds, edge, seconds and optional mode/zeroCrossing');if(options.zeroCrossing!==undefined&&typeof options.zeroCrossing!=='boolean')throw new Error('zeroCrossing must be boolean');
    const expectedRevision=await revision();if(expectedRevision!==initialState.project.revision)throw new Error('Trim revision does not match the selected project snapshot');
    if(options.mode==='moveContents'&&!initialState.capabilities.audioResizeMovesContents)throw new Error('Contents resize requires a refreshed server');if(options.mode==='moveContents'&&options.zeroCrossing)throw new Error('Zero Crossing refinement currently applies to normal resize only');
    const plan=planAudioTrim(initialState.project,options.clipIds,options.edge,options.seconds,{mode:options.mode??'normal'});
    if(options.zeroCrossing){if(!initialState.capabilities.audioZeroCrossingTrim)throw new Error('Zero crossing trim requires a refreshed server');plan.commands=await refineZeroCrossingTrims(initialState.project,plan.commands,(clip,atSample,edge)=>post('/api/audio/zero-crossing',{clipId:clip.id,atSample,edge,expectedRevision}));plan.zeroCrossing=true;}
    if(!plan.commands.length){print({status:'unchanged',revision:expectedRevision,plan,dryRun:values['dry-run']??false});return;}
    const result=await post('/api/command',{command:'batch',arguments:{commands:plan.commands},expectedRevision,dryRun:values['dry-run']??false});print({...result,plan});return;
  }
  if(action==='slip-clips'){
    if(rest.length!==1||values.force)throw new Error('Usage: slip-clips JSON {clipIds,seconds} [--dry-run]');
    if(!initialState.capabilities.audioSlip)throw new Error('Source slip requires a refreshed server');
    const options=JSON.parse(rest[0]);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['clipIds','seconds'].includes(k)))throw new Error('Slip requires only clipIds and seconds');
    const expectedRevision=await revision();if(expectedRevision!==initialState.project.revision)throw new Error('Slip revision does not match the selected project snapshot');
    const plan=planAudioSlip(initialState.project,options.clipIds,options.seconds);
    if(!plan.commands.length){print({status:'unchanged',revision:expectedRevision,plan,dryRun:values['dry-run']??false});return;}
    const result=await post('/api/command',{command:'batch',arguments:{commands:plan.commands},expectedRevision,dryRun:values['dry-run']??false});print({...result,plan});return;
  }
  if(action==='select-clips'){if(rest.length!==1)throw new Error('select-clips requires one JSON options object');const options=JSON.parse(rest[0]);if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('Selection options must be an object');print({revision:initialState.project.revision,clipIds:selectProjectClips(initialState.project,options)});return;}
  if(action==='recent'){if(rest.length)throw new Error('recent takes no positional arguments');print(await query('/api/document/recent'));return;}
  if(action==='drafts'){if(rest.length)throw new Error('drafts takes no positional arguments');print(await query('/api/workspace/drafts'));return;}
  if(action==='projects'){if(rest.length)throw new Error('projects takes no positional arguments');print(await query('/api/workspace'));return;}
  const workspaceGuard=()=>{const revision=values['workspace-revision']===undefined?initialState.workspace?.revision:Number(values['workspace-revision']);if(!Number.isSafeInteger(revision)||revision<0)throw new Error('A valid workspace revision is required');return {expectedWorkspaceRevision:revision};};
  if(['native-ports','native-status','native-settings','native-play','native-stop','midi-reset'].includes(action)){
    if(values.force)throw new Error('Native MIDI actions do not support --force');
    if(action==='native-ports'||action==='native-status'){
      if(rest.length)throw new Error(`${action} takes no positional arguments`);
      print(await query(action==='native-ports'?'/api/native/ports':'/api/native/transport'));
    }else if(action==='native-settings'){
      if(rest.length>1||(!rest.length&&values['dry-run']))throw new Error('Usage: native-settings [JSON] [--dry-run]');
      if(!rest.length)print(await query('/api/native/settings'));
      else{const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Native settings must be an object');print(await post('/api/native/settings',{projectId:initialState.project?.id,expectedProjectRevision:await revision(),...input,...(values['dry-run']?{dryRun:true}:{})}));}
    }else if(action==='native-play'||action==='midi-reset'){
      if(rest.length)throw new Error('Usage: native-play [--start-tick N]');
      const startTick=values['start-tick']===undefined?0:Number(values['start-tick']);if(!Number.isSafeInteger(startTick)||startTick<0)throw new Error('--start-tick must be a nonnegative integer');
      const [profile,chase,reset,timing]=await Promise.all([query('/api/native/settings'),query('/api/workspace/chase-settings'),query('/api/workspace/reset-settings'),query('/api/workspace/timing-settings')]);
      print(await post(action==='midi-reset'?'/api/native/reset':'/api/native/play',{expectedRevision:await revision(),expectedSettingsRevision:profile.settings.revision,expectedSettingsFingerprint:profile.fingerprint,expectedChaseRevision:chase.settings.revision,expectedChaseFingerprint:chase.fingerprint,expectedResetRevision:reset.settings.revision,expectedResetFingerprint:reset.fingerprint,expectedTimingRevision:timing.settings.revision,expectedTimingFingerprint:timing.fingerprint,...(action==='native-play'?{startTick}:{})}));
    }else{
      if(rest.length>1)throw new Error('Usage: native-stop [JOB_ID]');
      const jobId=rest[0]??(await query('/api/native/transport')).jobId;if(!jobId)throw new Error('No native MIDI job exists to stop');
      print(await post('/api/native/stop',{jobId}));
    }return;
  }
  if(action==='time-command'){
    if(rest.length<3||rest.length>4||values.force)throw new Error('Usage: time-command COMMAND ARGUMENTS_JSON FORMATTED_TIMES_JSON [TIME_OPTIONS_JSON] [--dry-run]');
    const args=JSON.parse(rest[1]),formattedTimes=JSON.parse(rest[2]),timeOptions=rest[3]===undefined?{}:JSON.parse(rest[3]),p=await query('/api/workspace/timing-settings');
    print(await post('/api/time/command',{command:rest[0],arguments:args,formattedTimes,timeOptions,expectedRevision:await revision(),expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...(values['dry-run']?{dryRun:true}:{})}));return;
  }
  if(action==='display-command'){
    if(rest.length!==3||values.force)throw new Error('Usage: display-command COMMAND ARGUMENTS_JSON DISPLAY_TIMES_JSON [--dry-run]');const args=JSON.parse(rest[1]),displayTimes=JSON.parse(rest[2]);const p=await query('/api/workspace/timing-settings');print(await post('/api/midi/time/command',{command:rest[0],arguments:args,displayTimes,expectedRevision:await revision(),expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...(values['dry-run']?{dryRun:true}:{})}));return;
  }
  if(action==='time-snap'){
    if(rest.length!==1||values.force||values['dry-run'])throw new Error('Usage: time-snap JSON');const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['localTick','scope','clipId','rounding','cell'].includes(k)))throw new Error('Use localTick and optional scope/clipId/rounding/cell');const p=await query('/api/workspace/timing-settings');print(await post('/api/time/snap',{expectedRevision:await revision(),expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...input}));return;
  }
  if(action==='time-ruler'){
    if(rest.length!==1||values.force||values['dry-run'])throw new Error('Usage: time-ruler JSON');const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['fromPixel','toPixel','scope','originTick','zoom','minSpacing','maxLines'].includes(k)))throw new Error('Use fromPixel/toPixel and optional scope/originTick/zoom/minSpacing/maxLines');const p=await query('/api/workspace/timing-settings');print(await post('/api/time/ruler',{expectedRevision:await revision(),expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...input}));return;
  }
  if(action==='time-display'){
    if(rest.length!==1||values.force)throw new Error('Usage: time-display JSON');const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['tick','endTick','sample','scope','originTick'].includes(k)))throw new Error('Use tick/endTick/originTick or sample, and optional scope');const p=await query('/api/workspace/timing-settings');print(await post('/api/time/display',{expectedRevision:await revision(),expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...input}));return;
  }
  if(action==='time-convert'){
    if(rest.length!==1||values.force)throw new Error('Usage: time-convert JSON');const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['tick','position','duration'].includes(k))||Object.keys(input).length!==1)throw new Error('Use exactly one tick, position or duration');const p=await query('/api/workspace/timing-settings');print(await post('/api/midi/time/convert',{expectedRevision:await revision(),expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...input}));return;
  }
  if(action==='note-time'){
    if(rest.length!==3||values.force)throw new Error('Usage: note-time CLIP_ID NOTE_ID JSON [--dry-run]');const input=JSON.parse(rest[2]);if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.keys(input).some(k=>!['startDisplayTick','durationDisplayTicks','startMusicalPosition','musicalDuration'].includes(k)))throw new Error('Note time JSON accepts startDisplayTick/durationDisplayTicks or startMusicalPosition/musicalDuration');const p=await query('/api/workspace/timing-settings');print(await post('/api/midi/timing/note',{clipId:rest[0],noteId:rest[1],expectedRevision:await revision(),expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...input,...(values['dry-run']?{dryRun:true}:{})}));return;
  }
  if(action==='timing-settings'){if(rest.length>1||values.force||(!rest.length&&values['dry-run']))throw new Error('Usage: timing-settings [JSON] [--dry-run]');if(!rest.length)print(await query('/api/workspace/timing-settings'));else{const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Timing settings must be an object');print(await post('/api/workspace/timing-settings',{...input,...(values['dry-run']?{dryRun:true}:{})}));}return;}
  if(action==='reset-settings'){if(rest.length>1||values.force||(!rest.length&&values['dry-run']))throw new Error('Usage: reset-settings [JSON] [--dry-run]');if(!rest.length)print(await query('/api/workspace/reset-settings'));else{const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Reset settings must be an object');print(await post('/api/workspace/reset-settings',{...input,...(values['dry-run']?{dryRun:true}:{})}));}return;}
  if(action==='chase-settings'){if(rest.length>1||values.force||(!rest.length&&values['dry-run']))throw new Error('Usage: chase-settings [JSON] [--dry-run]');if(!rest.length)print(await query('/api/workspace/chase-settings'));else{const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Chase settings must be an object');print(await post('/api/workspace/chase-settings',{...input,...(values['dry-run']?{dryRun:true}:{})}));}return;}
  if(action==='controller-settings'){if(rest.length>1||values.force||(!rest.length&&values['dry-run']))throw new Error('Usage: controller-settings [JSON] [--dry-run]');if(!rest.length)print(await query('/api/workspace/controller-settings'));else{const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Controller settings must be an object');print(await post('/api/workspace/controller-settings',{...input,...(values['dry-run']?{dryRun:true}:{})}));}return;}
  if(action==='project-locations'){if(rest.length)throw new Error('project-locations takes no arguments');print(await query('/api/workspace/locations'));return;}
  if(action==='project-folders'){if(rest.length>1)throw new Error('Usage: project-folders [PATH] [--cursor N]');const params=new URLSearchParams();if(rest.length)params.set('path',path.resolve(rest[0]));if(values.cursor!==undefined){if(!/^(0|[1-9]\d*)$/.test(values.cursor))throw new Error('--cursor must be a nonnegative integer');params.set('cursor',values.cursor);}print(await query('/api/workspace/folders'+(params.size?'?'+params:'')));return;}
  const locationRevision=async()=>{const current=await query('/api/workspace/locations');if(!current.settings)throw new Error('Location settings are unavailable: '+JSON.stringify(current.warnings));const revision=values['location-revision']===undefined?current.settings.revision:Number(values['location-revision']);if(!Number.isSafeInteger(revision)||revision<0)throw new Error('--location-revision must be a nonnegative integer');return revision;};
  if(action==='project-location-settings'){if(rest.length!==1||values.force)throw new Error('Usage: project-location-settings JSON [--dry-run]');const input=JSON.parse(rest[0]);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['locationMode','defaultLocation'].includes(key)))throw new Error('Location JSON accepts locationMode and defaultLocation only');print(await post('/api/workspace/locations',{...input,...workspaceGuard(),expectedRevision:await locationRevision(),dryRun:values['dry-run']??false}));return;}
  if(['project-open-plan','project-open-recent-plan','project-open','project-activate-plan','project-activate','project-close-plan','project-close','project-new-plan','project-new','project-recover-plan','project-recover'].includes(action)){
    if(values.force)throw new Error('Workspace changes do not support --force');
    if(action==='project-new-plan'?rest.length>1:rest.length!==1)throw new Error(`Usage: ${action} ${action.endsWith('-plan')?'PATH_OR_DOCUMENT_ID':'PLAN_ID'}`);
    const guard=workspaceGuard();
    if(action==='project-open-plan'||action==='project-open-recent-plan')print(await post('/api/workspace/open/plan',{...guard,...(action==='project-open-plan'?{projectPath:path.resolve(rest[0])}:{recentId:rest[0]}),mode:values.inactive?'inactive':'active'}));
    else if(action==='project-new-plan'){
      const sampleRate=values['sample-rate']===undefined?48000:Number(values['sample-rate']);if(!Number.isInteger(sampleRate))throw new Error('--sample-rate must be an integer');
      if(rest.length&&(values['folder-name']!==undefined||values['chosen-folder']!==undefined||values['location-revision']!==undefined))throw new Error('Use a direct folder or profile location options, not both');
      const selection=rest.length?{projectFolder:path.resolve(rest[0])}:{location:{...(values['folder-name']!==undefined?{folderName:values['folder-name']}:{}),...(values['chosen-folder']!==undefined?{chosenFolder:path.resolve(values['chosen-folder'])}:{})},expectedLocationRevision:await locationRevision()};
      print(await post('/api/workspace/new/plan',{...guard,...selection,sampleRate,mode:values.inactive?'inactive':'active'}));
    }
    else if(action==='project-recover-plan')print(await post('/api/workspace/recover/plan',{...guard,draftId:rest[0],mode:values.inactive?'inactive':'active'}));
    else if(action.endsWith('-plan'))print(await post(`/api/workspace/${action.includes('activate')?'activate':'close'}/plan`,{...guard,documentId:rest[0]}));
    else{if(values.current!==undefined&&!['preserve','save'].includes(values.current))throw new Error('--current must be preserve or save');print(await post(`/api/workspace/${action.slice('project-'.length)}`,{...guard,planId:rest[0],...(values.current?{currentPolicy:values.current}:{}),...(values['save-output']?{saveOutputPath:path.resolve(values['save-output'])}:{}),dryRun:values['dry-run']??false}));}
    return;
  }
  if(['recent-remove','recent-clear'].includes(action)&&initialState.workspace){
    if(values.force)throw new Error('Recent lists do not support --force');
    if(action==='recent-clear'?rest.length!==0||!values.confirm:rest.length!==1)throw new Error(action==='recent-clear'?'Usage: recent-clear --confirm':'Usage: recent-remove ENTRY_ID');
    const recent=await query('/api/document/recent');print(await post('/api/workspace/recent/remove',{...workspaceGuard(),expectedRegistryRevision:recent.revision,...(action==='recent-clear'?{clear:true}:{entryId:rest[0]}),dryRun:values['dry-run']??false}));return;
  }

  if(['open-plan','open-recent-plan','open','recent-remove','recent-clear'].includes(action)){
    if(values.force)throw new Error('Opening projects and recent lists do not support --force');
    const guard={expectedRevision:await revision(),expectedDocumentId:requestDocumentId},dryRun=values['dry-run']??false;
    if(action==='open-plan'||action==='open-recent-plan'){
      if(action==='project-new-plan'?rest.length>1:rest.length!==1)throw new Error(`Usage: ${action} ${action==='open-plan'?'PROJECT_PATH':'ENTRY_ID'}`);
      print(await post('/api/document/open/plan',{...guard,...(action==='open-plan'?{projectPath:path.resolve(rest[0])}:{recentId:rest[0]})}));
    }else if(action==='open'){
      if(rest.length!==1||!['preserve','save'].includes(values.current))throw new Error('Usage: open PLAN_ID --current preserve|save [--dry-run]');
      print(await post('/api/document/open',{...guard,planId:rest[0],currentPolicy:values.current,dryRun}));
    }else{
      if(action==='recent-clear'?rest.length!==0||!values.confirm:rest.length!==1)throw new Error(action==='recent-clear'?'Usage: recent-clear --confirm [--dry-run]':'Usage: recent-remove ENTRY_ID [--dry-run]');
      const recent=await query('/api/document/recent');
      print(await post('/api/document/recent/remove',{...guard,expectedRegistryRevision:recent.revision,...(action==='recent-clear'?{clear:true}:{entryId:rest[0]}),dryRun}));
    }return;
  }

  if(action==='document'){print(await query('/api/document'));return;}
  if(action==='revert-trash'){print(await query('/api/document/trash'));return;}
  if(['save','save-new-version','save-as','revert-plan','revert','restore-revert-media'].includes(action)){
    if(values.force)throw new Error('Document save/revert never uses --force; review and confirm a Revert plan');
    const current=await query('/api/state');if(!current.project)throw new Error('NO_ACTIVE_DOCUMENT: Open or activate a project first.');const guard={expectedRevision:values.revision===undefined?current.project.revision:await revision(),expectedDocumentId:current.session.document.id},dryRun=values['dry-run']??false;
    if(action==='save'){if(rest.length)throw new Error('save takes no positional arguments');print(await post('/api/document/save',{...guard,...(values.output?{outputPath:path.resolve(values.output)}:{}),dryRun}));}
    else if(action==='save-new-version'){if(rest.length)throw new Error('save-new-version takes no positional arguments');print(await post('/api/document/save-as',{...guard,mode:'version',dryRun}));}
    else if(action==='save-as'){if(rest.length!==1)throw new Error('Usage: save-as OUTPUT.json [--dry-run]');print(await post('/api/document/save-as',{...guard,mode:'saveAs',outputPath:path.resolve(rest[0]),dryRun}));}
    else if(action==='revert-plan'){if(rest.length)throw new Error('revert-plan takes no positional arguments');print(await post('/api/document/revert/plan',guard));}
    else if(action==='revert'){
      if(rest.length!==1||!values.confirm||!['keep','trash'].includes(values.media))throw new Error('Usage: revert PLAN_ID --confirm --media keep|trash [--dry-run]');
      print(await post('/api/document/revert',{...guard,planId:rest[0],confirm:true,mediaPolicy:values.media,dryRun}));
    }else{if(rest.length!==1)throw new Error('Usage: restore-revert-media OPERATION_ID [--dry-run]');print(await post(`/api/document/trash/${encodeURIComponent(rest[0])}/restore`,{...guard,dryRun}));}
    return;
  }
  if(action==='history'){print(await query('/api/history'));return;}
  if(action==='backups'){print(await query('/api/backups'));return;}
  if(action==='backup-now'){if(values['dry-run'])throw new Error('backup-now creates a snapshot; use backups for read-only status.');print(await post('/api/backups/create',{expectedRevision:await revision(),force:values.force??false}));return;}
  if(action==='backup-settings'){
    if(rest.length!==1)throw new Error('Provide one JSON object with enabled, intervalMinutes and maxCount');
    const current=await query('/api/backups');print(await post('/api/backups/settings',{expectedRevision:values.revision===undefined?current.projectRevision:await revision(),expectedSettingsRevision:current.settings.revision,autoBackup:JSON.parse(rest[0]),dryRun:values['dry-run']??false}));return;
  }
  if(action==='source-archives'){const inventory=await query('/api/assets');print({projectRevision:inventory.projectRevision,sourceArchives:inventory.sourceArchives??[]});return;}
  if(action==='source-archive-download'){
    if(rest.length!==2)throw new Error('Usage: source-archive-download ARCHIVE_ID OUTPUT');
    const archive=initialState.project?.sourceArchives?.find(a=>a.id===rest[0]);if(!archive)throw new Error('Source archive was not found in the active project.');
    const output=path.resolve(rest[1]);await ensureOutput(output,values.force);
    const response=await request(`/api/source-archives/${encodeURIComponent(rest[0])}/file`),bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==archive.bytes||createHash('sha256').update(bytes).digest('hex')!==archive.sha256)throw new Error('Downloaded source does not match the frozen source registration; output preserved.');
    await atomicWrite(output,bytes,{noClobber:!values.force});print({output,archiveId:archive.id,sha256:archive.sha256,bytes:bytes.length});return;
  }
  if(action==='source-archive-restore'){
    if(values.force)throw new Error('Source archive restoration never overwrites a changed file.');
    if(rest.length!==2)throw new Error('Usage: source-archive-restore ARCHIVE_ID SOURCE');
    if((await fs.stat(rest[1])).size>MAX_WAV_FILE_BYTES)throw new Error('Original source exceeds 128 MiB.');
    const response=await request(`/api/source-archives/${encodeURIComponent(rest[0])}/restore?expectedRevision=${await revision()}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await fs.readFile(rest[1])});print(await response.json());return;
  }
  if(action==='assets'){print(await query('/api/assets'));return;}
  if(['media-search','media-plan','media-accept','remove-missing'].includes(action)){
    const state=await query('/api/state'),guard={expectedRevision:values.revision===undefined?state.project.revision:await revision(),expectedMediaRevision:state.mediaRevision};
    if(action==='media-search'||action==='media-plan'){
      if(action==='project-new-plan'?rest.length>1:rest.length!==1)throw new Error(`Usage: ${action} JSON`);
      print(await post(action==='media-search'?'/api/media/search':'/api/media/plan',{...JSON.parse(rest[0]),...guard}));
    }else if(action==='media-accept'){
      if(rest.length!==1)throw new Error('Usage: media-accept PLAN_ID [--allow-replacement] [--dry-run]');
      print(await post('/api/media/accept',{...guard,planId:rest[0],allowReplacement:values['allow-replacement']??false,dryRun:values['dry-run']??false}));
    }else{
      if(rest.length)throw new Error('remove-missing takes no positional arguments');
      const inventory=await query('/api/assets');print(await post('/api/media/remove-missing',{...guard,expectedAssetIds:inventory.assets.filter(a=>a.status==='missing').map(a=>a.id),dryRun:values['dry-run']??false}));
    }return;
  }
  if(action==='media-search-status'||action==='media-search-stop'){
    if(action==='project-new-plan'?rest.length>1:rest.length!==1)throw new Error(`Usage: ${action} SEARCH_ID`);
    print(action==='media-search-status'?await query(`/api/media/search/${encodeURIComponent(rest[0])}`):await post(`/api/media/search/${encodeURIComponent(rest[0])}/stop`,{}));return;
  }
  if(action==='restore-asset') {
    if(rest.length!==2)throw new Error('Usage: restore-asset ASSET_ID SOURCE.wav [--dry-run]');
    if(values.force)throw new Error('restore-asset uses exact hashes and preserves damaged files; --force is not supported');
    const source=rest[1],stat=await fs.lstat(source);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Restore source must be a regular WAV file, not a symbolic link');
    if(stat.size>MAX_WAV_FILE_BYTES)throw new Error('Restore source exceeds 128 MiB');
    const bytes=await fs.readFile(source);
    if(bytes.length>MAX_WAV_FILE_BYTES)throw new Error('Restore source exceeds 128 MiB');
    const response=await request(`/api/assets/${encodeURIComponent(rest[0])}/restore?expectedRevision=${await revision()}&dryRun=${values['dry-run']??false}`,
      {method:'POST',headers:{'Content-Type':'audio/wav'},body:bytes});
    print(await response.json());return;
  }
  if(action==='commands'){print(await query('/api/commands'));return;}
  if(action==='command'||action==='batch'){
    let command,argumentsValue;
    if(action==='command'){command=rest[0];if(!command)throw new Error('Provide a command name');argumentsValue=JSON.parse(rest[1]??'{}');}
    else{if(!rest[0])throw new Error('Provide a JSON file containing a command array');command='batch';argumentsValue={commands:JSON.parse(await fs.readFile(rest[0],'utf8'))};}
    print(await post('/api/command',{command,arguments:argumentsValue,expectedRevision:await revision(),dryRun:values['dry-run']??false}));return;
  }
  const midiImportOptionsRequested=values['midi-single-part']||values['midi-position']!==undefined||values['midi-auto-dissolve']||values['midi-extract-patch']||values['midi-extract-volume-pan']||values['midi-tempo']!==undefined||values['midi-signature']!==undefined||values['midi-no-markers'];
  const appendMidiImportOptions=(params,kind)=>{if(kind!=='midi'){if(action==='import'&&midiImportOptionsRequested)throw new Error('MIDI timing options require a MIDI file.');return;}if(midiImportOptionsRequested&&!initialState.capabilities.midiImportTimingOptions)throw new Error('MIDI import timing options require a refreshed server.');if(values['midi-single-part']){if(!initialState.capabilities.midiImportSinglePart)throw new Error('Single-part MIDI import requires a refreshed server.');params.set('midiSinglePart','1');}if(values['midi-position']!==undefined){if(!initialState.capabilities.midiImportLeftLocator)throw new Error('Locator MIDI import requires a refreshed server.');params.set('midiPosition',values['midi-position']==='left-locator'?'leftLocator':'start');}if(values['midi-auto-dissolve']){if(!initialState.capabilities.midiImportAutoDissolve)throw new Error('Format-0 auto dissolve requires a refreshed server.');params.set('midiAutoDissolve','1');}if(values['midi-extract-patch']||values['midi-extract-volume-pan']){if(!initialState.capabilities.midiImportInspectorOptions)throw new Error('MIDI Inspector extraction requires a refreshed server.');params.set('midiExtractPatch',values['midi-extract-patch']?'1':'0');params.set('midiExtractVolumePan',values['midi-extract-volume-pan']?'1':'0');}if(initialState.capabilities.midiImportTimingOptions){params.set('midiTempo',values['midi-tempo']??'auto');params.set('midiSignature',values['midi-signature']??'preserve');params.set('midiMarkers',values['midi-no-markers']?'0':'1');}};
  if(action==='import-many'){
    if(rest.length<1||rest.length>32)throw new Error('Provide 1..32 WAV/AIFF/MIDI files.');
    const placement=values.placement??'parallel';if(!['parallel','serial'].includes(placement))throw new Error('--placement must be parallel or serial');
    if(values['track-id']?.length>1)throw new Error('Batch import accepts one destination track.');
    let atSample=values['at-sample']===undefined?0:Number(values['at-sample']),trackId=values['track-id']?.[0],expectedRevision=await revision();
    if(!Number.isSafeInteger(atSample)||atSample<0)throw new Error('--at-sample must be a nonnegative integer');
    if(trackId&&!initialState.project.tracks.some(t=>t.id===trackId&&t.type==='audio'))throw new Error('Choose an existing audio target track.');
    const files=[];
    for(const file of rest){
      const ext=path.extname(file).toLowerCase(),kind=ext==='.wav'?'wav':['.aif','.aiff','.aifc'].includes(ext)?'aiff':['.mid','.midi'].includes(ext)?'midi':null;
      if(!kind)throw new Error(`Unsupported import file: ${file}`);const stat=await fs.stat(file),limit=kind==='midi'?(initialState.capabilities.maxMidiUploadBytes??33554432):(initialState.capabilities.maxWavUploadBytes??134217728);
      if(!stat.isFile()||stat.size>limit)throw new Error(`Import file must be regular and within ${limit} bytes: ${file}`);files.push({file,kind});
    }
    if(midiImportOptionsRequested&&!files.some(f=>f.kind==='midi'))throw new Error('MIDI timing options require at least one MIDI file.');
    if(files.every(f=>f.kind==='midi')&&(values['at-sample']!==undefined||trackId))throw new Error('Audio position/target options require at least one audio file.');
    const report={placement,initialRevision:expectedRevision,files:files.map(f=>({name:path.basename(f.file),status:'not-started'}))};let cancelled=false;
    const cancel=()=>{cancelled=true;};process.once('SIGINT',cancel);
    try{
      for(let index=0;index<files.length;index++){
        if(cancelled){report.stoppedReason='cancelled-before-next-file';break;}
        const {file,kind}=files[index],row=report.files[index];
        try{
          const params=new URLSearchParams({name:path.basename(file),expectedRevision:String(expectedRevision)});
          appendMidiImportOptions(params,kind);
          if(kind!=='midi'){params.set('atSample',String(atSample));if(trackId)params.set('trackId',trackId);}
          const response=await request(`/api/import/${kind}?${params}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await fs.readFile(file)}),result=await response.json();
          row.status='imported';row.revision=result.projectRevision;row.warnings=result.warnings??[];if(result.midiImportReport)row.midiImportReport=result.midiImportReport;
          const state=await query('/api/state');
          if(state.session.document.id!==requestDocumentId||state.project?.revision!==result.projectRevision){report.stoppedReason='project-changed';break;}
          expectedRevision=result.projectRevision;
          if(placement==='serial'&&kind!=='midi'){
            const created=new Set(result.changes?.created??[]),clip=state.project.clips.find(c=>c.type==='audio'&&created.has(c.id));if(!clip)throw new Error('Imported clip metadata was not found; remaining files stopped.');
            const asset=state.project.assets.find(a=>a.id===clip.assetId);trackId=clip.trackId;atSample=Math.ceil(clip.startSample+clip.lengthFrames/asset.sampleRate*state.project.sampleRate);if(!Number.isSafeInteger(atSample))throw new Error('Next import position exceeds safe sample range.');
          }
        }catch(error){if(row.status!=='imported')row.status=[409,413,415,422].includes(error.status)?'failed':'uncertain';row.error=error.message;report.stoppedReason=row.status==='imported'?'applied-but-continuation-failed':row.status;break;}
      }
      report.completed=report.files.filter(f=>f.status==='imported').length;report.cancelled=cancelled;report.status=report.completed===files.length?'completed':'stopped';
      if(report.status==='stopped')throw Object.assign(new Error('Batch stopped. Imported files remain applied; inspect per-file results before retrying.'),{code:'IMPORT_BATCH_STOPPED',details:report});
      print(report);return;
    }finally{process.removeListener('SIGINT',cancel);}
  }
  if(action==='import'){
    if(rest.length!==1)throw new Error('Provide exactly one WAV, AIFF or MIDI filename. Batch import is currently available in the GUI.');const file=rest[0],extension=path.extname(file).toLowerCase(),kind=extension==='.wav'?'wav':['.aif','.aiff','.aifc'].includes(extension)?'aiff':['.mid','.midi'].includes(extension)?'midi':null;
    if(!kind)throw new Error('Supported imports: .wav, .aif, .aiff, .aifc, .mid, .midi');
    if(kind==='midi'&&(values['at-sample']!==undefined||values['track-id']))throw new Error('Audio position/target options do not apply to MIDI import.');
    if(values['track-id']?.length>1)throw new Error('Import accepts a single destination --track-id.');
    const params=new URLSearchParams({name:path.basename(file),expectedRevision:String(await revision())});
    if(values['at-sample']!==undefined){const n=Number(values['at-sample']);if(!Number.isSafeInteger(n)||n<0)throw new Error('--at-sample must be a nonnegative integer');params.set('atSample',String(n));}
    if(values['track-id'])params.set('trackId',values['track-id'][0]);
    appendMidiImportOptions(params,kind);
    const response=await request(`/api/import/${kind}?${params}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await fs.readFile(file)});print(await response.json());return;
  }
  if(['render','offline-render','render-stems','offline-render-stems','offline-render-stems-dir'].includes(action)){
    const dirBatch=action==='offline-render-stems-dir';if(dirBatch&&values.force)throw new Error('Stem directory export never overwrites; choose a new directory.');
    const stemBatch=action.endsWith('stems'),offline=action.startsWith('offline-');
    const output=path.resolve(rest[offline?1:0]??'');if(!rest[offline?1:0])throw new Error('Provide output WAV filename');
    if(!dirBatch){await ensureOutput(output,values.force);await ensureOutput(`${output}.render.json`,values.force);}
    let options={...(values['no-effect-tail']?{autoEffectTail:false}:{}),...(values['file-format']?{fileFormat:values['file-format']}:{}),...(values['export-preset']?{exportPresetId:values['export-preset']}:{}),...(stemBatch||dirBatch?{stemBatch:true}:{}),...(values.dither?{dither:values.dither}:{}),...(values['dither-seed']!==undefined?{ditherSeed:Number(values['dither-seed'])}:{}),...(values['split-channels']?{stemSplitChannels:true}:{}),...(values['output-sample-rate']!==undefined?{outputSampleRate:Number(values['output-sample-rate'])}:{}),...(values.mixdown?{stemMixdown:true}:{}),...(values['cycle-marker-id']?{cycleMarkerIds:values['cycle-marker-id']}:{}),...(values['track-id']?{trackIds:values['track-id']}:{}),};if(values['channel-mode']!==undefined)options.channelMode=values['channel-mode'];if(values['sample-format']!==undefined)options.sampleFormat=values['sample-format'];if(values['timing-options']!==undefined)options.timingOptions=JSON.parse(values['timing-options']);if(values['start-tick']!==undefined){options.startTick=Number(values['start-tick']);if(!Number.isSafeInteger(options.startTick)||options.startTick<0)throw new Error('--start-tick must be a nonnegative integer');}if(values['chase-options']!==undefined){if(options.startTick===undefined&&!values.locators&&!values['cycle-marker-id'])throw new Error('--chase-options requires --start-tick or --locators');options.chaseOptions=JSON.parse(values['chase-options']);}if(values.duration!==undefined)options.durationSeconds=Number(values.duration);if(values.tail!==undefined)options.tailSeconds=Number(values.tail);
    const applyLocatorRange=project=>{if(!values.locators)return;const range=project.locators;if(!range)throw new Error('Project has no Locator range');const tail=options.tailSeconds??0.2;if(!Number.isFinite(tail)||tail<0||tail>10)throw new Error('Locator tail must be 0..10 seconds');const map=compileTempoMap(project.tempoMap,project.ppq);options.startTick=range.startTick;options.durationSeconds=(Math.ceil(map.tickToSeconds(range.endTick)*project.sampleRate)-Math.ceil(map.tickToSeconds(range.startTick)*project.sampleRate))/project.sampleRate+tail;};
    let bytes,metadata;
    if(offline){
      const projectFile=path.resolve(rest[0]),project=JSON.parse(await fs.readFile(projectFile,'utf8'));validateProject(project);options=resolveExportPresetOptions(project,options);applyLocatorRange(project);
      if(dirBatch){const {renderStemDirectory}=await import('./stem-directory.mjs');print(await renderStemDirectory({project,projectDirectory:path.dirname(projectFile),outputDirectory:output,options}));return;}
      const result=await new Promise((resolve,reject)=>{const worker=new Worker(new URL(stemBatch?'./stem-worker.mjs':'./render-worker.mjs',import.meta.url),{workerData:{...(stemBatch?{kind:'stemBatch'}:{}),project,projectDirectory:path.dirname(projectFile),options}});let delivered=false;worker.once('message',result=>{delivered=true;result.error?reject(new Error(result.error.message)):resolve(result);});worker.once('error',reject);worker.once('exit',code=>{if(!delivered)reject(new Error(`Worker exited (${code})`));});});
      bytes=result.bytes;metadata={revision:project.revision,projectId:project.id,status:'completed',stats:result.stats};
    }else{
      applyLocatorRange(initialState.project);const expectedRevision=await revision();if(values.locators&&initialState.project.revision!==expectedRevision)throw new Error('Project changed while reading Locator range; retry export');
      const timing=await query('/api/workspace/timing-settings');let job=await post('/api/render',{...(stemBatch?{stemBatch:true}:{}),expectedRevision,expectedTimingRevision:timing.settings.revision,expectedTimingFingerprint:timing.fingerprint,...options});const deadline=Date.now()+180000;
      while(job.status==='running') {if(Date.now()>deadline){await post(`/api/jobs/${job.jobId}/cancel`,{});throw new Error('Render timed out; worker cancelled');}await new Promise(resolve=>setTimeout(resolve,100));job=await query(`/api/jobs/${job.jobId}`);}
      if(job.status!=='completed')throw new Error(`Render ${job.status}: ${JSON.stringify(job.error??{})}`);
      bytes=new Uint8Array(await(await request(job.url)).arrayBuffer());metadata=job;
    }
    await atomicWrite(output,bytes,{noClobber:!values.force});await atomicWrite(`${output}.render.json`,JSON.stringify(metadata,null,2)+'\n',{noClobber:!values.force});print({output,metadata:`${output}.render.json`,...metadata});return;
  }
  if(action==='export-musicxml'){
    if(!rest[0])throw new Error('Provide output filename');const output=path.resolve(rest[0]);await ensureOutput(output,values.force);
    if(!initialState.capabilities.musicXmlExport)throw new Error('MusicXML export requires a refreshed server.');
    const params=new URLSearchParams();if(values['key-fifths']!==undefined)params.set('fifths',values['key-fifths']);for(const id of values['track-id']??[])params.append('trackId',id);
    const response=await request(`/api/export/musicxml?${params}`);await atomicWrite(output,new Uint8Array(await response.arrayBuffer()),{noClobber:!values.force});
    print({output,...JSON.parse(response.headers.get('X-NewDAW-MusicXML')??'{}'),projectRevision:Number(response.headers.get('X-NewDAW-Revision')),warnings:[response.headers.get('X-NewDAW-Loss-Report')]});return;
  }
  if(action==='export-midi'||action==='export-project'||action==='export-bundle'){
    if(!rest[0])throw new Error('Provide output filename');const output=path.resolve(rest[0]);await ensureOutput(output,values.force);
    const midiParams=new URLSearchParams({format:values['midi-format']??'1'});
    if(action==='export-midi'){for(const [flag,key]of Object.entries({'midi-no-patch':'patch','midi-no-volume-pan':'volumePan','midi-no-modifiers':'modifiers','midi-no-markers':'markers','midi-no-delay':'delay'}))if(values[flag]){if(!initialState.capabilities.midiExportOptions)throw new Error('MIDI export options require a refreshed server.');midiParams.set(key,'0');}if(values.locators){if(!initialState.capabilities.midiExportLocators)throw new Error('Locator MIDI export requires a refreshed server.');midiParams.set('range','locators');if(values['midi-no-chase'])midiParams.set('chase','0');}if(values['midi-ppq']!==undefined){if(!initialState.capabilities.midiExportPpq)throw new Error('MIDI PPQ conversion requires a refreshed server.');midiParams.set('ppq',values['midi-ppq']);}if(values['track-id']&&!initialState.capabilities.midiTrackExportSelection)throw new Error('Selected-track MIDI export requires a refreshed server.');if(initialState.capabilities.midiTrackExportSelection)midiParams.set('expectedRevision',String(await revision()));for(const id of values['track-id']??[])midiParams.append('trackId',id);}
    const route=action==='export-midi'?`/api/export/midi?${midiParams}`:action==='export-bundle'?`/api/project/bundle?expectedRevision=${await revision()}`:'/api/project';
    const response=await request(route);await atomicWrite(output,new Uint8Array(await response.arrayBuffer()),{noClobber:!values.force});
    print({output,...(action==='export-midi'?{midiFormat:Number(response.headers.get('X-NewDAW-MIDI-Format')),exportOptions:response.headers.has('X-NewDAW-MIDI-Options')?JSON.parse(response.headers.get('X-NewDAW-MIDI-Options')):undefined,outputPpq:response.headers.has('X-NewDAW-MIDI-PPQ')?Number(response.headers.get('X-NewDAW-MIDI-PPQ')):undefined,projectRevision:response.headers.has('X-NewDAW-Revision')?Number(response.headers.get('X-NewDAW-Revision')):undefined,exportedTrackCount:response.headers.has('X-NewDAW-MIDI-Track-Count')?Number(response.headers.get('X-NewDAW-MIDI-Track-Count')):undefined}:{}),...(action==='export-bundle'?{projectRevision:Number(response.headers.get('X-NewDAW-Revision'))}:{}),
      warnings:[action==='export-midi'?response.headers.get('X-NewDAW-Loss-Report'):action==='export-bundle'?'ZIP contains a frozen project, verified source WAV assets and provenance. Session undo history is not included.':'JSON references assets/ relative to the project. Use collect or export-bundle for a self-contained backup.']});return;
  }
  throw new Error(`Unknown action: ${action}. Use --help.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({status:'error',code:error.code??'CLI_ERROR',message:error.message,...(error.details?{details:error.details}:{})}));process.exitCode=1;});
