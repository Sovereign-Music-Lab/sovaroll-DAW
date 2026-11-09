# Sovereign DAW / SovaRoll

**Authors / Project credits:** [Hee-sung Kang · 강희성](https://ikoffices.com/) · [Do-won Lee · 이도원](https://music.bugs.co.kr/artist/80353758?wl_ref=list_ar_02_search) · [Sungmo Park · 박성모](mailto:vividsaebom@gmail.com)

[Organization](https://github.com/Sovereign-Music-Lab) · [Website](https://sovereign-music-lab.github.io/) · [DeepChord](https://github.com/Sovereign-Music-Lab/DeepChord) · [Sovereign DAW](https://github.com/Sovereign-Music-Lab/sovaroll-DAW) · [Sovereign Flow](https://github.com/Sovereign-Music-Lab/SovaFlow)

## Abstract
**The Sovereign MIDI Workstation · A professional-grade open-source DAW in development**

[한국어](README.ko.md) · [English manual](docs/MANUAL.en.md) · [CLI guide](docs/CLI-GUIDE.en.md) · [한국어 설명서](docs/MANUAL.ko.md) · [Philosophy](PHILOSOPHY.en.md) · [철학](PHILOSOPHY.ko.md)

SovaRoll is Sovereign Music Lab's local MIDI and audio workstation. Its browser interface and CLI share the same project, command engine, validation, and undo history. Keep music editable, work on your own computer, and carry MIDI and audio into the production tools you choose.

**Version 0.129.0 is a development release.** Professional-grade production is the goal. Playback currently uses a rendered audio snapshot; low-latency native audio, plugin hosting, a score editor, and complete English/Korean UI coverage are still future work. The current interface is primarily Korean; both user manuals explain the controls.

## Contents

- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Your daily routine](#your-daily-routine)
- [Using the CLI](#using-the-cli)
- [Philosophy in one minute](#philosophy-in-one-minute)
- [What is here](#what-is-here)
- [The wider workflow](#the-wider-workflow)
- [Continue development with Gemma 4](#continue-development-with-gemma-4)
- [License](#license)
- [Development handoff](#development-handoff)

## Quick start (5 minutes)

You need **Node.js 22+**, Git and desktop Chrome. No `npm install`, account, LLM or model weights.

```sh
git clone https://github.com/Sovereign-Music-Lab/sovaroll-DAW.git
cd sovaroll-DAW
npm start
```

1. Open [http://127.0.0.1:4317](http://127.0.0.1:4317). The first run creates a short synthetic demo in `sessions/`; an existing project is never replaced.
2. Press **Play** (or Space) to hear the demo, and click a MIDI clip to open it in the piano roll.
3. Stop with **Ctrl+C** in the terminal. Closing the tab does not stop the server.

Port 4317 busy? `npm start -- --port 4318`, open that port, and add `--url http://127.0.0.1:4318` to CLI commands.

**Start your own song** (keep it outside the app folder so updates never touch it):

```sh
mkdir -p "$HOME/Music/SovaRoll/My-Song"
node src/cli.mjs init "$HOME/Music/SovaRoll/My-Song/My-Song.newdaw.json"
node src/cli.mjs serve --project "$HOME/Music/SovaRoll/My-Song/My-Song.newdaw.json"
```

## Your daily routine

| Step | In the browser | In a terminal |
|---|---|---|
| 1. Open | Start the server, confirm the project name at the top | `npm start` |
| 2. Safety point | **저장·버전** → save a version before a big edit | `npm run cli -- save-new-version` |
| 3. Make music | Add a MIDI track, click the piano roll, or **가져오기** your own WAV/AIFF/MIDI | `npm run cli -- import FILE.mid` |
| 4. Try and compare | Edit, listen, **Ctrl/Cmd+Z** to compare alternatives | `... command NAME JSON --dry-run`, then without it |
| 5. Mix | Track gain, pan, mute, solo; check mute/solo before export | `npm run cli -- status` |
| 6. Save | **Ctrl/Cmd+S** (edits autosave; Save is your reference point) | `npm run cli -- save` |
| 7. Export | **MIDI 내보내기**, **믹스 WAV 내보내기** | `render`, `export-midi` |
| 8. Back up | **백업 ZIP** | `npm run cli -- export-bundle backup.zip` |
| 9. Stop | Stop playback, then **Ctrl+C** | |

Habits that keep your music safe: keep the project folder together (JSON + `assets/`), keep MIDI and source audio next to every mix you export, and make a backup ZIP before updating. If something goes wrong, see **Troubleshooting** and **Save, recover and move work** in the [manual](docs/MANUAL.en.md).

## Using the CLI

The CLI edits the same project as the browser, with the same validation and undo history. Start with the built-in guide, which works without a server:

```sh
npm run cli -- guide            # routine + topic list
npm run cli -- guide export     # one topic (start, projects, edit, time, import, export, save, media, native)
npm run cli -- --help           # every command and option
```

The routine is **look → dry-run → apply → save**:

```sh
npm run cli -- status                                              # IDs and revision
npm run cli -- command track.add '{"type":"midi","name":"Piano"}' --dry-run
npm run cli -- command track.add '{"type":"midi","name":"Piano"}'
npm run cli -- save
npm run cli -- render sessions/mix.wav
```

Full written guide: [CLI guide](docs/CLI-GUIDE.en.md) · [CLI 가이드](docs/CLI-GUIDE.ko.md). Complete option text: [CLI reference](docs/CLI.md).

## Philosophy in one minute

Read the full [philosophy](PHILOSOPHY.en.md) / [철학](PHILOSOPHY.ko.md). The short version:

- **The musician stays in charge.** Knowledge, intent and listening come from people. A local AI may propose; a person accepts, edits or rejects.
- **Keep music editable.** Notes, timing, velocity, controllers and source audio survive. A rendered WAV never replaces the choices that made it.
- **One engine for people and agents.** Browser and CLI share validation, revision checks and undo, so automation is as inspectable as a click.
- **Independence.** Runs on your computer, keeps local files, uses open formats, and needs no model, account, or sibling project. Integrations are optional.
- **Tech for all.** Readable bilingual docs, backups and reproducible checks are part of real control.
- **Honest scope.** We publish what is implemented, tested, partial or planned. A level meter is not a listening test, and a working prototype is not a finished professional workstation.

## What is here

- MIDI piano roll, note and controller editing, clips, track folders, timing, quantization, step input, and undo/redo.
- WAV/AIFF and MIDI import, audio clip editing, browser recording, mixer controls, and WAV/MIDI/project bundle export.
- Local project files, explicit save, versions, automatic backup/recovery, and media integrity checks.
- One command interface for people and agents, with validation, dry runs, revision conflict checks, and atomic batches.
- Optional macOS CoreMIDI output. It sends MIDI only; it is not synchronized native audio playback.
- Product tests, browser acceptance scripts, development notes, a task queue, and a local-agent harness.

See [development notes](docs/DEVELOPMENT.en.md), [개발 노트](docs/DEVELOPMENT.ko.md), [requirements](docs/agent/REQUIREMENTS.md), [feature inventory](docs/FEATURE_INVENTORY.en.md), and [validation](docs/VALIDATION.md) for the distinction between implemented, tested, and unfinished work.

## The wider workflow

**Human → local LLM (optional RAG / LoRA) → Sovereign DAW → autonomous composition → Logic Pro MCP → result → human feedback → repeat.**

Sovereign DAW is the independent editing workstation. **DeepChord** uses a local LLM to compose while working with Logic Pro. **Sovereign Flow / SovaFlow** is the intended integration workflow connecting the two. These responsibilities are documented in the [philosophy](PHILOSOPHY.en.md); the complete autonomous loop is a development direction, not a bundled feature of this release. SovaRoll runs independently of both projects.

## Continue development with Gemma 4

The maintainer's AI coding workflow after this handoff uses **local Gemma 4 only**. This is a development policy, not a runtime dependency or license restriction. Existing work is not retrospectively attributed to Gemma. No Gemma session is claimed by this publication.

Read [AGENTS.md](AGENTS.md), [CONTINUE.md](CONTINUE.md), and the [Gemma 4 handoff](docs/agent/LOCAL_MODEL.md).

```sh
npm run agent:task -- next
npm run agent:verify:full
npm run test:native
npm run agent:e2e
```

Browser tests require an external Playwright installation and Chrome; time-stretch tests require FFmpeg. See the manuals for setup. Neither is an npm runtime dependency of the DAW.

## License

[Apache License 2.0](LICENSE) · [NOTICE](NOTICE). The full license governs use and redistribution. Separately installed models, runtimes, external tools, and user media keep their own licenses. The Gemma 4 policy adds no restriction to Apache-2.0 permissions.

The project file extension `.newdaw.json`, `NEWDAW_*` environment variables, and some internal identifiers are retained for compatibility.

## Development handoff

[CONTEXT.md](CONTEXT.md) · [Model operations / 모델 운영](docs/MODEL_OPERATIONS.en.md) · [Reusable skill / 재사용 스킬](skills/model-tier-handoff/SKILL.md)

[First Gemma 4 handoff prompt](docs/agent/FIRST_GEMMA_PROMPT.md) — 2026-11-08
