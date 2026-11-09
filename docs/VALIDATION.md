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

## Continuation — T-001–T-013, T-015, T-017–T-052 (2026-11-09)

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
- T-012 added `tests/long-project-render-integration.test.mjs`: both tests passed. A 150-second project with a MIDI note at 140 seconds rendered through the real CLI at 48 kHz with at least 150 seconds of frames and non-zero PCM at 140 seconds. A 601-second render returned `CLI_ERROR`/`RENDER_FAILED` with the 600-second limit message, preserved project bytes and created no output. A standalone GUI probe with `probeExecArgv: []` played successfully and advanced `00:00.010` to `00:00.714` before Stop; no silent failure or follow-up was needed. An earlier inline probe's inherited `--input-type=module` worker error was discarded as a probe artifact. `node --test tests/long-project-render-integration.test.mjs` and final `npm run agent:verify` passed.
- T-017 reproduced `gui-controller-bend-smoke.mjs` failing after 2 checks. The failure screenshot showed `화면 크기가 바뀌어 드래그를 취소했습니다.` A full-page screenshot during an active drag caused viewport resize and triggered the intended ResizeObserver cancellation. Only that evidence capture now uses `fullPage: false`; all gestures, assertions and product code remain unchanged. The targeted E2E passed all 13 steps and final `npm run agent:verify` passed.
- T-018 reproduced `gui-controller-paint-smoke.mjs` failing before browser launch. New server projects default to fixed tempo (`tempoTrackEnabled: false`), so the old fixture's multi-point `tempo.set` was rejected. Enabling `tempo.mode` before setting the map preserves the intended tempo-map test without weakening assertions. The targeted E2E passed all 16 steps and final `npm run agent:verify` passed.
- T-019 reproduced the same fixed-tempo fixture rejection in `gui-controller-shapes-smoke.mjs`. Adding `tempo.mode enabled:true` before `tempo.set` resolved that drift without changing gestures or assertions. All 23 targeted E2E steps and final `npm run agent:verify` passed.
- T-020 reproduced the same fixed-tempo rejection in `gui-controller-snap-smoke.mjs` and applied the same fixture-only `tempo.mode` enablement. All 13 targeted E2E steps and final `npm run agent:verify` passed with assertions unchanged.
- T-021 reproduced `gui-document-smoke.mjs` timing out at its first import. The script bypassed the Import options and submitted a null draft, which the current GUI correctly rejects with a retry notice. `importSource` now opens Import, chooses the file through the real chooser and checks the same HTTP/project state. All 17 targeted steps and final `npm run agent:verify` passed.
- T-022 reproduced the same null-draft import timeout in `gui-drafts-smoke.mjs` and routed its upload through the real Import options and chooser. All 17 targeted steps and final `npm run agent:verify` passed without changing assertions.
- T-023 is resolved after focused investigation. The stale MIDI conflict now checks the intentional warning and closes with Escape. DOM ancestry proved `clip-tools-button` is inside closed `details#arrangement-edit-menu`; the smoke now opens its direct summary before every clip-tools click, rather than forcing clicks or changing layout. Track duplication now submits the actual confirmation dialog, and reorder uses stable `[data-track-edit="up"]`. The full targeted E2E passed all 14 steps. No product code changed; final `npm run agent:verify` passed.
- T-024 reproduced a timeout after 12 MIDI-event checks. The export format control lives in a dialog that closes after download, so the smoke now opens `#midi-export-dialog` before each SMF 0/1 export. All 16 targeted steps and final `npm run agent:verify` passed without product changes.
- T-025 reproduced the MIDI-modifiers freeze timeout after 8 checks. The implementation now reports `저장된 출력을 확정`, while the smoke waited for the older `실제 이벤트로 확정` phrase. Only the completion-text wait changed; revision, source, MIDI output, reset, no-op and Undo/Redo assertions remain. All 12 targeted steps and final `npm run agent:verify` passed.
- T-026 reproduced the first render timeout in `gui-midi-playback-smoke.mjs`: the test opened the export dialog but never submitted it. The render helper now clicks `#mix-export-submit`, preserving every PCM/Web Audio assertion. All 11 targeted steps and final `npm run agent:verify` passed without product changes.
- T-027 reproduced the fixed-tempo multi-point map rejection in `gui-note-object-smoke.mjs`. Enabling `tempo.mode` before `tempo.set` preserved the fixture's intent and all assertions. All 24 targeted steps and final `npm run agent:verify` passed without product changes.
- T-028 reproduced the same fixed-tempo rejection in `gui-note-paint-smoke.mjs` and applied the same fixture-only tempo-mode enablement. All 23 targeted steps and final `npm run agent:verify` passed with assertions unchanged.
- T-029 reproduced the same rejection in `gui-note-shapes-smoke.mjs`. Enabling tempo-track mode before `tempo.set` preserved every shape, source and history assertion. All 20 targeted steps and final `npm run agent:verify` passed.
- T-030 reproduced `gui-projects-smoke.mjs` waiting for a render after only opening the export dialog. Adding `#mix-export-submit` starts the actual job and preserves the media assertions. All 20 targeted steps and final `npm run agent:verify` passed without product changes.
- T-031 reproduced the closed-menu clip-tools timeout in `gui-split-controller-policy-smoke.mjs`. Both clip-tool clicks now open `arrangement-edit-menu` through its direct summary. All 4 targeted steps and final `npm run agent:verify` passed without changing assertions or product code.
- T-032 reproduced the same closed-menu timeout in `gui-split-note-policy-smoke.mjs` and opens the direct summary before both actions. All 3 targeted steps and final `npm run agent:verify` passed without product changes.
- T-033 reproduced the same initial timeout in `gui-split-settings-race-smoke.mjs` and opens the menu before every clip-tools action, including preference save/reopen and conflict coverage. All 8 targeted steps and final `npm run agent:verify` passed.
- T-034 reproduced the same closed-menu timeout in `gui-split-settings-smoke.mjs` and opens the direct summary before every action. All 6 targeted steps and final `npm run agent:verify` passed without product changes.
- T-035 reproduced workspace render timeouts after 6 and 20 checks. Both the normal render and delayed-render gate now submit `#mix-export-submit`, preserving media and stale-render assertions. All 21 targeted steps and final `npm run agent:verify` passed without product changes.
- T-013 added bilingual `docs/agent/MANUAL_CHECKS.md` with six numbered real-device steps, expected results and empty observation columns. FD-16/21/22 link to it. Structural checks and `npm run agent:guard` passed. This documents work for a human; no microphone, speaker, listening or latency verification is claimed.
- The post-follow-up `npm run agent:smoke-sweep` completed with exit 0: all 64 unique GUI smokes passed, with one first-delivery run. Results are in `.test-output/smoke-sweep.json`; generated screenshots remain under `.test-output/final-smoke-sweep-screenshots/`.
- T-010 records the maintainer's explicit Snap decision before code. Ruler clicks now snap through the current primary/piano grid, while Alt/Option preserves exact position. The default E2E passed 37 steps, including `playback.GUI-ruler-click-snap-and-alt-override` on both rulers and the Alt path; final `npm run agent:verify` passed.
- T-036 adds `audio.GUI-fade-out-changes-render`: Inspector 0.5-second fade-out is checked in asset frames, CLI-rendered ending RMS decreases against the matching baseline and attenuates more than the fade's beginning, and Undo removes it. The default E2E passed 38 steps and final `npm run agent:verify` passed. FD-20 is now verified for fade-in/out, mute, polarity and normalize within the tested scope.
- T-037 adds `midi.GUI-tools-quantize`: a known off-grid note at tick 25 is quantized to 0 using the selection's 1/16 grid, note count is unchanged, and Undo restores tick 25. The default E2E passed 39 steps and final `npm run agent:verify` passed. FD-14 now has first-delivery coverage for quantize, transpose and velocity.
- T-038 adds `scripts/gui-auto-backup-recovery-smoke.mjs`: 4 steps pass for GUI track creation, GUI backup/listing, independent CLI `recover-backup` and opening the recovered project through the GUI with the original track/clip. Original project bytes stay unchanged and all files use a temporary folder. The default 39-step E2E and final `npm run agent:verify` passed. FD-04 evidence now covers this supported recovery path.
- T-039 adds `scripts/gui-recording-assistance-smoke.mjs`: 4 steps pass for input selection, non-zero baseline PCM, count-in (4 oscillators), backing buffer (4.2 seconds), monitor path, stereo capture and metronome scheduling. Measured -6 dB capture gain ratio is 0.5011878275. Existing recording workflow/protection pass 4/6 steps and final `npm run agent:verify` passed. Fake-device/Web Audio evidence does not replace physical-device checks.
- T-040 adds a persisted Korean/English selector for the primary transport, arrangement and recording workspace, preserving existing IDs and Korean defaults. The new E2E verifies English labels, reload persistence, unchanged project revision and return to Korean. The default E2E passed 40 steps. Both manuals state that advanced dialogs/details are not fully translated. Full verification passed 172 test files and native tests passed 97; no complete bilingual UI or hardware claim.
- T-041 adds a separate AVAudioEngine helper and build path. Validated PCM16 mono/stereo WAV inputs render offline with source-identical PCM SHA-256; play/status/stop, invalid input and missing explicit output permission are covered. `node --test native/tests/audio-bridge.test.mjs` passed 2 tests, `npm run test:native` passed 99, and `npm run agent:verify:full` passed 172 files. GUI/native-MIDI integration is not implemented; T-042 tracks it. No listening or low-latency claim.
- T-042 connects an explicit opt-in native audio mode to completed server WAV jobs, preserving the default built-in preview. API tests verify offline completion, stale/unknown job rejection, Stop ownership and project-edit cleanup; GUI tests verify offline preview and Stop with a controlled helper. Targeted native tests passed 2, targeted GUI passed 2, default E2E passed 40, native suite passed 101 and full verification passed 172 files. No physical-device listening or native-MIDI synchronization claim.
- T-043 adds a separate AVAudioUnitComponentManager helper with bounded metadata, exact-ID selection, duplicate ambiguity and malformed-request errors. Two native tests verify discovery, selection and no instantiation without depending on a particular installed plugin. Native suite passed 103 and full verification passed 172 files. Hosting/instantiation remains T-044; no plugin code execution or quality claim.
- T-044 adds explicit offline-only instantiation for an exact discovered ID, with offline-intent validation, structured errors and release lifecycle. A system effect was instantiated in the observed environment and its input/output format and cleanup passed; no environment-independent compatibility claim. Targeted native tests passed 3, native suite passed 104 and full verification passed 172 files. T-045 tracks bounded offline PCM processing; no GUI or playback behavior changed.
- T-045 renders bounded PCM16 WAV through an explicitly instantiated system effect using AVAudioEngine offline mode. Two repeated renders produced identical output hashes, frame/rate/channel and source hashes were checked, and missing-instance/file errors preserved lifecycle. Targeted native tests passed 4, native suite passed 105 and full verification passed 172 files. T-046 tracks the server/GUI offline probe; no listening, compatibility or low-latency claim.
- T-046 exposes on-demand server/GUI discovery, exact selection, explicit instantiation, current-mix offline render and release with revision/document guards and no browser executable paths. Server and GUI targeted tests passed 1 and 2; default E2E passed 40, native suite passed 106 and full verification passed 172 files after suppressing no-op idle reset events. T-047 adds downloadable processed WAV. No hardware, compatibility or quality claim.
- T-047 writes actual PCM16 WAV from the helper, reads it before temporary-file cleanup and exposes a server-owned download with matching PCM hash. Server tests decode and verify frames/rate/channels/hash; GUI download decoded to non-empty stereo 48 kHz WAV. Targeted server 1 and GUI 3 passed; native 106 and full verification 172 files passed. Source render/project revision are unchanged. T-048 adds editable clip import.
- T-048 imports the server-owned processed WAV through the existing verified `/api/import/wav` path, without a new executable or arbitrary file-path input. The GUI test moves the ruler cursor to 4 seconds, verifies exactly one new audio clip at sample `4 * sampleRate` with the processed frame count, and confirms that one Undo restores the prior clips, tracks and assets. Audio Unit self-import alone preserves the offline instance/output; other project edits retain existing cleanup. Targeted GUI passed 4 steps, default E2E passed 40, native tests passed 106 and full verification passed 172 files. No listening or plugin-compatibility claim.
- T-049 adds explicit whole-mix/locator-range selection. Missing locators reject before a render or project edit. The locator test renders 0.25–1.25 seconds with zero added tail, verifies 48,000 stereo frames at 48 kHz and a server-recorded `sourceStartSample` of 12,000, then imports at that position despite the cursor remaining at 4 seconds. One Undo restores clips/tracks/assets. The owner snapshot now retains processed `outputUrl` and range metadata across refreshes. Targeted GUI passed 6 steps, default E2E passed 40, native tests passed 106 and full verification passed 172 files. No realtime-hosting, listening or compatibility claim.
- T-050 adds all-track/selected-track mode using the renderer's existing validated `trackIds`. Empty selection rejects without a project edit. Two sounding MIDI tracks establish that selected-track source PCM SHA-256 differs from the all-track source, and selected-track rendering also passes the locator-range/import/Undo path. Targeted GUI passed 8 steps, default E2E passed 40, native tests passed 106 and full verification passed 172 files. No arbitrary track IDs or executable paths were added; no listening or compatibility claim.
- T-051 adds native-only bounded AUParameterTree inspection and exact-keyPath setting. Initial values are captured at instantiation; current/default/min/max metadata, no-instance/unknown/malformed/out-of-range errors and lifecycle are checked. On an available system effect, a changed parameter produced different PCM and two subsequent renders were identical. Targeted native tests passed 5, the native suite passed 107 and full verification passed 172 files. No server/GUI parameter route, custom plugin GUI, realtime automation, listening or broad compatibility claim.
- T-052 connects parameter listing/setting to active-document/revision-guarded server routes and a generic numeric GUI. Server tests cover stale/malformed/unknown/out-of-range requests and actual readback without a project edit. GUI checks visible range rejection, valid readback, unchanged revision and a changed PCM hash on the next render; all prior scope/track/import/Undo checks still pass. Targeted GUI passed 10 steps, default E2E passed 40, native tests passed 107 and full verification passed 172 files. No custom plugin GUI, realtime automation, listening or compatibility claim.

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

