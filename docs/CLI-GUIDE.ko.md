# SovaRoll CLI 가이드

[English](CLI-GUIDE.en.md) · [프로젝트](../README.ko.md) · [설명서](MANUAL.ko.md) · [모든 옵션 (CLI 도움말)](CLI.md)

같은 내용을 터미널에서도 오프라인으로 볼 수 있습니다: `npm run cli -- guide` (주제: `guide edit`, `guide export`, `guide all`). GUI와 CLI는 같은 엔진을 쓰므로 여기 나온 모든 작업은 브라우저 클릭과 똑같이 실행 취소와 리비전 검사를 받습니다.

## 매일의 루틴

1. **시작** — 터미널 1에서 `npm start`. 켜 둔 채로 둡니다.
2. **확인** — `npm run cli -- status`로 프로젝트, 트랙 ID, 현재 리비전을 봅니다.
3. **검증** — 편집 명령에 `--dry-run`을 붙이면 아무것도 바꾸지 않고 결과만 보여 줍니다.
4. **적용** — `--dry-run`을 빼고 다시 실행합니다. GUI나 에이전트가 동시에 편집할 수 있으면 `--revision N`을 붙입니다.
5. **저장** — `npm run cli -- save`. 편집은 자동 저장되고, 명시 저장은 기준점입니다.
6. **내보내기·백업** — `render`, `export-midi`, `export-bundle backup.zip`.

## 모든 명령에 공통인 규칙

- 서버에 연결하는 명령은 `--url`(기본 `http://127.0.0.1:4317`)을 씁니다. 오프라인 명령(`init`, `guide`, `offline-render*`, `collect`, `recover*`)은 파일을 직접 읽습니다.
- ID(트랙·클립·노트)는 예제가 아니라 `status` 결과에서 가져옵니다.
- 내보내기와 복구는 기존 파일을 덮어쓰지 않으며 `--force`는 내보내기에서만 쓸 수 있습니다.
- `*-plan` 명령은 검사만 합니다. 출력된 PLAN_ID를 짝이 되는 명령에 넘겨야 변경됩니다.
- 실패한 명령은 프로젝트를 그대로 두고 구조화된 오류를 출력합니다.
- 레벨·파형 검사는 기술적 사실일 뿐 음악적·청취 판단이 아닙니다.

## 시작과 종료

서버가 열린 프로젝트를 들고 있습니다. 대부분의 명령은 서버와 통신하므로 한 터미널에서 서버를 켜 두고 다른 터미널에서 명령을 실행합니다.

```sh
# GUI와 명령 서버를 4317 포트로 시작 (Ctrl+C로 종료)
npm start
# 다른 포트 사용. 이후 명령에 --url http://127.0.0.1:4318 추가
npm start -- --port 4318
# 빈 프로젝트 만들기 (덮어쓰기 거부, --demo는 데모 생성)
node src/cli.mjs init ~/Music/SovaRoll/Song/Song.newdaw.json
# 특정 프로젝트로 서버 시작
node src/cli.mjs serve --project ~/Music/SovaRoll/Song/Song.newdaw.json --port 4318
# 이 가이드 (오프라인, 서버 불필요)
npm run cli -- guide [TOPIC|all]
# 프로젝트 상태 읽기 (아무것도 바꾸지 않음)
npm run cli -- status
# 활성 파일 이름과 명시 저장 지점 확인
npm run cli -- document
```

## 프로젝트 열기·만들기·전환

워크스페이스 명령은 두 단계입니다. *-plan 명령으로 검사한 뒤, 출력된 PLAN_ID를 적용 명령에 넘깁니다. 적용 전에는 아무것도 바뀌지 않습니다.

