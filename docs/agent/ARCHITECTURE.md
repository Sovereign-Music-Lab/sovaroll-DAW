# newdaw 구조 안내 (에이전트용)

전체 모듈 목록은 `docs/agent/CODEMAP.md`(자동 생성)를 보세요. 이 문서는 **데이터가 어디서 어디로 흐르는지**와 **기능을 어디에 추가하는지**를 설명합니다. 더 긴 원본 설계는 `docs/ARCHITECTURE.md`, API 계약은 `docs/IMPLEMENTATION_CONTRACT.md`에 있습니다.

## 1. 한 장 요약

```
 브라우저 GUI (public/*.mjs)         터미널 CLI (src/cli.mjs)
        │  fetch /api/*  ▲ SSE /api/events      │  HTTP (--url) 또는 오프라인
        ▼                │                       ▼
              HTTP 서버 (src/server.mjs)  ── 작업 큐/워커 (render-worker 등)
                         │
           문서 세션 (src/session-store.mjs, document-session.mjs, workspace.mjs)
                         │  execute({command, arguments, expectedRevision})
                         ▼
           엔진 (src/core/engine.mjs)  ← 스키마 (src/core/schema.mjs)
             · 명령 검증 → 프로젝트 사본에 적용 → validateProject → 이력 기록
             · 기능별 적용 모듈: core/editing.mjs, controllers.mjs, merge.mjs, modifiers.mjs …
                         │
           저장 (src/storage.mjs): PROJECT.newdaw.json + assets/ + 사이드카 파일
                         │
           미디어 (src/media/*): WAV/AIFF/MIDI 코덱, 오프라인 렌더러, 시간 변환
```

- Node.js 22+ 내장 모듈만 사용합니다. **npm 패키지를 추가하지 않습니다** (테스트용 Playwright만 외부, 선택).
- 모든 파일은 ES 모듈(`.mjs`)입니다.

## 2. 프로젝트 파일

- `X.newdaw.json`: 프로젝트 본문. 주요 필드: `id, name, revision, ppq(960), sampleRate, tempoMap[{tick,bpm}], timeSignature, masterGainDb, tracks[], clips[], assets[]`.
  - 트랙: `{id, type:'midi'|'audio', name, gainDb, pan, mute, solo, instrument?, parentFolderId?}`
  - MIDI 클립(파트): `{id, trackId, type:'midi', startTick, lengthTicks, notes[{id,pitch,startTick(클립 기준),durationTicks,velocity,channel}], events[]?, controllers?}`
  - 오디오 클립: `{id, trackId, type:'audio', assetId, startSample, offsetFrames, lengthFrames, gainDb, fadeInFrames?, mute?, ...}`
  - 에셋: `{id, path:'assets/<sha256>.wav', sha256, sampleRate, channels, frames}` — 파일 이름이 내용 해시입니다.
- 같은 폴더의 사이드카: `.history.json`(Undo 이력), `.saved.json`(마지막 명시 저장 기준), `.bak`(이전 저장 세대), `.autobackups.json`, `.lock`.
- 스키마 정의: `src/core/schema.mjs`의 `projectSchema`. 교차 검증(참조 무결성, 범위)은 `src/core/engine.mjs`의 `validateProject`.

## 3. 명령 엔진 (가장 중요)

모든 프로젝트 변경은 **명령**입니다. 명령 하나 = Undo 한 단계. `batch`는 여러 명령을 원자적으로 한 단계로 묶습니다.

요청 형태:

```json
{"command":"track.update","arguments":{"trackId":"t1","gainDb":-6},"expectedRevision":12,"dryRun":false}
```

응답 형태: `{status:'applied'|'error', applied, projectRevision, resolvedTargets, changes:{created,updated,removed,...}, errors:[{code,message,details?}]}`

명령이 처리되는 순서:

1. `validateCommand` (schema.mjs): 이름과 인자 스키마 검사. 실패 → `VALIDATION_ERROR`/`UNKNOWN_COMMAND`.
2. `Engine.execute` (engine.mjs): revision 확인 → 프로젝트 **사본**에 `applyCommand` → `validateProject` → 이력 기록.
3. `applyCommand` (engine.mjs:247 근처): 앞부분의 `if(command===...)` 블록, 기능 모듈 위임(`applyEditing` 등, engine.mjs:267 근처), 마지막 `switch(command)`.
4. 에러는 `fail(code, message, details)`(schema.mjs)로 던집니다 → 사용자에게 그대로 보이는 코드. 미디어 계층의 `mediaError`도 사용자 코드로 전달됩니다. 그 밖의 예외는 `INTERNAL_ERROR`(버그 신호)입니다.
5. 실패하면 사본을 버리므로 프로젝트는 그대로입니다(원자성).

새 명령 추가 위치(자세한 절차는 `skills/add-engine-command/SKILL.md`):

| 할 일 | 위치 |
|---|---|
| 이름·설명·인자 스키마 | `src/core/schema.mjs`의 `definitions` 배열 |
| 적용 로직 | `src/core/engine.mjs` `applyCommand` 또는 기능 모듈(`src/core/editing.mjs` 등) |
| 이력 이름 | `src/core/engine.mjs`의 `actionLabels` 객체 (849행 근처) |
| CLI | 자동: `node src/cli.mjs command NAME 'JSON'` |
| GUI | `public/app.mjs`의 `runCommand(name, args, expectedRevision)` 호출 |
| 테스트 | `tests/<기능>.test.mjs` (엔진 직접) + 필요 시 `tests/<기능>-integration.test.mjs` (HTTP/CLI) |

