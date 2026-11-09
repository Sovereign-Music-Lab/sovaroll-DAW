# Feature inventory — Sovereign DAW / SovaRoll

[한국어](FEATURE_INVENTORY.ko.md) · [Development](DEVELOPMENT.en.md) · [Validation](VALIDATION.md)

Updated: 2026-11-09. Generate the source-derived report with `npm run agent:features`. It writes `.test-output/feature-inventory.json`, including source file names and identifier arrays.

## Is the claimed 2,500-feature set complete?

**This cannot be verified, and no such completion is claimed.** Repository inspection found no 2,500-item feature specification or checklist. There is no authoritative source list against which to certify that coverage. An external 2,500-item list would need explicit definitions and acceptance criteria for a meaningful comparison.

The following counts are different structural dimensions. **Do not add them together and call the result a feature count.**

| Observed dimension | Count | Meaning and boundary |
|---|---:|---|
| Engine commands | 144 | Unique command entries parsed from `src/core/schema.mjs` |
| Literal API route strings | 92 | Unique `/api/` strings in `src/server.mjs`; not a complete HTTP route taxonomy |
| Native helper commands | 19 | Commands across the MIDI, audio and Audio Unit Swift helpers |
| Literal UI IDs | 865 | Per-file IDs in the HTML/public modules; includes duplicates across files and IDs that are not features |
| Declared product tests | 1,518 | Test declarations in 174 product test files; loops and runtime conditions can change execution count |
| Declared native tests | 112 | Current native test declarations |
| GUI check IDs | 764 | Literal check IDs in GUI scripts; some scripts have conditional or environment-limited paths |
| Product acceptance IDs | 30 | Stable FD-01–FD-30 identifiers, retained by the public guard |

## Current capability scope

| Area | Current status | Important boundary |
|---|---|---|
| Project/workspace | Implemented and browser/product tested | Preserve the project folder and managed media; human recovery decisions remain |
| MIDI editing | Broad implemented command set with GUI/CLI history | Internal oscillator does not reproduce every preserved MIDI event |
| Audio recording/editing | WAV/AIFF import, recording and non-destructive edits tested | Fake-device browser tests are not physical microphone quality/latency checks |
| Mixing/export | Internal mixer, mix/stem/MIDI/bundle paths tested | Advanced mastering and full routing parity are not claimed |
| Native MIDI | macOS routing, timing, Chase and reset lifecycle tested with virtual endpoints | No cross-platform backend claim |
| Native audio | Optional job-based AVAudioEngine preview plus cancellable host-time scheduled starts | No low-latency engine or synchronized native-MIDI/audio transport claim |
| Audio Unit effects | Explicit discovery/instantiation, numeric parameters, selected scope, offline WAV/import and preview controls | Tested with available system components; no general third-party compatibility claim |
| Audio Unit instruments | Selected MIDI clips render through a fresh native instrument instance into editable audio clips with Undo; native real-time MIDI playback has lifecycle coverage with zero output gain | No realtime instrument MIDI hosting or broad third-party compatibility claim |
| Languages/accessibility | Primary workspace Korean/English switching | Advanced dialogs and complete accessibility are unfinished |
| Autonomous composition integration | Future/optional architecture | The DAW operates independently; no complete autonomous feedback-loop claim |

The detailed evidence remains in [VALIDATION.md](VALIDATION.md), and acceptance boundaries are in [agent/REQUIREMENTS.md](agent/REQUIREMENTS.md). `tests/feature-inventory.test.mjs` verifies report structure, unique source identifiers, all 30 acceptance IDs and the explicit unverified status of the 2,500-feature claim.