```sh
# 열린 프로젝트와 활성 프로젝트 목록
npm run cli -- projects
# 워크스페이스에 추가할 파일 검사
npm run cli -- project-open-plan PATH [--inactive]
# 최근 프로젝트를 워크스페이스에 추가하기 전 검사
npm run cli -- project-open-recent-plan ENTRY_ID [--inactive]
# 열기 계획 적용 (현재 프로젝트를 그대로/저장 후 둘지 선택)
npm run cli -- project-open PLAN_ID --current preserve|save [--dry-run]
# 활성 프로젝트 전환 계획
npm run cli -- project-activate-plan DOCUMENT_ID
# 전환 적용
npm run cli -- project-activate PLAN_ID --current preserve|save
# 문서 하나 닫기 계획 (다른 문서를 자동 활성화하지 않음)
npm run cli -- project-close-plan DOCUMENT_ID
# 닫기 적용
npm run cli -- project-close PLAN_ID --current preserve|save
# 새(제목 없음) 프로젝트 계획
npm run cli -- project-new-plan [FOLDER] [--sample-rate N] [--folder-name NAME] [--chosen-folder PATH]
# 새 프로젝트 생성
npm run cli -- project-new PLAN_ID --current preserve|save [--save-output PATH]
# 로컬 폴더 탐색 (읽기 전용)
npm run cli -- project-folders [PATH] [--cursor N]
# 기본 위치 설정 읽기
npm run cli -- project-locations
# 위치 설정 저장
npm run cli -- project-location-settings '{"locationMode":"default","defaultLocation":"/path"}' [--location-revision N]
# 최근 프로젝트와 누락·변경 진단
npm run cli -- recent
# 최근 프로젝트 검사
npm run cli -- open-recent-plan ENTRY_ID
# 기존 프로젝트 검사 (구형 교체 흐름)
npm run cli -- open-plan PATH
# 구형: 이전 파일을 닫고 검사한 파일 활성화
npm run cli -- open PLAN_ID --current preserve|save
# 최근 목록 항목 하나 제거 (프로젝트는 그대로)
npm run cli -- recent-remove ENTRY_ID
# 최근 목록만 비우기
npm run cli -- recent-clear --confirm
# 제목 없음 복구 기록 목록
npm run cli -- drafts
# 초안 복구 계획
npm run cli -- project-recover-plan DRAFT_ID
# 초안 복구
npm run cli -- project-recover PLAN_ID --current preserve|save [--save-output PATH]
```

## 명령으로 편집하기 (핵심 루틴)

루틴: 확인 → --dry-run → 적용 → 이력 확인. ID는 예제 복사가 아니라 `status` 결과에서 가져옵니다. --revision N을 주면 그 사이 다른 편집이 있었을 때 거부됩니다.

```sh
# 모든 엔진 명령과 스키마 목록
npm run cli -- commands
# 변경 없이 검증만
npm run cli -- command track.add '{"type":"midi","name":"Piano"}' --dry-run
# 명령 하나 적용 (undo 한 단계)
npm run cli -- command track.add '{"type":"midi","name":"Piano"}'
# 동시 편집 충돌 방지
npm run cli -- command track.update '{"trackId":"ID","gainDb":-9}' --revision N
# 명령 배열을 원자적으로, undo 한 단계로 적용
npm run cli -- batch commands.json [--dry-run]
# 편집 이력과 undo/redo 위치
npm run cli -- history
# 클립 선택 조회 (편집 없음). mode: all|none|invert|inLoop|outsideLoop|beforeCursor|afterCursor|atCursor|tracks
npm run cli -- select-clips '{"mode":"all"}'
# 선택 스냅샷 저장 (읽기 전용)
npm run cli -- copy-clips OUT.newdaw-clips.json '{"clipIds":["ID"]}'
# 스냅샷을 지정 위치/원래 위치에 붙여넣기
npm run cli -- paste-clips IN.newdaw-clips.json '{"atTick":0}' [--dry-run]
# MIDI 파트 길이 조정 (원본 음표 보존)
npm run cli -- resize-midi-parts '{"clipIds":["ID"],"deltaTicks":480}' [--dry-run]
# 제로 크로싱에서 원자적 분할
npm run cli -- split-zero '{"atTick":1920}' [--dry-run]
# 오디오 클립 가장자리 트림
npm run cli -- trim-clips '{"clipIds":["ID"],"edge":"left","seconds":0.1}' [--dry-run]
# 클립 안에서 원본 슬립
npm run cli -- slip-clips '{"clipIds":["ID"],"seconds":0.05}' [--dry-run]
# 타임스탬프 이벤트를 편집 가능한 MIDI로 확정
npm run cli -- commit-midi-take take.json [--dry-run]
# 임시 음표 값을 WAV로 렌더 (프로젝트는 편집되지 않음)
npm run cli -- audition out.wav '{"clipId":"ID","updates":[{"noteId":"N","value":100}]}' [--duration 0.5] [--force]
# 컨트롤러 편집은 `command midi.controllers.*`를 사용하며 스키마는 `commands`에서 확인
npm run cli -- command midi.controllers.setValues '{...}' --dry-run
```

## 시간·템포·스냅

