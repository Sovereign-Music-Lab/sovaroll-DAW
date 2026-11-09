# SovaRoll product acceptance / 제품 수용 기준

This public catalogue preserves stable IDs FD-01–FD-30 and the existing acceptance boundaries. Implemented, tested, partial, and manual are distinct states. The release validation record is [../VALIDATION.md](../VALIDATION.md).

테스트를 실행하지 않고 상태를 올리지 않습니다. 실제 소리를 듣지 않았다면 청음했다고 쓰지 않습니다. GUI와 CLI는 같은 명령 엔진을 사용하고, 원본 미디어·편집 가능한 MIDI·실패 전 상태를 보존합니다. 상태가 바뀌면 검증 기록에 실제 근거를 적습니다.

## 3. 첫 납품 요건과 현재 상태 (2026-11-09 기준)

E2E = `scripts/gui-first-delivery-smoke.mjs` (실행: `npm run agent:e2e`). 표의 `E2E:` 뒤 이름은 그 스크립트가 출력하는 `PASS` 단계 이름입니다.

### A. 프로젝트

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-01 | 새 프로젝트 생성 | CLI `init PATH` 또는 GUI 프로젝트 창 → 새 프로젝트로 빈 프로젝트가 열린다 | verified (CLI init + GUI 열림 + GUI 새 Untitled 생성) | E2E: `project.new-empty-project-opens-in-GUI`, `scripts/gui-new-project-delivery-smoke.mjs`: `project.GUI-create-new-Untitled`, tests/project-drafts·workspace 테스트 |
| FD-02 | 명시 저장 | Cmd/Ctrl+S 또는 CLI `save`로 저장 기준이 갱신된다 | verified | E2E: `project.explicit-save-restart-reopen-same-content` |
| FD-03 | 재시작 후 재열기 | 서버 종료 → 재시작 후 트랙·클립·에셋이 동일하고 편집·Undo가 된다 | verified | E2E: `project.explicit-save-restart-reopen-same-content`, `midi.edit-and-undo-after-restart` |
| FD-04 | 자동 백업·복구 | 비정상 종료 뒤 복구 목록에서 이어서 작업 | verified (GUI 백업 + CLI 독립 복구 + GUI 열기) | `scripts/gui-auto-backup-recovery-smoke.mjs`, tests/auto-backup, process-recovery |
| FD-05 | 미디어 보존 | 편집 후에도 원본 WAV 바이트가 바뀌지 않는다 | verified | E2E: `audio.source-WAV-preserved-after-edits` |

### B. MIDI 편집

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-06 | MIDI 트랙·파트 생성 | GUI 버튼 한 번으로 트랙+빈 파트 | verified | E2E: `midi.GUI-create-track-and-part` |
| FD-07 | 노트 입력 | 피아노롤 빈 칸 클릭 → 해당 tick·pitch에 노트 | verified | E2E: `midi.GUI-piano-roll-note-input` |
| FD-08 | 노트 이동 | 드래그로 시간·음높이 이동 | verified | E2E: `midi.GUI-note-drag-move-time-and-pitch` |
| FD-09 | 길이·벨로시티 | Inspector에서 수정 | verified | E2E: `midi.GUI-inspector-velocity-and-length` |
| FD-10 | 복사·붙여넣기 | Cmd/Ctrl+A/C, 눈금자로 커서 이동, Cmd/Ctrl+V → 커서 위치에 붙음 | verified | E2E: `midi.GUI-note-copy-paste-at-cursor` |
| FD-11 | 파트 반복 | 반복 창으로 파트 복제 | verified | E2E: `midi.GUI-part-repeat` |
| FD-12 | 파트 분할 | 커서 위치 분할, 노트 보존 | verified | E2E: `midi.GUI-part-split-at-cursor` |
| FD-13 | Undo/Redo | 버튼으로 되돌리기·다시하기, CLI 편집도 포함 | verified | E2E: `midi.GUI-undo-redo`, `cli.edit-appears-in-GUI-and-GUI-undo-redo-covers-it`, `project.GUI-keyboard-undo-redo` |
| FD-14 | 퀀타이즈·전조·벨로시티 일괄 | MIDI 도구 창 | verified (첫 납품 E2E: 퀀타이즈·전조·벨로시티) | E2E: `midi.GUI-tools-transpose`, `midi.GUI-tools-velocity`, `midi.GUI-tools-quantize` |