T-012에서는 새 통합 테스트 2개가 통과했습니다. 140초 노트가 있는 150초 프로젝트를 실제 CLI로 48kHz·150초 이상 렌더하고 140초대 비무음 PCM을 확인했습니다. 601초 렌더는 `CLI_ERROR`/`RENDER_FAILED`와 600초 제한 메시지를 반환하며 프로젝트 불변과 출력 파일 부재를 확인했습니다. `probeExecArgv: []`인 독립 GUI probe도 재생과 `00:00.010 → 00:00.714` 진행·정지를 확인해 silent failure는 없었습니다. 앞선 inline probe의 worker 인자 오류는 probe 환경 문제로 구분했습니다. 개별 테스트와 최종 verify가 통과했습니다.

T-017에서는 컨트롤러 벤드 스모크가 2개 검사 후 실패한 것을 재현했습니다. 실패 화면에서 `화면 크기가 바뀌어 드래그를 취소했습니다`를 확인했고, 활성 드래그 중 full-page 스크린샷의 viewport resize가 기존 ResizeObserver 취소를 유발한 환경 간섭으로 분류했습니다. 해당 증거 캡처만 `fullPage: false`로 바꿨고 제스처·검증·제품 코드는 유지했습니다. 대상 E2E 13단계와 최종 verify가 통과했습니다.

