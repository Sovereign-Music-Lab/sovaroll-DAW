# Sovereign DAW / SovaRoll

**Authors / Project credits:** [Hee-sung Kang · 강희성](https://ikoffices.com/) · [Do-won Lee · 이도원](https://music.bugs.co.kr/artist/80353758?wl_ref=list_ar_02_search) · [Sungmo Park · 박성모](mailto:vividsaebom@gmail.com)

[Organization](https://github.com/Sovereign-Music-Lab) · [Website](https://sovereign-music-lab.github.io/) · [DeepChord](https://github.com/Sovereign-Music-Lab/DeepChord) · [Sovereign DAW](https://github.com/Sovereign-Music-Lab/sovaroll-DAW) · [Sovereign Flow](https://github.com/Sovereign-Music-Lab/SovaFlow)

## Abstract
**The Sovereign MIDI Workstation · A professional-grade open-source DAW in development**

[한국어](README.ko.md) · [English manual](docs/MANUAL.en.md) · [한국어 설명서](docs/MANUAL.ko.md) · [Philosophy](PHILOSOPHY.en.md) · [철학](PHILOSOPHY.ko.md)

SovaRoll is Sovereign Music Lab's local MIDI and audio workstation. Its browser interface and CLI share the same project, command engine, validation, and undo history. Keep music editable, work on your own computer, and carry MIDI and audio into the production tools you choose.

**Version 0.129.0 is a development release.** Professional-grade production is the goal. Playback currently uses a rendered audio snapshot; low-latency native audio, plugin hosting, a score editor, and complete English/Korean UI coverage are still future work. The current interface is primarily Korean; both user manuals explain the controls.

## Contents

- [Start](#start)
- [What is here](#what-is-here)
- [The wider workflow](#the-wider-workflow)
- [Continue development with Gemma 4](#continue-development-with-gemma-4)
- [License](#license)
- [Development handoff](#development-handoff)

## Start

Install **Node.js 22 or newer** and Git. Use a current desktop Chrome for the browser workflow validated here. No npm package installation, LLM, model weights, account, or companion repository is required for basic operation.

```sh
git clone https://github.com/Sovereign-Music-Lab/sovaroll-DAW.git
cd sovaroll-DAW
npm start
```

Open [the local workstation](http://127.0.0.1:4317). The first start creates a short synthetic demo in `sessions/`; an existing project is preserved. Stop with **Ctrl+C** in the terminal. The [manual](docs/MANUAL.en.md) covers a blank project, normal daily use, saving, backups, exports, troubleshooting, updating, and uninstalling without losing music.

If port 4317 is occupied:

```sh
npm start -- --port 4318
```

Then open [port 4318](http://127.0.0.1:4318) and add `--url http://127.0.0.1:4318` to commands that connect to that server.

## What is here

- MIDI piano roll, note and controller editing, clips, track folders, timing, quantization, step input, and undo/redo.
- WAV/AIFF and MIDI import, audio clip editing, browser recording, mixer controls, and WAV/MIDI/project bundle export.
- Local project files, explicit save, versions, automatic backup/recovery, and media integrity checks.
- One command interface for people and agents, with validation, dry runs, revision conflict checks, and atomic batches.
- Optional macOS CoreMIDI output. It sends MIDI only; it is not synchronized native audio playback.
- Product tests, browser acceptance scripts, development notes, a task queue, and a local-agent harness.

See [development notes](docs/DEVELOPMENT.en.md), [개발 노트](docs/DEVELOPMENT.ko.md), [requirements](docs/agent/REQUIREMENTS.md), and [validation](docs/VALIDATION.md) for the distinction between implemented, tested, and unfinished work.

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
