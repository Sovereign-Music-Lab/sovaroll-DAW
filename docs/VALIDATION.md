# Release validation / 공개 검증

Release: SovaRoll 0.129.0 · 2026-11-08 · macOS arm64, Node.js and desktop Chrome.

This record separates software checks, current limitations, and unperformed work. The application is still under development toward a professional-grade DAW.

## Observed checks

| Check | Result and scope |
|---|---|
| `npm run agent:verify:full` | VERIFY PASS: protected-data/acceptance guard, JavaScript syntax, 171 product test files |
| Inherited tests | All 170 original product test files and seven native test files retained byte-for-byte |
| Public-guard regression | Three new tests: a valid standalone catalogue passes; missing/duplicate IDs fail without modifying evidence; protected fixture changes and test deletion fail |
| Native bridge and tests | Swift/CoreMIDI build succeeded; all 97 native tests passed with virtual test destinations |
| `npm run agent:e2e` | E2E PASS: 27 first-delivery steps in Chrome, isolated project and fake microphone |
| Fresh source tree | Default demo/server/GUI/API start passed without npm installation, build artifacts or sibling repositories; first-delivery E2E passed on retry with unchanged assertions |
| Reusable handoff skill | Skill validator passed; English CONTEXT.md template and paired operating guides included |

Browser acceptance covers project creation, MIDI input/drag/Inspector/clipboard/repeat/split/undo, audio import/recording/move/split/trim/source preservation, playback/seek/mixer, WAV/MIDI/bundle export, GUI/CLI equality, save/restart/reopen, and identical render output after restart.

## Problems encountered and resolved

- Initial native-test invocation reported `NATIVE_BUILD_REQUIRED`. Built the bridge and verified 97 tests. `pretest:native` now builds the bridge before `npm run test:native` so a fresh checkout has an explicit prerequisite step.
- The first browser run completed all 27 steps but failed when writing its report because `.test-output/` did not exist. The E2E wrapper now creates the directory. A subsequent run finished with `E2E PASS`.
- A fresh-tree browser run timed out while awaiting the audio-pan revision after the seek stage. Its screenshot and report were inspected; a rerun of the unchanged source and test passed all 27 steps. The cause is not established, and follow-up T-015 tracks this intermittent failure. No timeout or assertion was relaxed.
- Public distribution checks inspect source and documentation while preserving the original private archive. Illustrative UI placeholders such as `/Users/…/` are generic examples, not user paths. Personal sessions, source collections, credentials and generated runtime artifacts are excluded.

No existing product assertions were deleted or weakened to resolve these issues. Product behavior was preserved; release edits primarily concern branding, descriptive metadata, documentation and portable developer tooling.

## Unverified and unfinished

- Physical microphone/speaker listening, device latency and subjective music quality were not evaluated by these checks.
- Gemma 4 26B / MLX on M5 Pro 24 GB is the requested next coding environment, not a completed inference benchmark. Its exact artifact, quantization, tool support and context capacity remain to be measured.
- Automated acceptance does not finish all tasks. T-001–T-013 retain their existing states, including the unresolved T-010 snap decision.
- Full bilingual UI, low-latency native audio, external plugin hosting and the complete autonomous composition feedback loop are future development.

## 한국어

전체 제품 검사 171개 파일, native 테스트 97개, Chrome 첫 납품 흐름 27단계가 통과했습니다. 기존 제품 170개·native 7개 테스트 파일을 바꾸지 않고 공개 guard 회귀 테스트 3개를 추가했습니다. native 미빌드와 테스트 결과 폴더 부재는 준비 절차로 해결했으며 테스트 조건을 약하게 만들지 않았습니다.

가짜 마이크·가상 MIDI 목적지·수치 검사는 실제 장치 청음과 지연, 음악적 품질을 증명하지 않습니다. Gemma 실행 성능이나 전체 자율형 작곡 연동도 검증하지 않았습니다. 구현·검증·계획 상태를 구분하고 남은 작업 큐를 유지합니다.