T-018에서는 컨트롤러 페인트 스모크가 브라우저 이전에 실패함을 재현했습니다. 새 서버 프로젝트가 고정 템포로 시작하면서 기존 fixture의 복수 포인트 `tempo.set`이 거부된 drift였습니다. `tempo.mode`를 먼저 활성화해 원래 템포 맵 검사 의도를 유지하고 assertions는 바꾸지 않았습니다. 대상 E2E 16단계와 최종 verify가 통과했습니다.

T-019에서는 컨트롤러 셰이프 스모크에서 같은 고정 템포 fixture 거부를 재현했습니다. `tempo.set` 전에 `tempo.mode`를 활성화하는 동일한 최소 수정으로 제스처와 assertions를 유지했습니다. 대상 E2E 23단계와 최종 verify가 통과했습니다.

T-020에서는 컨트롤러 스냅 스모크의 같은 고정 템포 거부를 재현하고 fixture에만 `tempo.mode` 활성화를 적용했습니다. assertions는 바꾸지 않았으며 대상 E2E 13단계와 최종 verify가 통과했습니다.

T-021에서는 문서 스모크의 첫 가져오기 대기 timeout을 재현했습니다. 스크립트가 Import 옵션 없이 숨은 파일 입력을 직접 사용해 현재 GUI가 null draft를 올바르게 거부한 drift였습니다. `importSource`를 Import 버튼과 실제 파일 chooser 경로로 수정하고 동일한 HTTP·프로젝트 상태를 검증했습니다. 대상 E2E 17단계와 최종 verify가 통과했습니다.