### C. 오디오

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-15 | WAV 가져오기(커서 위치) | 가져오기 창 → 커서 위치에 새 오디오 트랙·클립 | verified | E2E: `audio.GUI-WAV-import-at-cursor` |
| FD-16 | 마이크 녹음 | 녹음→정지 → 커서 위치 클립 한 번의 커밋 | verified (가짜 마이크) / 실제 장치 청음·지연은 manual | E2E: `audio.GUI-fake-microphone-recording-to-cursor-clip`, gui-recording-*, [실제 장치 체크리스트](MANUAL_CHECKS.md) |
| FD-17 | 클립 이동 | Inspector 시작 초 | verified | E2E: `audio.GUI-clip-move` |
| FD-18 | 클립 분할 | 커서 위치, 길이 합 보존 | verified | E2E: `audio.GUI-clip-split-at-cursor` |
| FD-19 | 클립 길이(trim) | Inspector 길이 프레임 | verified | E2E: `audio.GUI-clip-trim-length` |
| FD-20 | 페이드·클립 뮤트·극성·노멀라이즈 | Inspector 입력 → 렌더 결과에 반영 | verified (페이드 인/아웃·클립 뮤트·극성·노멀라이즈) | E2E: `audio.GUI-fade-in-changes-render`, `audio.GUI-fade-out-changes-render`, `audio.GUI-clip-mute-silences-render`, `audio.GUI-clip-polarity-inverts-render`, `audio.GUI-normalize-sets-clip-gain` |
| FD-21 | 녹음 보조(입력 선택·게인·모니터·카운트인·메트로놈·기존 트랙 들으며 녹음) | GUI 동작 + 녹음 결과 | verified (가짜 장치·Web Audio 관찰) / 실제 장치 manual | `scripts/gui-recording-assistance-smoke.mjs`, [실제 장치 체크리스트](MANUAL_CHECKS.md) |

### D. 재생·믹싱

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-22 | MIDI+오디오 재생 | Play → 재생 중·위치 진행, Stop → 정지 | verified (150초 GUI probe 포함, 상태·진행만, 청음은 manual) | E2E: `playback.GUI-MIDI-and-audio-play-advance-stop`, `.test-output/long-project-gui.json`, [실제 장치 체크리스트](MANUAL_CHECKS.md) |
| FD-23 | 탐색 | 눈금자 클릭으로 커서 이동 | verified (Snap + Alt 자유 위치 포함) | E2E: `playback.GUI-seek-by-ruler`, `playback.GUI-ruler-click-snap-and-alt-override` |
| FD-24 | 믹서 | 트랙 mute/solo/gain/pan, master gain | verified | E2E: `mixer.GUI-mute-solo-gain-pan-master` |
| FD-25 | Cycle(구간 반복) 재생 | Locator 구간 반복 | verified (전송 위치만, 청음은 manual) | E2E: `playback.GUI-cycle-loops-locator-range` |

### E. 내보내기·CLI

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-26 | WAV 믹스 내보내기 | 다운로드 WAV가 무음이 아니고 프로젝트 길이를 덮는다 | verified (150초 CLI 렌더 포함) | E2E: `export.GUI-mix-WAV-download-non-silent`, tests/long-project-render-integration.test.mjs |
| FD-27 | MIDI 내보내기 | 모든 노트가 SMF에 있다 | verified | E2E: `export.GUI-MIDI-download-has-all-notes` |
| FD-28 | 프로젝트+미디어 묶음 | ZIP에 프로젝트와 WAV | verified | E2E: `export.GUI-project-media-bundle-zip` |
| FD-29 | GUI·CLI 공유 | CLI render = GUI 믹스(PCM 동일), CLI 편집이 GUI에 즉시 반영 | verified | E2E: `cli.render-matches-GUI-mix`, `cli.edit-appears-in-GUI-and-GUI-undo-redo-covers-it` |
| FD-30 | 재열기 후 동일 출력 | 재시작 뒤 렌더 PCM이 이전과 동일 | verified | E2E: `export.after-restart-identical-mix`, `playback.after-restart` |

### 첫 납품 판정

- 핵심 흐름(FD-01~03, 05~13, 15~19, 22~25, 26~30)은 **자동 검증 통과** 상태입니다. FD-20은 페이드 인·클립 뮤트·극성·노멀라이즈도 검증했습니다 (E2E 39단계, 2026-11-09).
- 남은 것: 실제 장치 청음·지연 확인(manual, 사람이 해야 함). 현재 E2E 보강 과제는 완료했습니다.
- "첫 납품 완료"라고 공식 표기하는 결정은 **사람이** 합니다. 에이전트는 근거를 쌓고 이 표를 갱신합니다.

### 후속 Audio Unit 오프라인 처리 범위