읽기 전용 조회(time-*)를 먼저 하고 그 다음 명시적으로 편집합니다. 설정 갱신은 리비전·지문 검사를 거치므로, 먼저 읽은 값을 그대로 붙여 갱신합니다.

```sh
# 주/타임라인/피아노 형식으로 시간 읽기
npm run cli -- time-display '{"tick":1920}'
# 현재 프로필 기준 정확한 음악적 위치·길이
npm run cli -- time-convert '{"tick":1920}'
# 저장된 스냅 값 조회
npm run cli -- time-snap '{"localTick":0}'
# 경과 시간 눈금 구간 조회
npm run cli -- time-ruler '{"fromPixel":0,"toPixel":800,"zoom":1}'
# 표시 PPQ와 길이 보정 읽기·갱신
npm run cli -- timing-settings [JSON]
# 형식 시간으로 노트·클립 편집 (반올림 명시)
npm run cli -- time-command CMD JSON TIMES [OPTIONS]
# 표시 틱 단위로 시간 필드 편집
npm run cli -- display-command CMD JSON TIMES
# 노트의 표시 시작·길이 편집
npm run cli -- note-time CLIP NOTE JSON
# 탭 간격으로 템포 계산·적용
npm run cli -- tap-tempo '{"tapTimesMs":[0,500,1000,1500]}' [--dry-run]
# 정렬된 마커 목록 읽기
npm run cli -- markers ['{"sortBy":"tick"}']
# MIDI 분할 공통 설정
npm run cli -- split-settings [JSON]
# Chase 종류 설정
npm run cli -- chase-settings [JSON]
# Reset 설정
npm run cli -- reset-settings [JSON]
# CC 메뉴·프리셋·새 이벤트 종류
npm run cli -- controller-settings [JSON]
```

## 가져오기와 오디오 준비

가져오기는 손실 경고를 출력하니 꼭 읽어 보세요. 오디오 처리는 비파괴이며 원본 바이트는 남아 복원할 수 있습니다.

```sh
# 세션으로 가져오기
npm run cli -- import FILE.wav|FILE.aiff|FILE.mid [--track-id ID] [--at-sample N]
# MIDI 가져오기 옵션 (--midi-auto-dissolve, --midi-tempo, --midi-signature, --midi-no-markers 등)
npm run cli -- import FILE.mid --midi-single-part --midi-position left-locator
# 최대 32개 파일 한 번에 가져오기
npm run cli -- import-many A.wav B.wav [--placement parallel|serial]
# 피크/RMS/DC 분석 (수치일 뿐 음악적 판단이 아님)
npm run cli -- audio-statistics CLIP_ID [raw|event]
# 비파괴 DC 제거
npm run cli -- remove-dc CLIP_ID [--dry-run]
# 비파괴 피크 노멀라이즈
npm run cli -- normalize-audio CLIP_ID [DBFS] [--dry-run]
# 가장 가까운 제로 크로싱 조회
npm run cli -- zero-crossing CLIP_ID AT_SAMPLE
# 클립 타임 스트레치 (외부 FFmpeg 필요)
npm run cli -- stretch-audio CLIP_ID '{"targetFrames":96000}' [--dry-run]
# 여러 클립 스트레치
npm run cli -- stretch-audio-batch '[{"clipId":"ID","targetFrames":96000}]' [--dry-run]
# 처리 이력(출처) 읽기
npm run cli -- audio-processing CLIP_ID
# 원본 설정으로 복원
npm run cli -- restore-audio-processing CLIP_ID [--dry-run]
```

## 렌더와 내보내기

내보내기는 --force 없이는 덮어쓰지 않습니다. 렌더는 스냅샷이라 이후 편집을 따라가지 않습니다. 렌더 길이는 꼬리 포함 최대 600초입니다.

```sh
# 전체 세션 렌더 (메타데이터 사이드카 포함)
npm run cli -- render sessions/mix.wav
# 로케이터 구간만 렌더
npm run cli -- render out.wav --locators --tail 1
# 출력 형식과 결정적 디더 (--file-format aiff, --output-sample-rate N, --channel-mode mono 등)
npm run cli -- render out.wav --sample-format pcm24 --dither tpdf --dither-seed 1
# 선택한 트랙만 렌더
npm run cli -- render out.wav --track-id ID --track-id ID2
# 정렬된 트랙별 WAV와 매니페스트 (ZIP 128 MiB까지)
npm run cli -- render-stems stems.zip [--split-channels] [--mixdown] [--cycle-marker-id ID]
# 서버 없이 스템을 하나씩 폴더로 (ZIP 한도 없음)
npm run cli -- offline-render-stems-dir PROJECT.json NEW_DIR
# 서버 없이 스템 ZIP
npm run cli -- offline-render-stems PROJECT.json stems.zip
# 서버 없는 읽기 전용 렌더
npm run cli -- offline-render PROJECT.json mix.wav
# 편집 가능한 MIDI (--track-id, --midi-no-* 옵션 등)
npm run cli -- export-midi out.mid [--midi-format 0|1] [--midi-ppq 480] [--locators]
# 프로젝트 JSON만 (오디오 미포함)
npm run cli -- export-project out.json
# 프로젝트와 검증된 미디어 ZIP (64 MiB까지)
npm run cli -- export-bundle backup.zip
```

