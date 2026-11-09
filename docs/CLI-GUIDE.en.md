# SovaRoll CLI guide

[한국어](CLI-GUIDE.ko.md) · [Project](../README.md) · [Manual](MANUAL.en.md) · [Every option (CLI reference)](CLI.md)

The same text is available offline in the terminal: `npm run cli -- guide` (topics: `guide edit`, `guide export`, `guide all`). The GUI and the CLI use the same engine, so everything here is undoable and revision-checked like a click in the browser.

## The daily routine

1. **Start** — `npm start` in terminal 1; leave it running.
2. **Look** — `npm run cli -- status` shows the project, track IDs and the current revision.
3. **Check** — add `--dry-run` to any edit. It validates and prints the result without changing anything.
4. **Apply** — run the same command without `--dry-run`. Use `--revision N` when something else (the GUI, an agent) may also be editing.
5. **Save** — `npm run cli -- save`. Edits autosave; explicit Save is your reference point.
6. **Export & back up** — `render`, `export-midi`, and `export-bundle backup.zip`.

## Rules that apply to every command

- Commands that connect to a server use `--url` (default `http://127.0.0.1:4317`). Offline commands (`init`, `guide`, `offline-render*`, `collect`, `recover*`) read files directly.
- IDs (tracks, clips, notes) come from `status`, not from examples.
- Exports and recovery never overwrite existing files; only exports accept `--force`.
- `*-plan` commands only inspect. A change happens when you pass the PLAN_ID to the matching command.
- A failed command leaves the project unchanged and prints a structured error.
- A level or waveform check is a technical fact, not a musical or listening judgment.

## Start and stop

The server holds the open project. Most commands talk to it; keep it running in one terminal and use a second terminal for commands.

```sh
# Start GUI + command server on port 4317 (Ctrl+C stops it)
npm start
# Use another port; add --url http://127.0.0.1:4318 to later commands
npm start -- --port 4318
# Create a blank project (refuses to overwrite; add --demo for a demo)
node src/cli.mjs init ~/Music/SovaRoll/Song/Song.newdaw.json
# Open a specific project
node src/cli.mjs serve --project ~/Music/SovaRoll/Song/Song.newdaw.json --port 4318
# This guide, offline (no server needed)
npm run cli -- guide [TOPIC|all]
# Read project state (changes nothing)
npm run cli -- status
# Show active filename and the explicit Save checkpoint
npm run cli -- document
```

## Open, create and switch projects

Workspace commands are two-step: a *-plan command inspects, then the matching command applies the plan ID. Nothing changes until you apply.

```sh
# List open projects and the active one
npm run cli -- projects
# Inspect a file to add to the workspace
npm run cli -- project-open-plan PATH [--inactive]
# Inspect a recent project to add to the workspace
npm run cli -- project-open-recent-plan ENTRY_ID [--inactive]
# Apply the open plan; choose what happens to the current project
npm run cli -- project-open PLAN_ID --current preserve|save [--dry-run]
# Plan switching the active project
npm run cli -- project-activate-plan DOCUMENT_ID
# Apply the switch
npm run cli -- project-activate PLAN_ID --current preserve|save
# Plan closing one document (never auto-activates another)
npm run cli -- project-close-plan DOCUMENT_ID
# Apply the close
npm run cli -- project-close PLAN_ID --current preserve|save
# Plan a new (Untitled) project
npm run cli -- project-new-plan [FOLDER] [--sample-rate N] [--folder-name NAME] [--chosen-folder PATH]
# Create it
npm run cli -- project-new PLAN_ID --current preserve|save [--save-output PATH]
# Browse local folders (read-only)
npm run cli -- project-folders [PATH] [--cursor N]
# Read default/prompt location preferences
npm run cli -- project-locations
# Save location preferences
npm run cli -- project-location-settings '{"locationMode":"default","defaultLocation":"/path"}' [--location-revision N]
# List recent projects with missing/changed diagnostics
npm run cli -- recent
# Inspect a recent project
npm run cli -- open-recent-plan ENTRY_ID
# Inspect an existing project (legacy replacement flow)
npm run cli -- open-plan PATH
# Legacy: close the old file and activate the inspected one
npm run cli -- open PLAN_ID --current preserve|save
# Remove one recent-list entry (not the project)
npm run cli -- recent-remove ENTRY_ID
# Clear only the recent list
npm run cli -- recent-clear --confirm
# List Untitled recovery records
npm run cli -- drafts
# Plan recovering an Untitled draft
npm run cli -- project-recover-plan DRAFT_ID
# Recover the draft
npm run cli -- project-recover PLAN_ID --current preserve|save [--save-output PATH]
```

## Edit with commands (the core routine)

Routine: look → dry-run → apply → check history. IDs come from `status`, never from copied examples. --revision N rejects the edit if someone else changed the project first.