| 관련 ID | 추가 범위 | 상태 | 근거 |
|---|---|---|---|
| FD-13, FD-15 | 서버가 소유한 Audio Unit 처리 WAV를 커서 위치의 새 오디오 트랙·클립으로 가져오고 한 번의 Undo로 원래 트랙·클립·에셋 상태를 복원 | verified (macOS 오프라인 probe; 플러그인 호환성·청음 제외) | `scripts/gui-audio-units-smoke.mjs`: `audioUnits.GUI-import-processed-clip-and-Undo`, T-048 검증 기록 |
| FD-13, FD-15, FD-25 | Locator 구간을 꼬리 없이 오프라인 처리하고 커서와 무관하게 서버가 기록한 구간 시작에 처리 클립을 추가; Locator 부재 시 프로젝트 변경 없이 오류 | verified (0.25–1.25초, 48kHz stereo 48,000프레임) | `audioUnits.GUI-locator-mode-requires-locators-without-project-edit`, `audioUnits.GUI-locator-range-render-import-at-start-and-Undo`, T-049 검증 기록 |
| FD-13, FD-15, FD-24 | 기존 export 렌더러의 검증된 trackIds로 Audio Unit 선택 트랙 처리; 빈 선택은 오류, 전체/Locator 시간 범위와 결합 및 처리본 Undo | verified (두 개의 sounding MIDI 트랙, source PCM 해시 비교) | `audioUnits.GUI-selected-track-mode-requires-selection`, `audioUnits.GUI-selected-track-render-excludes-other-track`, `audioUnits.GUI-locator-range-render-import-at-start-and-Undo`, T-050 검증 기록 |
| — | 명시적 인스턴스의 최대 256개 파라미터 keyPath·초기값·현재값·범위 조회와 native/server/GUI 숫자 설정; stale revision·오류·프로젝트 불변·오프라인 PCM 반영 | verified (범용 숫자 GUI; 실시간 오토메이션·사용자 정의 플러그인 UI 제외) | `native/tests/audio-units.test.mjs`, `audioUnits.GUI-parameter-validation-setting-and-readback`, `audioUnits.GUI-parameter-change-affects-offline-render-without-project-edit`, `audioUnits.GUI-parameter-default-restores-baseline-render`, T-051–T-052·T-055 검증 기록 |
| FD-13, FD-15, FD-18 | 공유 export 렌더러의 clipIds로 선택 클립 Audio Unit 처리; 빈·unknown·stale 선택 거부, 트랙·Locator 범위와 교집합 처리 및 Undo | verified (두 sounding 클립 source 해시, 처리 에셋 identity) | `tests/render-export-clip-selection.test.mjs`, `audioUnits.GUI-selected-clip-mode-requires-selection`, `audioUnits.GUI-selected-clip-render-excludes-other-clip`, T-053 검증 기록 |
| — | 활성 Audio Unit 인스턴스의 GUI 구성요소 검색·선택·재인스턴스화 잠금; 명시적 release 뒤 파라미터 정리와 같은 구성요소 재인스턴스화 | verified (GUI/server 인스턴스 상태 일치) | `audioUnits.GUI-active-instance-locks-selection-and-release-restores`, T-054 검증 기록 |
| — | 명시적 기본 출력 권한이 있는 native Audio Unit Play/Stop/Status, 중복·재생 중 렌더 거부, 완료·release·offline 복구 | verified (무음 PCM 실제 AVAudioEngine 출력 경로; server/GUI·MIDI 동기화 제외) | `Audio Unit real-time preview requires permission and owns silent Play Stop completion lifecycle`, T-056 검증 기록 |
| FD-22, FD-23, FD-24 | 서버 소유 scoped WAV job의 Audio Unit GUI Play/Stop, wrong-job·stale·path·권한 거부와 프로젝트 편집 정리 | verified (무출력 controlled GUI helper + T-056 무음 native 경로; MIDI 동기화 제외) | `scripts/gui-audio-unit-preview-smoke.mjs` 3단계, T-057 검증 기록 |
| — | Audio Unit 악기의 bounded 오프라인 MIDI 노트 온·오프 렌더; 매번 fresh instance로 결정적 PCM16 WAV | verified (native helper만; GUI 악기 할당·실시간 MIDI 제외) | `Audio Unit instrument renders bounded scheduled MIDI notes to deterministic non-silent WAV`, native 109/109, T-058 검증 기록 |
| — | 원본에서 명령·API·native·UI·테스트를 집계하는 재생성 가능한 기능 인벤터리; 2,500개 원본 명세 부재를 명시 | verified (수치는 합산하지 않음; 2,500개 완료 주장 없음) | `npm run agent:features`, `tests/feature-inventory.test.mjs`, 양국어 FEATURE_INVENTORY, T-059 |
| — | 선택 MIDI의 Audio Unit 악기 GUI 렌더·가져오기 | verified (모달 버튼 행 overflow 수정, 시스템 악기 결정적 WAV·원래 위치·Undo) | `scripts/gui-audio-unit-instrument-smoke.mjs` 3단계, T-060 검증 기록 |
| — | Audio Unit 컨트롤·범위·파라미터 메타데이터·동작 상태의 한국어/영어 전환과 유지 | verified (구성요소 이름·keyPath·서버 오류 원본 유지, revision 불변) | `scripts/gui-audio-units-i18n-smoke.mjs` 3단계, T-061 검증 기록 |
| — | 명시적 출력의 native Audio Unit 악기 실시간 MIDI Play/Stop/완료, 중복 거부·held-note 정리·release | verified (outputGain=0 실제 엔진 경로; server/GUI·동기화·지연 품질 제외) | `Audio Unit instrument real-time MIDI playback owns silent completion Stop and held-note cleanup`, native 110/110, T-062 |