## 저장·버전·백업·복구

편집은 자동 저장되고, 명시 저장은 Revert와 버전이 쓰는 기준점입니다. 복구 명령은 원본이나 백업을 덮어쓰지 않습니다.

```sh
# 명시 저장 (제목 없음은 새 이름 경로 필요)
npm run cli -- save [--output PATH]
# 다음 번호 파일로 저장·활성화
npm run cli -- save-new-version
# 새 이름으로 저장
npm run cli -- save-as NEW.json
# Revert로 버려질 내용 미리보기
npm run cli -- revert-plan
# 마지막 명시 저장으로 되돌리기
npm run cli -- revert PLAN_ID --confirm --media keep|trash
# 이전 Revert로 따로 옮겨진 미디어 목록
npm run cli -- revert-trash
# Revert 휴지통 항목 하나 복원 (덮어쓰기 없음)
npm run cli -- restore-revert-media ID
# 자동 백업과 설정 목록
npm run cli -- backups
# 지금 백업 (--force는 변경이 없어도)
npm run cli -- backup-now [--force]
# 자동 백업 설정 변경
npm run cli -- backup-settings '{"enabled":true,"intervalMinutes":10,"maxCount":20}' [--dry-run]
# 자동 백업을 새 파일로 복구
npm run cli -- recover-backup PROJECT.json BACKUP_ID --output NEW.json
# PROJECT.json.bak에서 새 파일로 복구
npm run cli -- recover PROJECT.json --output NEW.json
# 프로젝트와 모든 미디어를 새 폴더로 복사
npm run cli -- collect PROJECT.json NEW_DIR [--dry-run]
```

## 미디어 풀과 누락 파일

정확 복원은 원본 SHA-256을 검증합니다. 다른 파일로의 재연결은 별도의 검토 절차(검색 → 계획 → 수락)입니다.

```sh
# 미디어 해시 검증과 클립 참조 확인
npm run cli -- assets
# 정확한 원본 바이트 복원
npm run cli -- restore-asset ASSET_ID SOURCE.wav [--dry-run]
# 원본 컨테이너 보관 상태 목록
npm run cli -- source-archives
# 원본 컨테이너 내려받기·검증
npm run cli -- source-archive-download ID OUTPUT
# 누락된 정확한 원본 복원 (덮어쓰기 없음)
npm run cli -- source-archive-restore ID SOURCE
# 폴더에서 후보 검색
npm run cli -- media-search '{"assetId":"ID","location":"/folder","mode":"name"}'
# 진행 상황과 후보 읽기
npm run cli -- media-search-status ID
# 검색 중단 (찾은 후보는 유지)
npm run cli -- media-search-stop ID
# 재연결 미리보기
npm run cli -- media-plan '{"searchId":"S","candidateId":"C"}'
# 검토한 매핑 적용
npm run cli -- media-accept PLAN_ID [--allow-replacement]
# 누락 소스와 참조 클립 제거 (파일은 삭제하지 않음)
npm run cli -- remove-missing [--dry-run]
```

## macOS 네이티브 MIDI 출력 (선택)

Swift 툴체인이 필요합니다: `node scripts/build-native-midi.mjs`. MIDI만 보내며 오디오와 동기 재생하지 않습니다.

```sh
# 실제 CoreMIDI 입출력 목록
npm run cli -- native-ports
# 프로젝트의 모드와 경로 읽기·갱신
npm run cli -- native-settings [JSON]
# 네이티브 전송 상태
npm run cli -- native-status
# 라우팅된 MIDI 재생 시작
npm run cli -- native-play [--start-tick N]
# 현재 작업 정지
npm run cli -- native-stop [JOB_ID]
# 재생 취소와 설정된 포트의 16채널 리셋
npm run cli -- midi-reset
```