```sh
# List every engine command and its schema
npm run cli -- commands
# Validate without changing anything
npm run cli -- command track.add '{"type":"midi","name":"Piano"}' --dry-run
# Apply one command (one undo step)
npm run cli -- command track.add '{"type":"midi","name":"Piano"}'
# Guard against concurrent edits
npm run cli -- command track.update '{"trackId":"ID","gainDb":-9}' --revision N
# Apply an array of commands atomically as ONE undo step
npm run cli -- batch commands.json [--dry-run]
# List edit actions and the undo/redo boundary
npm run cli -- history
# Query a clip selection (no edits); mode: all|none|invert|inLoop|outsideLoop|beforeCursor|afterCursor|atCursor|tracks
npm run cli -- select-clips '{"mode":"all"}'
# Save a read-only selection snapshot
npm run cli -- copy-clips OUT.newdaw-clips.json '{"clipIds":["ID"]}'
# Paste a snapshot at a tick/sample or original position
npm run cli -- paste-clips IN.newdaw-clips.json '{"atTick":0}' [--dry-run]
# Resize MIDI parts; source notes are preserved
npm run cli -- resize-midi-parts '{"clipIds":["ID"],"deltaTicks":480}' [--dry-run]
# Atomic split at zero crossings
npm run cli -- split-zero '{"atTick":1920}' [--dry-run]
# Trim audio clip edges
npm run cli -- trim-clips '{"clipIds":["ID"],"edge":"left","seconds":0.1}' [--dry-run]
# Slip audio source inside the clip
npm run cli -- slip-clips '{"clipIds":["ID"],"seconds":0.05}' [--dry-run]
# Commit timestamped events as editable MIDI
npm run cli -- commit-midi-take take.json [--dry-run]
# Render temporary note values to a WAV; the project is not edited
npm run cli -- audition out.wav '{"clipId":"ID","updates":[{"noteId":"N","value":100}]}' [--duration 0.5] [--force]
# Controller edits use `command midi.controllers.*`; get the schema from `commands`
npm run cli -- command midi.controllers.setValues '{...}' --dry-run
```

## Time, tempo and snap

Read-only queries first (time-*), then explicit edits. Settings updates use revision + fingerprint checks; read the setting, then send the update back with what you read.

```sh
# Read project time in primary/timeline/piano format
npm run cli -- time-display '{"tick":1920}'
# Exact musical position/duration with the current profile
npm run cli -- time-convert '{"tick":1920}'
# Query saved primary/piano snap
npm run cli -- time-snap '{"localTick":0}'
# Read bounded elapsed-format ruler intervals
npm run cli -- time-ruler '{"fromPixel":0,"toPixel":800,"zoom":1}'
# Read/update shared display PPQ and Length Adjustment
npm run cli -- timing-settings [JSON]
# Edit MIDI note/clip formatted times with explicit rounding
npm run cli -- time-command CMD JSON TIMES [OPTIONS]
# Edit explicit time fields in shared display ticks
npm run cli -- display-command CMD JSON TIMES
# Edit a note's displayed start/length
npm run cli -- note-time CLIP NOTE JSON
# Compute/apply tempo from taps
npm run cli -- tap-tempo '{"tapTimesMs":[0,500,1000,1500]}' [--dry-run]
# Read the sorted marker list
npm run cli -- markers ['{"sortBy":"tick"}']
# Read/update common MIDI split preferences
npm run cli -- split-settings [JSON]
# Read/update Chase types
npm run cli -- chase-settings [JSON]
# Read/update Reset preferences
npm run cli -- reset-settings [JSON]
# Read/update CC menu, presets, New Event Type
npm run cli -- controller-settings [JSON]
```

## Import and prepare audio

Import prints loss warnings; read them. Audio processing is non-destructive: the original source bytes stay and can be restored.

```sh
# Import into the session
npm run cli -- import FILE.wav|FILE.aiff|FILE.mid [--track-id ID] [--at-sample N]
# MIDI import options (also --midi-auto-dissolve, --midi-tempo, --midi-signature, --midi-no-markers)
npm run cli -- import FILE.mid --midi-single-part --midi-position left-locator
# Import up to 32 files at once
npm run cli -- import-many A.wav B.wav [--placement parallel|serial]
# Peak / RMS / DC analysis (a number, not a musical judgment)
npm run cli -- audio-statistics CLIP_ID [raw|event]
# Non-destructive DC correction
npm run cli -- remove-dc CLIP_ID [--dry-run]
# Non-destructive peak normalization
npm run cli -- normalize-audio CLIP_ID [DBFS] [--dry-run]
# Nearest zero crossing (read-only)
npm run cli -- zero-crossing CLIP_ID AT_SAMPLE
# Time-stretch one clip (needs external FFmpeg)
npm run cli -- stretch-audio CLIP_ID '{"targetFrames":96000}' [--dry-run]
# Stretch several clips
npm run cli -- stretch-audio-batch '[{"clipId":"ID","targetFrames":96000}]' [--dry-run]
# Read processing provenance
npm run cli -- audio-processing CLIP_ID
# Restore the original source settings
npm run cli -- restore-audio-processing CLIP_ID [--dry-run]
```