T-022에서는 drafts 스모크의 같은 null draft 가져오기 timeout을 재현하고 실제 Import 옵션과 chooser를 사용하도록 수정했습니다. assertions는 유지하며 대상 E2E 17단계와 최종 verify가 통과했습니다.

T-023은 집중 조사 후 해결했습니다. MIDI 충돌 경고와 Escape 종료를 검증하고, DOM 조상 조사로 `clip-tools-button`이 닫힌 `details#arrangement-edit-menu` 안에 있음을 확정했습니다. force click이나 레이아웃 변경 대신 각 클립 편집 클릭 전에 직접 summary를 엽니다. 트랙 복제는 실제 확인 대화상자를 제출하고 순서 이동은 안정적인 `[data-track-edit="up"]`을 사용합니다. 대상 E2E 14단계가 모두 통과했고 제품 코드는 변경하지 않았습니다. 최종 verify도 통과했습니다.

T-024에서는 MIDI 이벤트 12개 검사 후보내기 timeout을 재현했습니다. 형식 선택이 다운로드 후 닫히는 대화상자 안에 있으므로 각 SMF 0/1보내기 전에 `#midi-export-dialog`를 엽니다. 대상 E2E 16단계와 최종 verify가 통과했고 제품 코드는 변경하지 않았습니다.

