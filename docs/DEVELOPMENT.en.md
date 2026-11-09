# Development notes — Sovereign DAW / SovaRoll

[한국어](DEVELOPMENT.ko.md) · [Philosophy](../PHILOSOPHY.en.md) · [Feature inventory](FEATURE_INVENTORY.en.md) · [Validation](VALIDATION.md)

## Direction and release boundary

Sovereign DAW is a professional-grade open-source DAW project. The public code version is **0.129.0**, with a local MIDI/audio engine and browser interface. The release includes implementation, product tests, browser scripts, architecture, a module map, an acceptance catalogue, and the outstanding work queue. Current evidence belongs in the validation record; a roadmap item is not an implemented feature.

**Sovereign DAW** describes the mission, **SovaRoll** is the project name, and **sovaroll-DAW** is this repository. Existing `.newdaw.json` files and `NEWDAW_*` settings remain compatible.

## Design decisions

| Decision | Reason and current consequence |
|---|---|
| Local Node.js server, browser GUI, CLI | Both interfaces share state and persistence instead of separate editing behavior |
| Shared command engine | Validation, revision checks, batches and undo/redo apply to human and automated edits |
| Editable MIDI and non-destructive audio | Preserve musical decisions and source media after editing and rendering |
| Render workers and snapshot preview | Render a stable revision and reject stale results; preparation latency remains a limitation |
| Explicit project and media operations | Opening, collecting, recovering and replacing media expose plans or verification where appropriate |
| Small-task agent harness | Local models can inspect bounded excerpts, recover from errors and produce evidence |
| Independent repositories | Core operation does not install DeepChord, SovaFlow or an LLM |

See [architecture](agent/ARCHITECTURE.md), [module/command map](agent/CODEMAP.md), and [CLI reference](CLI.md).

## Development milestones

This summarizes implemented work; verification depth differs by feature.

| Stage | Work represented in the current code |
|---|---|
| Early editor/project workflow | Shared GUI/CLI editing, clips/tracks, save/reopen, undo history, versions, backup/recovery, media integrity and collection |
| v0.12–v0.20 | MIDI channel events, controllers and editable curves, lane settings, modifiers/freeze, merge, bend editing and chase |
| v0.21–v0.23 | macOS CoreMIDI output, MIDI reset policies, display PPQ and note-length adjustment |
| v0.24–v0.33 | Musical/elapsed time conversion, formatted input, ruler spacing, note/controller snapping and consistent coordinates |
| v0.34–v0.46 | Controller draw/paint/shapes, velocity/release-velocity shapes, audition workers with cancellation and stale-result protection |
| v0.48–v0.78 | Velocity cursor, repeats, clipboard/paste-time behavior, keyboard/selection, locators, split policies and regression work |
| Later work through v0.128 | Track folders/ordering, audio editing/processing, recording, tempo/markers, exports, MIDI input and browser integration |
| v0.129 | Structured invalid-tempo errors, corrected audio range validation, piano-ruler clipboard focus repair, favicon and stale test expectations |
| Initial public release | SovaRoll branding, Apache-2.0, bilingual philosophy/manuals/development notes, public acceptance checks and Gemma 4 handoff |

These notes describe this repository's behavior and testable decisions. They make no unsupported claim that another workstation's code was copied, certify no unperformed provenance audit, and assert no product equivalence.

## Feature groups and limits

| Group | Current implementation | Boundary |
|---|---|---|
| Project/workspace | Multiple projects, active-document plans, recent files, explicit save, save-as/version, undo history, auto backup/recovery | Preserve the whole folder and sidecars; JSON alone does not contain source audio |
| MIDI | Note edit/selection/clipboard, quantization, step input, controllers/curves, events, modifiers, merge/freeze, import/export | The simple internal oscillator does not render every preserved MIDI event |
| Arrangement | Clips, folders, ordering, locators, markers, timing and tempo | Larger sessions and all platform/input combinations need more testing |
| Audio | WAV/AIFF, trim/split/slip, gain/fades/polarity, normalize/DC, statistics, optional FFmpeg tempo processing | Snapshot preview is not a low-latency native engine; format and processing limits apply |
| Recording | Browser audio/Web MIDI in a collapsible panel that opens while recording is active, take preservation, count-in and monitoring | Fake-device tests do not establish hardware quality, latency or permission behavior |
| Mixing/export | Track/master controls, EQ/effects, mix/stems, MIDI and project bundles | External plugin/instrument hosting and advanced mastering are unfinished |
| Native MIDI | Optional macOS bridge, routing, cancellation, reset/chase policies | MIDI output only; no synchronized native audio or cross-platform native backend claim |
| Native audio foundation | Optional native preview routes a completed WAV through the AVAudioEngine helper; offline rendering preserves mono/stereo PCM and GUI Stop controls the current job | Explicit opt-in only; built-in preview remains default; no native-MIDI synchronization, listening or low-latency quality claim |
| Audio Unit discovery | On-demand server/GUI discovery, exact-ID selection, explicit instantiation, deterministic offline PCM processing, processed WAV download, whole-mix/locator-range modes, all/selected-track and all/selected-clip rendering, editable clip import with Undo and bounded server/GUI numeric parameter inspection, range-checked setting and per-parameter default restoration and server/GUI explicit-output Play/Stop/Status preview lifecycle for scoped render jobs | No automatic loading or default playback change; active instances lock component discovery/selection until release; whole-mix import uses the cursor and locator-range import uses the server-recorded range start; parameter control uses generic numeric fields without custom plugin GUI or realtime automation; job-based preview does not synchronize native MIDI or replace the default transport; compatibility, listening and low-latency quality remain unverified |

See the [manual](MANUAL.en.md) and [individual acceptance boundaries](agent/REQUIREMENTS.md).

## Open work

The Audio Unit probe supports downloadable output, editable clip import, explicit preview controls and native offline instrument MIDI rendering through a fresh instance per render. Full real-time plugin/instrument hosting and GUI instrument assignment remain future work. All 64 existing GUI smokes passed before this native work. Human hardware results still use [the manual checklist](agent/MANUAL_CHECKS.md). Evidence is recorded in [VALIDATION.md](VALIDATION.md).

Longer-term goals include low-latency native audio, broader plugins/instruments, score editing, deeper mixing, complete bilingual UI, accessibility, more platform/device validation, and the optional autonomous composition loop.

## Gemma 4 and evidence

After this handoff, the maintainer plans to use local **Gemma 4 only** for AI coding. The harness constrains and checks work performed by an external coding runtime; it does not host or select a model. No Gemma task run is claimed here. Existing product test assertions are retained. Public acceptance checks work without a separate source collection.

New behavior needs meaningful tests. Release validation includes the full product suite, native suite, first-delivery browser acceptance, publication checks and a fresh-tree launch. Listening and hardware latency remain manual work. Record failures rather than weakening tests.

## Wider architecture

DeepChord's role is local-LLM composition while working with Logic Pro. Sovereign Flow / SovaFlow connects both tools:

**Human → LLM (optional RAG / LoRA) → Sovereign DAW → autonomous composition → Logic Pro MCP → result → human feedback → repeat.**

Each tool retains its essential implementation and installation path. An adapter may connect them; a missing adapter must not prevent the DAW from editing and exporting. Verify each integration before describing it as available.
