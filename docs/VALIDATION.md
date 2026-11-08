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

## Continuation — T-001–T-009, T-011, T-015 (2026-11-09)

- `npm run agent:e2e`: E2E PASS, 28 first-delivery steps in Chrome. The new `audio.GUI-fade-in-changes-render` step sets a 0.5-second Inspector fade-in, checks asset-frame conversion, compares mono-sum RMS windows in CLI renders before and after the edit, and verifies Undo removes the fade.
- `npm run agent:verify`: VERIFY PASS for the public guard and all JavaScript syntax. The verification tool skipped unit tests because this change only touched the GUI smoke script and had no related unit test file.
- T-001 changed no product code and covered fade-in only. PCM measurements do not establish listening quality.
- T-002 `npm run agent:e2e`: E2E PASS, 30 steps. New mute and polarity steps verify Inspector state, `muted-clip`, CLI-rendered PCM and Undo. With other tracks excluded, recorded-region mono-sum RMS fell from 0.0975930279 to 0; a fixed PCM sample changed from -0.1178283691 to +0.1178283691 after polarity inversion.
- The first T-002 run found that Chrome's default fake microphone produced a silent recording, so it could not provide a meaningful mute baseline. The smoke now supplies a deterministic tone WAV to Chrome's fake audio capture; no assertion was weakened. The rerun and final `npm run agent:verify` passed, with the same guard/syntax scope and no related unit tests.
- T-003 `npm run agent:e2e`: E2E PASS, 31 steps. `audio.GUI-normalize-sets-clip-gain` verifies a -1 dBFS target produces approximately +6.96 dB clip gain, no non-gain clip fields change, source WAV SHA-256 remains unchanged, and Undo restores the previous gain. Final `npm run agent:verify`: VERIFY PASS with the same guard/syntax scope and no related unit tests.
- T-004 `npm run agent:e2e`: E2E PASS, 32 steps. `playback.GUI-cycle-loops-locator-range` sets locators to 0..3840 ticks, checks Cycle project/ARIA state, samples transport time for about three seconds within 0..2.15 seconds, observes a wrap, and verifies Stop and Cycle off. This is transport evidence, not a listening claim. Final `npm run agent:verify`: VERIFY PASS with the same guard/syntax scope and no related unit tests.
- T-005 added `scripts/gui-new-project-delivery-smoke.mjs`. `npm run agent:e2e -- scripts/gui-new-project-delivery-smoke.mjs`: E2E PASS, 4 steps covering GUI Untitled creation, first MIDI track, first Save-as, server restart on the saved path and the preserved track. The initial project bytes remained unchanged and script project writes stay inside its temporary folder. The default `npm run agent:e2e` also passed all 32 steps; final `npm run agent:verify` passed guard/syntax with no related unit tests.
- T-006 `npm run agent:e2e`: E2E PASS, 34 steps. `midi.GUI-tools-transpose` checks every selected first-part note moves +2 semitones and Undo restores its pitch; `midi.GUI-tools-velocity` checks Set 54 on every selected note and Undo restores prior velocities. Note counts remain unchanged for export. Quantize retains its previous first-delivery coverage status. Final `npm run agent:verify`: VERIFY PASS with no related unit tests.
- T-007 `npm run agent:e2e`: E2E PASS, 35 steps. With focus on `#timeline-scroll`, `project.GUI-keyboard-undo-redo` verifies ControlOrMeta+Z reverts the last track-name edit with a revision increase and ControlOrMeta+Shift+Z reapplies it with another revision increase. Final `npm run agent:verify`: VERIFY PASS with no related unit tests.
- T-008: `npm run agent:e2e -- scripts/gui-recording-protection-smoke.mjs` passed all 6 steps and `npm run agent:e2e -- scripts/gui-recording-workflow-smoke.mjs` passed all 4 steps, unchanged. Coverage includes non-zero fake-microphone PCM, one-commit clip import, audio edit/render/reopen, cancel preserving the project and a concurrent project change preserving WAV without import. No test drift or product code change; physical devices remain unverified.
- T-015 reproduced the intermittent pan timeout by delaying the gain POST response for 200 ms while allowing SSE to advance the browser revision first. The old helper timed out after 23 steps with `sseAdvancedBeforeResponse: true`, `busyWhileResponseDelayed: true`, gain HTTP 200 and no HTTP errors. The helper had waited for a nonexistent `aria-busy` ancestor; it now waits for `#project-name.disabled === false`, which is driven by the real command busy state. The rerun passed all 35 steps, recorded one pan request with `expectedRevision: 36` and `pan: 0.3`, and preserved all assertions and timeouts. This was a test synchronization race; no product code changed. Final `npm run agent:verify`: VERIFY PASS with no related unit tests.
- T-009 added `npm run agent:smoke-sweep`. The sweep completed all 64 unique GUI smokes sequentially: 45 passed and 19 failed, including one first-delivery run and one new-project-delivery run. The command exited 1 to report the failures after writing every result to `.test-output/smoke-sweep.json`; this is not a passing-suite claim. Result validation confirmed all required fields and exactly one follow-up for each failure, registered as T-017–T-035. No existing smoke or product code was changed. Generated screenshots were retained under `.test-output/smoke-sweep-screenshots/`. `node --check scripts/agent/smoke-sweep.mjs`, `npm run agent:guard` and final `npm run agent:verify` passed.
- T-011 moved audio/Web MIDI recording hosts into one closed-by-default `details#recording-panel` without changing control IDs. The panel opens during prepare/record/save states. The default E2E passed 36 steps, including collapsed placement/host checks and automatic opening during recording; recording workflow passed 4 steps and protection passed 6 steps after opening the panel through its direct summary. Before/after screenshots are `.test-output/recording-panel-before.png` and `.test-output/recording-panel-after.png`. Final `npm run agent:verify`: VERIFY PASS. Physical devices and listening remain unverified.