T-025에서는 MIDI modifier Freeze 후 timeout을 재현했습니다. 현재 완료 문구 `저장된 출력을 확정`과 달리 옛 문구 `실제 이벤트로 확정`을 기다린 drift였습니다. 완료 대기 문구만 바꾸고 revision·원본·MIDI 출력·초기화·no-op·Undo/Redo 검증은 유지했습니다. 대상 E2E 12단계와 최종 verify가 통과했습니다.

T-026에서는 첫 렌더 timeout을 재현했습니다. 테스트가보내기 대화상자만 열고 제출하지 않았기 때문에 `/api/render`가 없었습니다. 렌더 헬퍼가 `#mix-export-submit`을 누르도록 수정하고 PCM·Web Audio 검증은 유지했습니다. 대상 E2E 11단계와 최종 verify가 통과했으며 제품 코드는 변경하지 않았습니다.

T-027에서는 노트 오브젝트 스모크의 고정 템포 복수 포인트 거부를 재현했습니다. `tempo.set` 전에 `tempo.mode`를 활성화해 fixture 의도와 assertions를 유지했습니다. 대상 E2E 24단계와 최종 verify가 통과했고 제품 코드는 변경하지 않았습니다.

T-028에서는 노트 페인트 스모크의 같은 고정 템포 거부를 재현하고 fixture에만 `tempo.mode` 활성화를 적용했습니다. assertions는 유지하며 대상 E2E 23단계와 최종 verify가 통과했습니다.

T-029에서는 노트 셰이프 스모크의 같은 거부를 재현하고 `tempo.set` 전에 tempo-track 모드를 활성화했습니다. 셰이프·원본·이력 assertions는 유지하며 대상 E2E 20단계와 최종 verify가 통과했습니다.

T-030에서는 프로젝트 스모크가보내기 대화상자만 연 채 렌더를 기다린 timeout을 재현했습니다. `#mix-export-submit`으로 실제 작업을 시작하고 미디어 검증을 유지했습니다. 대상 E2E 20단계와 최종 verify가 통과했으며 제품 코드는 변경하지 않았습니다.

