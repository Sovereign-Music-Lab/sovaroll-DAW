# SovaRoll product acceptance / 제품 수용 기준

This public catalogue preserves stable IDs FD-01–FD-30 and the existing acceptance boundaries. Implemented, tested, partial, and manual are distinct states. The release validation record is [../VALIDATION.md](../VALIDATION.md).

테스트를 실행하지 않고 상태를 올리지 않습니다. 실제 소리를 듣지 않았다면 청음했다고 쓰지 않습니다. GUI와 CLI는 같은 명령 엔진을 사용하고, 원본 미디어·편집 가능한 MIDI·실패 전 상태를 보존합니다. 상태가 바뀌면 검증 기록에 실제 근거를 적습니다.

## 3. 첫 납품 요건과 현재 상태 (2026-11-09 기준)

E2E = `scripts/gui-first-delivery-smoke.mjs` (실행: `npm run agent:e2e`). 표의 `E2E:` 뒤 이름은 그 스크립트가 출력하는 `PASS` 단계 이름입니다.

### A. 프로젝트

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-01 | 새 프로젝트 생성 | CLI `init PATH` 또는 GUI 프로젝트 창 → 새 프로젝트로 빈 프로젝트가 열린다 | verified (CLI init + GUI 열림) / GUI 새 프로젝트 창 흐름은 implemented | E2E: `project.new-empty-project-opens-in-GUI`, tests/project-drafts·workspace 테스트 |
| FD-02 | 명시 저장 | Cmd/Ctrl+S 또는 CLI `save`로 저장 기준이 갱신된다 | verified | E2E: `project.explicit-save-restart-reopen-same-content` |
| FD-03 | 재시작 후 재열기 | 서버 종료 → 재시작 후 트랙·클립·에셋이 동일하고 편집·Undo가 된다 | verified | E2E: `project.explicit-save-restart-reopen-same-content`, `midi.edit-and-undo-after-restart` |
| FD-04 | 자동 백업·복구 | 비정상 종료 뒤 복구 목록에서 이어서 작업 | implemented (단위·통합 테스트 있음, 첫 납품 E2E 미포함) | tests/auto-backup, process-recovery |
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
| FD-13 | Undo/Redo | 버튼으로 되돌리기·다시하기, CLI 편집도 포함 | verified | E2E: `midi.GUI-undo-redo`, `cli.edit-appears-in-GUI-and-GUI-undo-redo-covers-it` |
| FD-14 | 퀀타이즈·전조·벨로시티 일괄 | MIDI 도구 창 | implemented (gui-editing-smoke 있음, 첫 납품 E2E 미포함) | scripts/gui-editing-smoke.mjs |

### C. 오디오

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-15 | WAV 가져오기(커서 위치) | 가져오기 창 → 커서 위치에 새 오디오 트랙·클립 | verified | E2E: `audio.GUI-WAV-import-at-cursor` |
| FD-16 | 마이크 녹음 | 녹음→정지 → 커서 위치 클립 한 번의 커밋 | verified (가짜 마이크) / 실제 장치 청음·지연은 manual | E2E: `audio.GUI-fake-microphone-recording-to-cursor-clip`, gui-recording-* |
| FD-17 | 클립 이동 | Inspector 시작 초 | verified | E2E: `audio.GUI-clip-move` |
| FD-18 | 클립 분할 | 커서 위치, 길이 합 보존 | verified | E2E: `audio.GUI-clip-split-at-cursor` |
| FD-19 | 클립 길이(trim) | Inspector 길이 프레임 | verified | E2E: `audio.GUI-clip-trim-length` |
| FD-20 | 페이드·클립 뮤트·극성·노멀라이즈 | Inspector 입력 → 렌더 결과에 반영 | 페이드 인·클립 뮤트·극성·노멀라이즈 verified / 페이드 아웃 implemented (E2E 없음) | E2E: `audio.GUI-fade-in-changes-render`, `audio.GUI-clip-mute-silences-render`, `audio.GUI-clip-polarity-inverts-render`, `audio.GUI-normalize-sets-clip-gain`, docs/DEVELOPMENT.ko.md |
| FD-21 | 녹음 보조(입력 선택·게인·모니터·카운트인·메트로놈·기존 트랙 들으며 녹음) | GUI 동작 + 녹음 결과 | implemented (E2E 없음), 실제 장치 manual | public/recording-ui.mjs, metronome.mjs |

### D. 재생·믹싱

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-22 | MIDI+오디오 재생 | Play → 재생 중·위치 진행, Stop → 정지 | verified (상태·진행만, 청음은 manual) | E2E: `playback.GUI-MIDI-and-audio-play-advance-stop` |
| FD-23 | 탐색 | 눈금자 클릭으로 커서 이동 | verified | E2E: `playback.GUI-seek-by-ruler` |
| FD-24 | 믹서 | 트랙 mute/solo/gain/pan, master gain | verified | E2E: `mixer.GUI-mute-solo-gain-pan-master` |
| FD-25 | Cycle(구간 반복) 재생 | Locator 구간 반복 | verified (전송 위치만, 청음은 manual) | E2E: `playback.GUI-cycle-loops-locator-range` |

### E. 내보내기·CLI

| ID | 요건 | 수용 기준 | 상태 | 근거 |
|---|---|---|---|---|
| FD-26 | WAV 믹스 내보내기 | 다운로드 WAV가 무음이 아니고 프로젝트 길이를 덮는다 | verified | E2E: `export.GUI-mix-WAV-download-non-silent` |
| FD-27 | MIDI 내보내기 | 모든 노트가 SMF에 있다 | verified | E2E: `export.GUI-MIDI-download-has-all-notes` |
| FD-28 | 프로젝트+미디어 묶음 | ZIP에 프로젝트와 WAV | verified | E2E: `export.GUI-project-media-bundle-zip` |
| FD-29 | GUI·CLI 공유 | CLI render = GUI 믹스(PCM 동일), CLI 편집이 GUI에 즉시 반영 | verified | E2E: `cli.render-matches-GUI-mix`, `cli.edit-appears-in-GUI-and-GUI-undo-redo-covers-it` |
| FD-30 | 재열기 후 동일 출력 | 재시작 뒤 렌더 PCM이 이전과 동일 | verified | E2E: `export.after-restart-identical-mix`, `playback.after-restart` |

### 첫 납품 판정

- 핵심 흐름(FD-01~03, 05~13, 15~19, 22~25, 26~30)은 **자동 검증 통과** 상태입니다. FD-20은 페이드 인·클립 뮤트·극성·노멀라이즈도 검증했습니다 (E2E 32단계, 2026-11-09).
- 남은 것: FD-04·14·21과 FD-20의 페이드 아웃 E2E 보강(작업 큐 T-0xx), 실제 장치 청음·지연 확인(manual, 사람이 해야 함), 화면 정리.
- "첫 납품 완료"라고 공식 표기하는 결정은 **사람이** 합니다. 에이전트는 근거를 쌓고 이 표를 갱신합니다.