## 4. 서버와 API

- `src/server.mjs`의 `startServer({projectPath, port, demo, quiet})` → `{url, close()}`. 테스트는 `port:0`(임의 포트)과 임시 폴더를 씁니다.
- 주요 경로: `GET /api/state`(프로젝트+세션+이력 보기), `POST /api/command`, `GET /api/events`(SSE: 변경 시 새 스냅샷), `POST /api/import/wav|midi|aiff`, `GET /api/export/midi`, `POST /api/render`(작업 생성) → `/api/jobs/:id`, `GET /api/project/bundle`, `/api/document/*`(저장·다른 이름·되돌리기), `/api/workspace/*`(여러 문서·새 프로젝트), `/api/time/*`.
- 문서 식별: GUI/CLI는 `X-Newdaw-Document` 헤더와 `expectedRevision`으로 "다른 문서/오래된 상태"에 대한 변경을 거부합니다. 이 보호를 우회하지 마세요.
- **capabilities**: `server.mjs`의 `CAPABILITIES` 객체가 상태 스냅샷에 실립니다. GUI는 `snapshot.capabilities.X`로 기능을 켜고 끕니다(구버전 서버와 섞여도 잘못된 요청을 보내지 않기 위함). 새 서버 기능을 GUI에 붙일 때 capability 플래그를 추가합니다.

## 5. GUI

- 프레임워크 없음. `public/index.html`(정적 마크업, 대부분의 버튼 ID) + `public/app.mjs`(상태·렌더·이벤트, 약 2,300줄, **매우 긴 줄 다수**) + 기능 모듈(`editing.mjs`, `recording-ui.mjs`, `controller-lanes.mjs`, `document.mjs`, `projects.mjs` …).
- 흐름: 사용자 입력 → `runCommand()` → `POST /api/command` → `refreshState()` → `renderUI()`. 다른 클라이언트(CLI) 변경은 SSE로 들어와 다시 그립니다.
- 상태 변수: `project`(서버 스냅샷), `selectedTrack/selectedClip/selectedNoteIds`, `busy`, `connected`, `transportSeconds`.
- 재생: 서버가 렌더한 오프라인 믹스를 WebAudio로 재생하는 **스냅샷 프리뷰**입니다(실시간 엔진 아님). 편집하면 프리뷰가 멈춥니다.
- 메뉴 안 버튼: `<details id="editing-tools-menu">`, `<details id="arrangement-edit-menu">` 안의 버튼은 메뉴를 열어야 보입니다.
- 키보드 단축키: `app.mjs`의 `document.addEventListener('keydown', …)` (1895행 근처). 편집기 단축키는 포커스가 `.editor` 안에 있어야 동작합니다.

## 6. 미디어·렌더

- `src/media/render.mjs`의 `renderProject(project, assets, options)`: 결정적(같은 입력 → 같은 PCM) 오프라인 스테레오 렌더. 최대 600초, 96 kHz.
- 내장 악기는 단순 오실레이터(`sine`/`triangle`/`sawtooth`, schema.mjs의 `instrument`)입니다. 전문 음원이 아닙니다.
- MIDI 입출력: `src/media/midi.mjs` (`parseMidi`, `writeMidi`), WAV: `src/media/wav.mjs` (`encodeWav`, `decodeWav`).
- 시간 변환: `src/media/time.mjs`(`compileTempoMap`), 정확한 분수 시간: `exact-tempo.mjs`, `musical-time.mjs`.

## 7. 테스트 종류

| 종류 | 위치 | 실행 | 언제 |
|---|---|---|---|
| 단위 (엔진·미디어 직접) | `tests/*.test.mjs` | `node --test tests/x.test.mjs` | 모든 로직 변경 |
| 통합 (실서버 HTTP + CLI) | `tests/*-integration.test.mjs` | 같음 | API·저장·CLI 변경 |
| 브라우저 E2E | `scripts/gui-*-smoke.mjs` | `npm run agent:e2e [-- 스크립트]` | GUI 변경 |
| 첫 납품 인수 | `scripts/gui-first-delivery-smoke.mjs` | `npm run agent:e2e` | GUI·서버 변경 후 반드시 |

## 8. 용어와 코드 매핑

| 용어 | 뜻 | 코드 |
|---|---|---|
| Part / 파트 | MIDI 클립 | `clip.type==='midi'` |
| Event / 이벤트 | 오디오 클립 | `clip.type==='audio'` |
| Locator / Cycle | 좌우 구간 / 구간 반복 | `project.locators{startTick,endTick}`, `project.cycleEnabled` |
| Chase | 재생 시작 위치 이전의 CC·페달 상태 복원 | `src/media/midi-chase.mjs` |
| Freeze / Merge | MIDI 수정자 확정 / 구간 병합 | `core/modifiers.mjs`, `core/merge.mjs` |
| PPQ | 4분음표당 tick. 저장은 960, 표시는 설정(기본 480) | `project.ppq` |
| tick / sample / frame | 음악 시간 / 프로젝트 샘플 / 에셋 샘플 | `startTick`, `startSample`, `offsetFrames` |