T-031에서는 split controller 정책 스모크의 닫힌 clip-tools 메뉴 timeout을 재현했습니다. 두 클릭 모두 `arrangement-edit-menu`의 직접 summary를 먼저 열고 assertions와 제품 코드는 유지했습니다. 대상 E2E 4단계와 최종 verify가 통과했습니다.

T-032에서는 split note 정책 스모크의 같은 timeout을 재현하고 두 작업 전에 직접 summary를 열도록 수정했습니다. 대상 E2E 3단계와 최종 verify가 통과했으며 제품 코드는 변경하지 않았습니다.

T-033에서는 split 설정 race 스모크의 초기 timeout을 재현하고 설정 저장·재열기·충돌을 포함한 모든 clip-tools 작업 전에 메뉴를 열었습니다. 대상 E2E 8단계와 최종 verify가 통과했습니다.

T-034에서는 split 설정 스모크의 같은 닫힌 메뉴 timeout을 재현하고 모든 작업 전에 직접 summary를 열었습니다. 대상 E2E 6단계와 최종 verify가 통과했으며 제품 코드는 변경하지 않았습니다.

T-035에서는 workspace의 일반 렌더와 지연 렌더 gate timeout을 재현했습니다. 두 경로 모두 `#mix-export-submit`을 제출하고 미디어·stale render 검증을 유지했습니다. 대상 E2E 21단계와 최종 verify가 통과했으며 제품 코드는 변경하지 않았습니다.

T-013에서는 실제 장치용 `docs/agent/MANUAL_CHECKS.md`를 이중 언어로 추가하고, 예상 결과와 빈 관찰 칸이 있는 6개 절차를 준비했습니다. FD-16/21/22가 문서에 연결되고 구조 검사와 guard가 통과했습니다. 사람이 수행할 문서이며 마이크·스피커·청음·지연 검증을 주장하지 않습니다.

후속 수정 후 `agent:smoke-sweep`가 종료 코드 0으로 완료되어 고유한 GUI 스모크 64개가 모두 통과했습니다. first-delivery는 한 번 실행했고 결과는 `.test-output/smoke-sweep.json`, 생성 화면은 `.test-output/final-smoke-sweep-screenshots/`에 있습니다.

T-010에서는 관리자의 Snap 결정을 코드보다 먼저 기록했습니다. 눈금자 클릭은 현재 primary/piano 그리드에 맞추고 Alt/Option은 정확한 위치를 유지합니다. 두 눈금자와 Alt 경로를 검증한 기본 E2E 37단계와 최종 verify가 통과했습니다.

T-036에서는 `audio.GUI-fade-out-changes-render`를 추가해 Inspector 0.5초 페이드 아웃의 자산 프레임 변환, CLI 렌더의 종료 RMS 감소와 시작보다 큰 감쇠, Undo 제거를 확인했습니다. 기본 E2E 38단계와 최종 verify가 통과했습니다. FD-20은 검사한 범위에서 페이드 인/아웃·뮤트·극성·노멀라이즈가 모두 verified입니다.

T-037에서는 `midi.GUI-tools-quantize`를 추가해 tick 25의 off-grid 노트를 선택 범위 1/16 그리드로 0에 퀀타이즈하고, 노트 수 유지와 Undo로 tick 25 복원을 확인했습니다. 기본 E2E 39단계와 최종 verify가 통과했습니다. FD-14는 퀀타이즈·전조·벨로시티를 모두 첫 납품에서 검증했습니다.

T-038에서는 자동백업 복구 스모크 4단계가 통과했습니다. GUI 트랙 생성·백업·목록 확인, 독립된 CLI `recover-backup`, 복구 프로젝트를 GUI로 열어 원래 트랙·클립을 확인했습니다. 원본 프로젝트 바이트는 변하지 않고 모든 파일은 임시 폴 낸에 있습니다. 기본 E2E 39단계와 최종 verify가 통과했으며 FD-04의 지원 경로를 기록했습니다.