## Problems encountered and resolved

- Initial native-test invocation reported `NATIVE_BUILD_REQUIRED`. Built the bridge and verified 97 tests. `pretest:native` now builds the bridge before `npm run test:native` so a fresh checkout has an explicit prerequisite step.
- The first browser run completed all 27 steps but failed when writing its report because `.test-output/` did not exist. The E2E wrapper now creates the directory. A subsequent run finished with `E2E PASS`.
- A fresh-tree browser run timed out while awaiting the audio-pan revision after the seek stage. Its screenshot and report were inspected; a rerun of the unchanged source and test passed all 27 steps. T-015 later reproduced and resolved the test synchronization race as recorded below. No timeout or behavioral assertion was relaxed.
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

2026-11-09 T-001에서는 Chrome 첫 납품 흐름 28단계와 `agent:verify`가 통과했습니다. 새 `audio.GUI-fade-in-changes-render` 단계는 Inspector 페이드 인 0.5초, CLI 렌더의 모노 합성 RMS 변화, Undo를 확인했습니다. 제품 코드는 바꾸지 않았습니다.

T-002에서는 클립 뮤트·극성 반전·Undo 검사를 추가한 30단계가 통과했습니다. 기본 가짜 마이크가 무음을 녹음한 첫 실패를 확인하고 결정적 톤 WAV를 입력해 기준 RMS 0.0975930279를 확보했으며, 뮤트 후 RMS는 0이었습니다. 극성 고정 샘플은 -0.1178283691에서 +0.1178283691로 반전됐습니다. 최종 `agent:verify`도 통과했고 제품 코드는 변경하지 않았습니다.

T-003에서는 노멀라이즈 검사를 추가한 31단계와 최종 `agent:verify`가 통과했습니다. -1 dBFS 대상이 클립 gain을 약 +6.96 dB로 설정하고, 다른 클립 속성과 원본 WAV SHA-256은 유지하며, Undo가 이전 gain을 복원함을 확인했습니다. FD-20의 페이드 아웃 E2E는 아직 남아 있습니다.