## Render and export

Exports never overwrite unless you pass --force. A render is a snapshot; it does not follow later edits. The render window is limited to 600 seconds including the tail.

```sh
# Render the whole session (+ metadata sidecar)
npm run cli -- render sessions/mix.wav
# Render only the Locator range
npm run cli -- render out.wav --locators --tail 1
# Output format, deterministic dither (also --file-format aiff, --output-sample-rate N, --channel-mode mono)
npm run cli -- render out.wav --sample-format pcm24 --dither tpdf --dither-seed 1
# Render only these tracks
npm run cli -- render out.wav --track-id ID --track-id ID2
# Aligned per-track WAVs + manifest (ZIP up to 128 MiB)
npm run cli -- render-stems stems.zip [--split-channels] [--mixdown] [--cycle-marker-id ID]
# Server-less stems, one WAV at a time, no ZIP cap
npm run cli -- offline-render-stems-dir PROJECT.json NEW_DIR
# Server-less stem ZIP
npm run cli -- offline-render-stems PROJECT.json stems.zip
# Server-less read-only render
npm run cli -- offline-render PROJECT.json mix.wav
# Editable MIDI (also --track-id, --midi-no-patch/-no-volume-pan/-no-modifiers/-no-markers/-no-delay)
npm run cli -- export-midi out.mid [--midi-format 0|1] [--midi-ppq 480] [--locators]
# Project JSON only; audio is NOT included
npm run cli -- export-project out.json
# Project + verified media ZIP (up to 64 MiB)
npm run cli -- export-bundle backup.zip
```

## Save, versions, backup and recovery

Edits autosave; explicit Save sets the reference point that Revert and versions use. Recovery commands never overwrite the source or its backup.

```sh
# Explicit Save (Untitled needs a new named path)
npm run cli -- save [--output PATH]
# Save and activate the next numbered filename
npm run cli -- save-new-version
# Save under another new name
npm run cli -- save-as NEW.json
# Preview what Revert would discard
npm run cli -- revert-plan
# Return to the last explicit Save
npm run cli -- revert PLAN_ID --confirm --media keep|trash
# List media moved aside by past Reverts
npm run cli -- revert-trash
# Restore one Revert trash operation (no overwrite)
npm run cli -- restore-revert-media ID
# List automatic backups and settings
npm run cli -- backups
# Back up now (--force even when unchanged)
npm run cli -- backup-now [--force]
# Change automatic backup settings
npm run cli -- backup-settings '{"enabled":true,"intervalMinutes":10,"maxCount":20}' [--dry-run]
# Recover an automatic backup to a new file
npm run cli -- recover-backup PROJECT.json BACKUP_ID --output NEW.json
# Recover from PROJECT.json.bak to a new file
npm run cli -- recover PROJECT.json --output NEW.json
# Copy a project and all media into a new folder
npm run cli -- collect PROJECT.json NEW_DIR [--dry-run]
```

## Media pool and missing files

Exact restore verifies the original SHA-256. Relinking to a different file is a separate, reviewed operation (search → plan → accept).

```sh
# Verify media hashes and show clip references
npm run cli -- assets
# Restore exact original bytes
npm run cli -- restore-asset ASSET_ID SOURCE.wav [--dry-run]
# List original-container archives
npm run cli -- source-archives
# Download and verify an original container
npm run cli -- source-archive-download ID OUTPUT
# Restore a missing exact original (no overwrite)
npm run cli -- source-archive-restore ID SOURCE
# Search a folder for candidates
npm run cli -- media-search '{"assetId":"ID","location":"/folder","mode":"name"}'
# Read progress and candidates
npm run cli -- media-search-status ID
# Stop a search, keep what was found
npm run cli -- media-search-stop ID
# Preview a relink
npm run cli -- media-plan '{"searchId":"S","candidateId":"C"}'
# Apply the reviewed mapping
npm run cli -- media-accept PLAN_ID [--allow-replacement]
# Remove missing sources and their clips (never deletes files)
npm run cli -- remove-missing [--dry-run]
```

## macOS native MIDI output (optional)

Needs the Swift toolchain: `node scripts/build-native-midi.mjs`. Sends MIDI only, not synchronized audio.

```sh
# List real CoreMIDI sources/destinations
npm run cli -- native-ports
# Read/update this project's mode and routes
npm run cli -- native-settings [JSON]
# Read the native transport state
npm run cli -- native-status
# Start routed MIDI
npm run cli -- native-play [--start-tick N]
# Stop the current job
npm run cli -- native-stop [JOB_ID]
# Cancel playback and reset configured ports on all 16 channels
npm run cli -- midi-reset
```