T-039에서는 녹음 보조 스모크 4단계가 통과했습니다. 입력 선택·비무음 PCM·4개 카운트인 oscillator·4.2초 반주 buffer·모니터 경로·스테레오 캡처·메트로놈 예약을 확인했고, -6dB 캡처 gain 비율은 0.5011878275였습니다. 기존 녹음 워크플로·보호도 4/6단계로 통과하고 최종 verify도 통과했습니다. 가짜 장치·Web Audio 결과로 실제 장치 검증을 대신하지 않습니다.

T-040에서는 기본 transport·arrangement·녹음 화면에 한국어/영어 선택과 브라우저 저장을 추가했습니다. 기존 ID와 한국어 기본값을 유지하며 영어 문구·새로고침 유지·프로젝트 revision 불변·한국어 복귀를 E2E로 확인했습니다. 기본 E2E 40단계, 전체 제품 172개 파일, native 97개 테스트가 통과했습니다. 두 설명서에 고급 대화상자의 미번역 범위를 명시했으며 완전한 이중 언어 UI를 주장하지 않습니다.

T-041에서는 별도 AVAudioEngine helper와 빌드 경로를 추가했습니다. 검증된 PCM16 mono/stereo WAV의 오프라인 렌더가 원본과 동일한 PCM SHA-256을 유지하고, play/status/stop·잘못된 입력·출력 권한 부재를 검사했습니다. 대상 native 테스트 2개, 전체 native 99개, 제품 172개 파일이 통과했습니다. GUI·native MIDI 연결은 T-042로 남기며 청음이나 저지연 품질을 주장하지 않습니다.

T-042에서는 명시적 native audio 모드를 서버의 완료된 WAV job에 연결하고 기본 내장 프리뷰를 유지했습니다. API는 offline 완료·stale/unknown job 거부·Stop 소유권·편집 정리를 검증하고, GUI는 offline 재생과 Stop을 확인했습니다. 대상 native 2개·GUI 2개, 기본 E2E 40단계, 전체 native 101개, 제품 172개 파일이 통과했습니다. 실제 장치 청음이나 native MIDI 동기화는 주장하지 않습니다.

T-043에서는 AVAudioUnitComponentManager helper를 추가해 제한된 메타데이터·정확한 ID 선택·중복 모호성·잘못된 요청 오류를 검증했습니다. 두 native 테스트가 검색·선택·미인스턴스화를 확인하고 특정 설치 플러그인에 의존하지 않습니다. native 103개와 제품 172개 파일이 통과했습니다. 호스팅·인스턴스화는 T-044이며 플러그인 코드 실행이나 품질을 주장하지 않습니다.

T-044에서는 정확한 ID와 offline 의도가 있는 경우에만 인스턴스화하고 오류·release 수명주기를 검증했습니다. 관찰 환경의 시스템 effect 인스턴스화와 입출력 포맷·정리가 통과했지만 환경 독립 호환성은 주장하지 않습니다. 대상 native 3개, 전체 native 104개, 제품 172개 파일이 통과했습니다. T-045에서 제한된 오프라인 PCM 처리를 검증하며 GUI·재생 동작은 바꾸지 않았습니다.

T-045에서는 명시적으로 인스턴스화한 시스템 effect를 AVAudioEngine 오프라인으로 처리했습니다. 반복 렌더의 출력 해시가 일치하고 프레임·레이트·채널·원본 해시를 확인했으며, 인스턴스 부재·파일 오류 후에도 수명주기를 유지했습니다. 대상 native 4개, 전체 native 105개, 제품 172개 파일이 통과했습니다. T-046에서 서버/GUI 오프라인 probe를 연결하며 청음·호환성·저지연 품질은 주장하지 않습니다.

T-046에서는 서버/GUI의 요청 시 검색·정확한 선택·명시적 인스턴스화·현재 믹스 렌더·해제를 연결하고 revision/문서 검증을 적용했습니다. 서버 1개·GUI 2개 대상 검사, 기본 E2E 40단계, native 106개, 전체 제품 172개 파일이 통과했습니다. 변경 없는 idle reset 이벤트는 발행하지 않도록 기존 SSE 호환성도 유지했습니다. T-047에서 처리 WAV 다운로드를 추가하며 하드웨어·호환성·품질은 주장하지 않습니다.

