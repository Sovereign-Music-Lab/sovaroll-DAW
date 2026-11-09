# CLI reference / CLI 전체 도움말

[CLI guide](CLI-GUIDE.en.md) · [CLI 가이드](CLI-GUIDE.ko.md) · [English manual](MANUAL.en.md) · [한국어 설명서](MANUAL.ko.md)

Generated from `node src/cli.mjs --help` for this release. For the current command schemas, start the local server and run `npm run cli -- commands`.

이번 버전의 실행 도움말입니다. 실제 엔진 명령 스키마는 서버 실행 후 `npm run cli -- commands`로 확인합니다.

```text
Sovereign DAW / SovaRoll 0.129.0 — GUI + CLI, shared native MIDI transport and offline preview

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
```
