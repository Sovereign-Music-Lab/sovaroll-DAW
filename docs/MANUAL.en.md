# SovaRoll user manual

[한국어](MANUAL.ko.md) · [Project](../README.md) · [CLI reference](CLI.md) · [Development notes](DEVELOPMENT.en.md)

This manual covers the current development release, 0.129.0. The interface is primarily Korean; labels below help English readers find the controls. Complete UI translation is still planned. The verified desktop environment is macOS with Chrome; other operating systems and browsers need separate validation. Optional native MIDI is macOS-only.

## 1. Install and start

Install Node.js 22+ and Git. In a terminal:

```sh
node --version
git --version
git clone https://github.com/Sovereign-Music-Lab/sovaroll-DAW.git
cd sovaroll-DAW
npm start
```

No `npm install` is required for the DAW. No LLM, weights, account or companion repository is needed. Keep the terminal running and open [http://127.0.0.1:4317](http://127.0.0.1:4317). The default first run creates a short synthetic demo at `sessions/First-Light.newdaw.json`. It opens an existing file without replacing it with a new demo.

Stop with **Ctrl+C** in the terminal. Closing the browser tab alone does not stop the server. Keep the server local; this release is not a hosted multi-user service.

If 4317 is occupied, run `npm start -- --port 4318` and open [port 4318](http://127.0.0.1:4318). Add `--url http://127.0.0.1:4318` to CLI commands that connect to it. Do not stop an unrelated server to free a port.

## 2. Create a blank project

From the repository root, on macOS/Linux shells:

```sh
mkdir -p "$HOME/Music/SovaRoll/My-Song"
node src/cli.mjs init "$HOME/Music/SovaRoll/My-Song/My-Song.newdaw.json"
node src/cli.mjs serve --project "$HOME/Music/SovaRoll/My-Song/My-Song.newdaw.json" --port 4318
```

`init` refuses to overwrite an existing file. Open the browser at the chosen port. Keeping your project outside the application folder makes application updates and removal easier. Use an appropriate absolute path in other shells.

The **프로젝트 열기** (Projects) window also exposes project opening and creation. Inspect the target path and current active project. Multiple projects can be open; the active one receives edits and playback. Opening, activating and closing are separate actions. Unsaved/Untitled work may need a named first save.

## 3. Find the main controls

| Label | Meaning and use |
|---|---|
| 프로젝트 열기 | Projects: create/open and choose the active document |
| 저장·버전 | Save, Save As, numbered versions and revert |
| 편집 이력 | Edit history, undo/redo position |
| 자동백업 | Automatic backup settings and recovery |
| 미디어 풀 | Source media and missing-file status |
| 백업 ZIP | Download a project-and-media bundle |
| 프로젝트 JSON | Download the project description; audio is not included |
| 가져오기 | Import WAV, AIFF or MIDI |
| MIDI 내보내기 | Export editable MIDI |
| 믹스 WAV 내보내기 | Render/export audio |
| 처음으로 / 재생 / 정지 | Rewind / Play / Stop |
| 반복 | Cycle the locator range |
| 도움말 | In-app help |

The arrangement shows tracks and clips. Selecting a MIDI clip opens its notes in the piano roll. The Inspector edits the selected object. Some controls are inside expandable menus or appear only for a relevant selection.

## 4. A normal work session

1. Start the server with the intended project, open the browser and confirm the project name/path.
2. Make a save/version or backup before a major edit. Check missing media in the media pool.
3. Create/select a MIDI track and part, or import your own MIDI/audio file.
4. Edit notes and clips; audition phrases and use undo when comparing alternatives.
5. Balance tracks and listen. Keep MIDI and source audio when exporting a mix.
6. Save explicitly, export useful interchange files and make a project/media backup.
7. Stop playback, stop the server, and retain the complete project folder.

Edits are persisted automatically, while **explicit Save** establishes a reference point used by revert/version operations. These are different concepts. A rendered WAV is a snapshot and does not update automatically when you edit MIDI later.

## 5. MIDI editing and arrangement

Select a MIDI part, then click an empty piano-roll cell to enter a note. Drag a note to move its time/pitch. Use the Inspector for precise duration and velocity. Select multiple notes for operations such as transpose, quantize, velocity changes or legato. Inspect the selection before applying a bulk command.

Within the focused piano roll, use Cmd/Ctrl+A, C and V for selection/copy/paste. Move the cursor using the ruler before pasting. Text fields keep their normal text shortcuts. Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z redoes. GUI buttons provide the same undo history, including CLI edits.

Clip tools support moving, splitting, repeating and clipboard operations. Folder and track controls organize the arrangement. Locators define a working or export range. Markers label positions and ranges. Timing/snap controls distinguish musical time from seconds/samples/frames; a displayed unit is not necessarily the stored unit. Consult the live command schema for exact tick/sample fields.

Controller lanes retain editable values and curves. MIDI export samples supported curves into MIDI events; project JSON preserves their editable representation. MIDI modifiers can affect playback/export while preserving source notes; Freeze deliberately commits supported transformations. Review the scope and undo behavior before freezing or merging.

The built-in oscillator is a preview instrument. MIDI messages can be preserved for export even if that oscillator does not reproduce their original instrument sound, pressure or SysEx behavior.

## 6. Audio import, edit and record

Use **가져오기** to select WAV/AIFF/MIDI. Review import warnings and placement options. Audio references managed source assets; keep the `assets/` folder. Clip movement, trims, splits, gain/fades, polarity and other supported edits preserve source media. Statistics report technical measurements; they do not replace listening.

Audio recording uses browser microphone permission. Choose the intended input and destination, set recording/monitoring options, start and stop, then inspect the resulting clip. Begin with a short take and headphones when monitoring to avoid feedback. Count-in and backing playback have configuration and timing limits. The automated release test uses a fake microphone; real-device latency and quality need your own check.

Web MIDI input is optional and requests browser permission through its connection controls. Choose the input and capture settings, record a short take, and inspect notes/controllers before relying on a longer performance. Preserve a downloadable take/recovery record if a commit fails or the active document changes. Take recovery stored in the browser is separate from your exported MIDI/project backups.

Optional offline time stretching uses an external **FFmpeg** executable. Put it on PATH or set `NEWDAW_FFMPEG` to its absolute executable path. It is not downloaded or bundled by SovaRoll. Basic editing and playback do not require this optional processor.

## 7. Playback and mixing

Use Play/Stop or Space outside text input. The browser prepares a rendered snapshot; edits may stop old playback so it cannot be mistaken for the current mix. Ruler clicks seek. Cycle uses the saved locators.

Track gain, pan, mute and solo and master gain affect the mix. Verify mute/solo states before export. Use a reasonable listening level and inspect overloads. The current engine is not a low-latency native recording system. It does not provide external VST/AU instrument hosting.

Optional macOS MIDI output requires the system Swift toolchain:

```sh
node scripts/build-native-midi.mjs
npm run cli -- native-ports
npm run cli -- native-status
```

Configure actual destinations/channels using **MIDI 출력** and inspect routes before playing. Native mode sends **MIDI only**, without synchronized audio clips. `native-stop` and `midi-reset` are available from the CLI. The bridge is optional and model-independent.

## 8. Save, recover and move work

Use Cmd/Ctrl+S or **저장·버전**. Save As and version saving can change the active path; check it before the next launch. Keep the project JSON, `assets/`, history/save sidecars, and backup/recovery directories together. `.bak`, `.history.json` and `.saved.json` have distinct recovery/history roles; preserve the complete folder instead of selecting just one file.

If media is missing, use the media pool's verification/recovery workflow. An exact restore verifies source bytes. A replacement/relink is a different operation and can change the result. Do not delete the old project or media while diagnosing a missing-file warning.

CLI inspection and backup examples, with the default server running:

```sh
npm run cli -- document
npm run cli -- history
npm run cli -- assets
npm run cli -- backups
npm run cli -- save
npm run cli -- export-bundle sessions/My-Song-backup.zip
```

For another server, append its `--url`. Backup ZIP contains project/media; exported JSON alone does not. A bundle is for project/media transfer, so also retain your complete original folder when you need historical sidecars and recovery records. Inspect a recovered copy before replacing a working project.

## 9. Export

```sh
npm run cli -- render sessions/mix.wav
npm run cli -- export-midi sessions/notes.mid
npm run cli -- render-stems sessions/stems.zip
npm run cli -- export-bundle sessions/project-backup.zip
```

The GUI offers mix/MIDI/bundle downloads. The CLI also supports selected tracks, locator ranges, output sample formats/rates, deterministic dither and stem variants; inspect [CLI reference](CLI.md) and live `--help` for exact combinations. Existing export paths are not overwritten without `--force`. Choose new filenames when comparing revisions.

MIDI carries musical events, not the mixed audio, all plugin sounds or every mixer decision. Retain a project bundle plus a mix and MIDI when handing work to another workstation. Export warnings explain information that a target format cannot preserve.

Current limits include a **600-second render window including its tail**, bounded memory, and file/bundle size limits. Read the live capabilities/help when choosing export settings; splitting an export into ranges may be necessary. A technical export success is not a listening review.

Offline rendering does not need a running server:

```sh
node src/cli.mjs offline-render /absolute/path/My-Song.newdaw.json /absolute/path/mix.wav
```

## 10. CLI and local agents

```sh
npm run cli -- status
npm run cli -- commands
npm run cli -- command track.add '{"type":"midi","name":"Piano"}' --dry-run
npm run cli -- command track.add '{"type":"midi","name":"Piano"}'
```

Use IDs returned by the current project, not copied example IDs. `--dry-run` validates without applying the command. `--revision N` guards against another edit occurring first. A batch is one validated transaction/undo step. Read [CLI reference](CLI.md) and the live schemas before generating commands.

Gemma 4 is the maintainer's coding workflow, not a built-in chat/composition endpoint. The full RAG/LoRA–DAW–autonomous-composition–Logic Pro MCP feedback loop is a wider development direction. See [philosophy](../PHILOSOPHY.en.md) and [local model handoff](agent/LOCAL_MODEL.md).

## 11. Update and verify

Save work and back up its complete folder. Stop the server. Inspect local code changes before pulling:

```sh
git status --short
git pull --ff-only
```

Keep your modifications if the pull refuses; do not reset them away. Restart the chosen project and verify opening, a small edit/undo, and a short export.

For development verification:

```sh
# Browser tooling is external and optional for users; required for E2E.
npx --yes playwright --version
node scripts/agent/guard.mjs --init
npm run agent:verify:full
npm run test:native
npm run agent:e2e
```

Have Chrome installed. The E2E harness finds Playwright in the npm cache or through `NEWDAW_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`. Full time-stretch tests need FFmpeg. Tests use synthetic/temporary data. Some browser/native paths are macOS-specific; this publication does not claim equivalent validation on other platforms.

## 12. Troubleshooting

| Symptom | Next check |
|---|---|
| Browser cannot connect | Terminal server output, correct port, Node version; keep the server running |
| Port already used | Choose another port and match CLI `--url` |
| Silent preview | Browser audio permission/output, track/master gain, mute/solo, active project, current rendered revision |
| MIDI sound differs from another workstation | The internal oscillator does not reproduce all external patches/messages |
| Missing media | Keep project/assets together; inspect `assets` and media recovery |
| Edit rejected as stale | Refresh project/revision and re-evaluate the command against current IDs |
| Time stretch unavailable | Install/configure external FFmpeg, or use other editing operations |
| E2E blocked | Chrome and external Playwright path/cache; this is a test prerequisite |
| Recording fails | Browser permission/device, destination, take/recovery record; test a short capture |

## 13. Uninstall without losing music

1. Save, export important MIDI/mixes, and back up the full project folders outside the application checkout.
2. Stop playback and stop the terminal server with Ctrl+C.
3. Move the cloned `sovaroll-DAW` application folder to Trash after confirming your music is outside it. Default `sessions/` is inside the checkout, so copy it first if you used it.
4. If desired, clear only this app's browser-origin storage after exporting any recoverable takes. Browser storage can hold recovery data and preferences; clearing it deletes those records.
5. Node, Git, Chrome, FFmpeg, Playwright and model runtimes are separate installations. Remove them only if you no longer use them elsewhere.

There is no separate SovaRoll account or background service installed by these startup commands. The server runs while its terminal process is alive.