T-047에서는 helper가 실제 PCM16 WAV를 쓰고 서버가 임시 파일 정리 전에 읽어 다운로드를 제공합니다. 서버에서 디코딩한 프레임·레이트·채널·PCM 해시가 일치하고, GUI 다운로드는 비어 있지 않은 stereo 48kHz WAV로 디코딩됐습니다. 대상 서버 1개·GUI 3개, native 106개, 제품 172개 파일이 통과했습니다. 원본 렌더와 프로젝트 revision은 유지되며 T-048에서 편집 가능한 클립 가져오기를 추가합니다.

T-048에서는 새 실행 파일이나 임의 경로 입력 없이 기존 `/api/import/wav`로 서버 소유 처리 WAV를 가져옵니다. GUI 검사는 눈금자 커서를 4초로 이동한 뒤 정확히 하나의 오디오 클립이 `4 * sampleRate`와 처리본 프레임 수로 생성되는지 확인하고, 한 번의 Undo가 기존 트랙·클립·에셋을 복원하는지 검증합니다. Audio Unit 자체 처리본 가져오기에만 오프라인 인스턴스·출력을 유지하며 다른 편집의 정리 동작은 그대로입니다. 대상 GUI 4단계, 기본 E2E 40단계, native 106개, 전체 제품 172개 파일이 통과했습니다. 청음이나 플러그인 호환성은 주장하지 않습니다.

T-049에서는 전체 믹스/Locator 구간 선택을 추가했습니다. Locator가 없으면 렌더나 프로젝트 변경 전에 거부합니다. 0.25–1.25초를 추가 꼬리 없이 처리해 48kHz stereo 48,000프레임과 서버 기록 `sourceStartSample` 12,000을 확인했고, 커서가 4초에 있어도 해당 구간 시작에 클립을 가져왔습니다. 한 번의 Undo로 트랙·클립·에셋이 복원됩니다. 소유자 스냅숏은 새로고침 후에도 처리본 `outputUrl`과 구간 메타데이터를 유지합니다. 대상 GUI 6단계, 기본 E2E 40단계, native 106개, 전체 제품 172개 파일이 통과했습니다. 실시간 호스팅·청음·호환성은 주장하지 않습니다.

T-050에서는 기존 렌더러의 검증된 `trackIds`를 사용한 모든 트랙/선택 트랙 모드를 추가했습니다. 빈 선택은 프로젝트 변경 없이 거부합니다. 두 개의 sounding MIDI 트랙으로 선택 트랙 source PCM SHA-256이 전체 source와 다른지 확인했고, 선택 트랙 모드도 Locator 구간·가져오기·Undo 경로를 통과했습니다. 대상 GUI 8단계, 기본 E2E 40단계, native 106개, 전체 제품 172개 파일이 통과했습니다. 임의 트랙 ID나 실행 경로를 추가하지 않았으며 청음·호환성은 주장하지 않습니다.

T-051에서는 native 전용으로 최대 256개 AUParameterTree 조회와 정확한 keyPath 설정을 추가했습니다. 인스턴스화 시 초기값을 저장하고 현재값·기본값·최소·최대 메타데이터, 인스턴스 부재·unknown·형식·범위 오류와 수명주기를 검사합니다. 사용 가능한 시스템 effect에서 변경 파라미터가 다른 PCM을 만들었고 이후 두 렌더의 해시가 일치했습니다. 대상 native 5개, 전체 native 107개, 제품 172개 파일이 통과했습니다. 서버/GUI 파라미터 경로, 사용자 정의 GUI, 실시간 오토메이션, 청음·광범위 호환성은 주장하지 않습니다.

T-052에서는 활성 문서·revision 검증이 있는 서버 파라미터 경로와 범용 숫자 GUI를 연결했습니다. 서버 검사는 stale·형식·unknown·범위 오류와 프로젝트 변경 없는 실제 readback을 확인합니다. GUI는 범위 오류 표시, 유효 값 readback, revision 불변과 다음 렌더의 PCM 해시 변화를 검증하고 기존 범위·트랙·가져오기·Undo도 유지했습니다. 대상 GUI 10단계, 기본 E2E 40단계, native 107개, 전체 제품 172개 파일이 통과했습니다. 사용자 정의 플러그인 GUI·실시간 오토메이션·청음·호환성은 주장하지 않습니다.