T-004에서는 Cycle 검사를 추가한 32단계와 최종 `agent:verify`가 통과했습니다. Locator 0..3840 tick, Cycle 프로젝트·ARIA 상태, 약 3초간 전송 위치의 0..2.15초 범위와 실제 루프 역행, Stop과 Cycle 해제를 확인했습니다. 이는 청음이 아닌 전송 상태 검증입니다.

T-005에서는 새 프로젝트 전용 스모크 4단계가 통과했습니다. GUI Untitled 생성, 첫 MIDI 트랙 추가, 첫 Save-as, 저장 경로로 서버를 재시작한 뒤 같은 트랙 확인을 검증했습니다. 기존 프로젝트 바이트는 변하지 않았고 스크립트의 프로젝트 쓰기는 임시 폴 낸으로 제한했습니다. 기본 E2E 32단계와 최종 `agent:verify`도 통과했습니다.

T-006에서는 MIDI 도구 검사를 추가한 34단계와 최종 `agent:verify`가 통과했습니다. 첫 파트의 선택한 모든 노트를 +2 semitone 전조하고 Undo로 복원했으며, velocity를 54로 설정하고 Undo로 각 원래 값을 복원했습니다. 노트 수는 유지됩니다. 퀀타이즈는 기존 첫 납품 E2E 범위 상태를 유지합니다.

T-007에서는 키보드 Undo/Redo 검사를 추가한 35단계와 최종 `agent:verify`가 통과했습니다. `#timeline-scroll` 포커스에서 ControlOrMeta+Z로 마지막 트랙 이름 편집을 되돌리고 ControlOrMeta+Shift+Z로 다시 적용했으며, 두 revision 증가를 확인했습니다.

T-008에서는 기존 녹음 보호 스모크 6단계와 녹음 워크플로 스모크 4단계가 수정 없이 harness에서 통과했습니다. 가짜 마이크의 비무음 PCM, 클립 한 번 커밋, 오디오 편집·렌더·재열기, 취소 시 프로젝트 불변, 녹음 중 다른 편집 시 WAV 보관을 확인했습니다. 테스트나 제품 코드 변경은 없으며 실제 장치 검증은 하지 않았습니다.

T-015에서는 gain POST 응답을 200ms 늦추고 SSE가 먼저 revision을 갱신하게 해 pan timeout을 재현했습니다. 기존 헬퍼는 23단계 후 멈췄고 SSE 선행 갱신·busy 비활성화·HTTP 200을 기록했습니다. 존재하지 않는 `aria-busy` 대신 실제 busy와 연동된 `#project-name.disabled === false`를 기다리게 수정한 뒤 전체 35단계가 통과했습니다. pan 요청은 `expectedRevision: 36`, `pan: 0.3`으로 한 번 전송됐습니다. timeout과 행동 검증은 유지했고 제품 코드는 변경하지 않았습니다.

T-009에서는 `agent:smoke-sweep`을 추가해 고유한 GUI 스모크 64개를 순차 실행했고 45개 통과·19개 실패를 기록했습니다. 명령은 모든 결과를 `.test-output/smoke-sweep.json`에 저장한 뒤 실패를 알리기 위해 종료 코드 1을 반환했으며, 전체 통과로 표현하지 않습니다. 결과 필드와 first-delivery 중복 없음을 검증하고 실패별 후속 작업 T-017~T-035를 하나씩 등록했습니다. 기존 스모크와 제품 코드는 수정하지 않았습니다. 생성 스크린샷은 `.test-output/smoke-sweep-screenshots/`에 보관했고 syntax·guard·최종 verify가 통과했습니다.

T-011에서는 오디오·Web MIDI 녹음 컨트롤을 기본으로 접힌 `details#recording-panel` 하나로 통합하고 ID는 그대로 유지했습니다. 준비·녹음·저장 중에는 자동으로 열립니다. 접힘 상태의 위치·호스트와 녹음 중 자동 열림을 포함한 기본 E2E 36단계, 녹음 워크플로 4단계, 보호 6단계가 통과했습니다. 전후 화면은 `.test-output/recording-panel-before.png`와 `.test-output/recording-panel-after.png`에 저장했습니다. 최종 verify도 통과했으며 실제 장치와 청음은 검증하지 않았습니다.
