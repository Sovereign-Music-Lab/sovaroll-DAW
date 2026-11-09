// Routine-based CLI guide shared by `sovaroll guide` and docs/CLI-GUIDE.*.md.
// Every command below is an action of src/cli.mjs. Keep this list in sync with --help.
const C = 'npm run cli --';

export const GUIDE_TOPICS = [
  {
    id: 'start',
    title: { en: 'Start and stop', ko: '시작과 종료' },
    intro: {
      en: 'The server holds the open project. Most commands talk to it; keep it running in one terminal and use a second terminal for commands.',
      ko: '서버가 열린 프로젝트를 들고 있습니다. 대부분의 명령은 서버와 통신하므로 한 터미널에서 서버를 켜 두고 다른 터미널에서 명령을 실행합니다.'
    },
    steps: [
      ['npm start', 'Start GUI + command server on port 4317 (Ctrl+C stops it)', 'GUI와 명령 서버를 4317 포트로 시작 (Ctrl+C로 종료)'],
      ['npm start -- --port 4318', 'Use another port; add --url http://127.0.0.1:4318 to later commands', '다른 포트 사용. 이후 명령에 --url http://127.0.0.1:4318 추가'],
      ['node src/cli.mjs init ~/Music/SovaRoll/Song/Song.newdaw.json', 'Create a blank project (refuses to overwrite; add --demo for a demo)', '빈 프로젝트 만들기 (덮어쓰기 거부, --demo는 데모 생성)'],
      ['node src/cli.mjs serve --project ~/Music/SovaRoll/Song/Song.newdaw.json --port 4318', 'Open a specific project', '특정 프로젝트로 서버 시작'],
      [`${C} guide [TOPIC|all]`, 'This guide, offline (no server needed)', '이 가이드 (오프라인, 서버 불필요)'],
      [`${C} status`, 'Read project state (changes nothing)', '프로젝트 상태 읽기 (아무것도 바꾸지 않음)'],
      [`${C} document`, 'Show active filename and the explicit Save checkpoint', '활성 파일 이름과 명시 저장 지점 확인']
    ]
  },
  {
    id: 'projects',
    title: { en: 'Open, create and switch projects', ko: '프로젝트 열기·만들기·전환' },
    intro: {
      en: 'Workspace commands are two-step: a *-plan command inspects, then the matching command applies the plan ID. Nothing changes until you apply.',
      ko: '워크스페이스 명령은 두 단계입니다. *-plan 명령으로 검사한 뒤, 출력된 PLAN_ID를 적용 명령에 넘깁니다. 적용 전에는 아무것도 바뀌지 않습니다.'
    },
    steps: [
      [`${C} projects`, 'List open projects and the active one', '열린 프로젝트와 활성 프로젝트 목록'],
      [`${C} project-open-plan PATH [--inactive]`, 'Inspect a file to add to the workspace', '워크스페이스에 추가할 파일 검사'],
      [`${C} project-open-recent-plan ENTRY_ID [--inactive]`, 'Inspect a recent project to add to the workspace', '최근 프로젝트를 워크스페이스에 추가하기 전 검사'],
      [`${C} project-open PLAN_ID --current preserve|save [--dry-run]`, 'Apply the open plan; choose what happens to the current project', '열기 계획 적용 (현재 프로젝트를 그대로/저장 후 둘지 선택)'],
      [`${C} project-activate-plan DOCUMENT_ID`, 'Plan switching the active project', '활성 프로젝트 전환 계획'],
      [`${C} project-activate PLAN_ID --current preserve|save`, 'Apply the switch', '전환 적용'],
      [`${C} project-close-plan DOCUMENT_ID`, 'Plan closing one document (never auto-activates another)', '문서 하나 닫기 계획 (다른 문서를 자동 활성화하지 않음)'],
      [`${C} project-close PLAN_ID --current preserve|save`, 'Apply the close', '닫기 적용'],
      [`${C} project-new-plan [FOLDER] [--sample-rate N] [--folder-name NAME] [--chosen-folder PATH]`, 'Plan a new (Untitled) project', '새(제목 없음) 프로젝트 계획'],
      [`${C} project-new PLAN_ID --current preserve|save [--save-output PATH]`, 'Create it', '새 프로젝트 생성'],
      [`${C} project-folders [PATH] [--cursor N]`, 'Browse local folders (read-only)', '로컬 폴더 탐색 (읽기 전용)'],
      [`${C} project-locations`, 'Read default/prompt location preferences', '기본 위치 설정 읽기'],
      [`${C} project-location-settings '{"locationMode":"default","defaultLocation":"/path"}' [--location-revision N]`, 'Save location preferences', '위치 설정 저장'],
      [`${C} recent`, 'List recent projects with missing/changed diagnostics', '최근 프로젝트와 누락·변경 진단'],
      [`${C} open-recent-plan ENTRY_ID`, 'Inspect a recent project', '최근 프로젝트 검사'],
      [`${C} open-plan PATH`, 'Inspect an existing project (legacy replacement flow)', '기존 프로젝트 검사 (구형 교체 흐름)'],
      [`${C} open PLAN_ID --current preserve|save`, 'Legacy: close the old file and activate the inspected one', '구형: 이전 파일을 닫고 검사한 파일 활성화'],
      [`${C} recent-remove ENTRY_ID`, 'Remove one recent-list entry (not the project)', '최근 목록 항목 하나 제거 (프로젝트는 그대로)'],
      [`${C} recent-clear --confirm`, 'Clear only the recent list', '최근 목록만 비우기'],
      [`${C} drafts`, 'List Untitled recovery records', '제목 없음 복구 기록 목록'],
      [`${C} project-recover-plan DRAFT_ID`, 'Plan recovering an Untitled draft', '초안 복구 계획'],
      [`${C} project-recover PLAN_ID --current preserve|save [--save-output PATH]`, 'Recover the draft', '초안 복구']
    ]
  },
  {
    id: 'edit',
    title: { en: 'Edit with commands (the core routine)', ko: '명령으로 편집하기 (핵심 루틴)' },
    intro: {
      en: 'Routine: look → dry-run → apply → check history. IDs come from `status`, never from copied examples. --revision N rejects the edit if someone else changed the project first.',
      ko: '루틴: 확인 → --dry-run → 적용 → 이력 확인. ID는 예제 복사가 아니라 `status` 결과에서 가져옵니다. --revision N을 주면 그 사이 다른 편집이 있었을 때 거부됩니다.'
    },
    steps: [
      [`${C} commands`, 'List every engine command and its schema', '모든 엔진 명령과 스키마 목록'],
      [`${C} command track.add '{"type":"midi","name":"Piano"}' --dry-run`, 'Validate without changing anything', '변경 없이 검증만'],
      [`${C} command track.add '{"type":"midi","name":"Piano"}'`, 'Apply one command (one undo step)', '명령 하나 적용 (undo 한 단계)'],
      [`${C} command track.update '{"trackId":"ID","gainDb":-9}' --revision N`, 'Guard against concurrent edits', '동시 편집 충돌 방지'],
      [`${C} batch commands.json [--dry-run]`, 'Apply an array of commands atomically as ONE undo step', '명령 배열을 원자적으로, undo 한 단계로 적용'],
      [`${C} history`, 'List edit actions and the undo/redo boundary', '편집 이력과 undo/redo 위치'],
      [`${C} select-clips '{"mode":"all"}'`, 'Query a clip selection (no edits); mode: all|none|invert|inLoop|outsideLoop|beforeCursor|afterCursor|atCursor|tracks', '클립 선택 조회 (편집 없음). mode: all|none|invert|inLoop|outsideLoop|beforeCursor|afterCursor|atCursor|tracks'],
      [`${C} copy-clips OUT.newdaw-clips.json '{"clipIds":["ID"]}'`, 'Save a read-only selection snapshot', '선택 스냅샷 저장 (읽기 전용)'],
      [`${C} paste-clips IN.newdaw-clips.json '{"atTick":0}' [--dry-run]`, 'Paste a snapshot at a tick/sample or original position', '스냅샷을 지정 위치/원래 위치에 붙여넣기'],
      [`${C} resize-midi-parts '{"clipIds":["ID"],"deltaTicks":480}' [--dry-run]`, 'Resize MIDI parts; source notes are preserved', 'MIDI 파트 길이 조정 (원본 음표 보존)'],
      [`${C} split-zero '{"atTick":1920}' [--dry-run]`, 'Atomic split at zero crossings', '제로 크로싱에서 원자적 분할'],
      [`${C} trim-clips '{"clipIds":["ID"],"edge":"left","seconds":0.1}' [--dry-run]`, 'Trim audio clip edges', '오디오 클립 가장자리 트림'],
      [`${C} slip-clips '{"clipIds":["ID"],"seconds":0.05}' [--dry-run]`, 'Slip audio source inside the clip', '클립 안에서 원본 슬립'],
      [`${C} commit-midi-take take.json [--dry-run]`, 'Commit timestamped events as editable MIDI', '타임스탬프 이벤트를 편집 가능한 MIDI로 확정'],
      [`${C} audition out.wav '{"clipId":"ID","updates":[{"noteId":"N","value":100}]}' [--duration 0.5] [--force]`, 'Render temporary note values to a WAV; the project is not edited', '임시 음표 값을 WAV로 렌더 (프로젝트는 편집되지 않음)'],
      [`${C} command midi.controllers.setValues '{...}' --dry-run`, 'Controller edits use `command midi.controllers.*`; get the schema from `commands`', '컨트롤러 편집은 `command midi.controllers.*`를 사용하며 스키마는 `commands`에서 확인']
    ]
  },
  {
    id: 'time',
    title: { en: 'Time, tempo and snap', ko: '시간·템포·스냅' },
    intro: {
      en: 'Read-only queries first (time-*), then explicit edits. Settings updates use revision + fingerprint checks; read the setting, then send the update back with what you read.',
      ko: '읽기 전용 조회(time-*)를 먼저 하고 그 다음 명시적으로 편집합니다. 설정 갱신은 리비전·지문 검사를 거치므로, 먼저 읽은 값을 그대로 붙여 갱신합니다.'
    },
    steps: [
      [`${C} time-display '{"tick":1920}'`, 'Read project time in primary/timeline/piano format', '주/타임라인/피아노 형식으로 시간 읽기'],
      [`${C} time-convert '{"tick":1920}'`, 'Exact musical position/duration with the current profile', '현재 프로필 기준 정확한 음악적 위치·길이'],
      [`${C} time-snap '{"localTick":0}'`, 'Query saved primary/piano snap', '저장된 스냅 값 조회'],
      [`${C} time-ruler '{"fromPixel":0,"toPixel":800,"zoom":1}'`, 'Read bounded elapsed-format ruler intervals', '경과 시간 눈금 구간 조회'],
      [`${C} timing-settings [JSON]`, 'Read/update shared display PPQ and Length Adjustment', '표시 PPQ와 길이 보정 읽기·갱신'],
      [`${C} time-command CMD JSON TIMES [OPTIONS]`, 'Edit MIDI note/clip formatted times with explicit rounding', '형식 시간으로 노트·클립 편집 (반올림 명시)'],
      [`${C} display-command CMD JSON TIMES`, 'Edit explicit time fields in shared display ticks', '표시 틱 단위로 시간 필드 편집'],
      [`${C} note-time CLIP NOTE JSON`, 'Edit a note\'s displayed start/length', '노트의 표시 시작·길이 편집'],
      [`${C} tap-tempo '{"tapTimesMs":[0,500,1000,1500]}' [--dry-run]`, 'Compute/apply tempo from taps', '탭 간격으로 템포 계산·적용'],
      [`${C} markers ['{"sortBy":"tick"}']`, 'Read the sorted marker list', '정렬된 마커 목록 읽기'],
      [`${C} split-settings [JSON]`, 'Read/update common MIDI split preferences', 'MIDI 분할 공통 설정'],
      [`${C} chase-settings [JSON]`, 'Read/update Chase types', 'Chase 종류 설정'],
      [`${C} reset-settings [JSON]`, 'Read/update Reset preferences', 'Reset 설정'],
      [`${C} controller-settings [JSON]`, 'Read/update CC menu, presets, New Event Type', 'CC 메뉴·프리셋·새 이벤트 종류']
    ]
  },
  {
    id: 'import',
    title: { en: 'Import and prepare audio', ko: '가져오기와 오디오 준비' },
    intro: {
      en: 'Import prints loss warnings; read them. Audio processing is non-destructive: the original source bytes stay and can be restored.',
      ko: '가져오기는 손실 경고를 출력하니 꼭 읽어 보세요. 오디오 처리는 비파괴이며 원본 바이트는 남아 복원할 수 있습니다.'
    },
    steps: [
      [`${C} import FILE.wav|FILE.aiff|FILE.mid [--track-id ID] [--at-sample N]`, 'Import into the session', '세션으로 가져오기'],
      [`${C} import FILE.mid --midi-single-part --midi-position left-locator`, 'MIDI import options (also --midi-auto-dissolve, --midi-tempo, --midi-signature, --midi-no-markers)', 'MIDI 가져오기 옵션 (--midi-auto-dissolve, --midi-tempo, --midi-signature, --midi-no-markers 등)'],
      [`${C} import-many A.wav B.wav [--placement parallel|serial]`, 'Import up to 32 files at once', '최대 32개 파일 한 번에 가져오기'],
      [`${C} audio-statistics CLIP_ID [raw|event]`, 'Peak / RMS / DC analysis (a number, not a musical judgment)', '피크/RMS/DC 분석 (수치일 뿐 음악적 판단이 아님)'],
      [`${C} remove-dc CLIP_ID [--dry-run]`, 'Non-destructive DC correction', '비파괴 DC 제거'],
      [`${C} normalize-audio CLIP_ID [DBFS] [--dry-run]`, 'Non-destructive peak normalization', '비파괴 피크 노멀라이즈'],
      [`${C} zero-crossing CLIP_ID AT_SAMPLE`, 'Nearest zero crossing (read-only)', '가장 가까운 제로 크로싱 조회'],
      [`${C} stretch-audio CLIP_ID '{"targetFrames":96000}' [--dry-run]`, 'Time-stretch one clip (needs external FFmpeg)', '클립 타임 스트레치 (외부 FFmpeg 필요)'],
      [`${C} stretch-audio-batch '[{"clipId":"ID","targetFrames":96000}]' [--dry-run]`, 'Stretch several clips', '여러 클립 스트레치'],
      [`${C} audio-processing CLIP_ID`, 'Read processing provenance', '처리 이력(출처) 읽기'],
      [`${C} restore-audio-processing CLIP_ID [--dry-run]`, 'Restore the original source settings', '원본 설정으로 복원']
    ]
  },
  {
    id: 'export',
    title: { en: 'Render and export', ko: '렌더와 내보내기' },
    intro: {
      en: 'Exports never overwrite unless you pass --force. A render is a snapshot; it does not follow later edits. The render window is limited to 600 seconds including the tail.',
      ko: '내보내기는 --force 없이는 덮어쓰지 않습니다. 렌더는 스냅샷이라 이후 편집을 따라가지 않습니다. 렌더 길이는 꼬리 포함 최대 600초입니다.'
    },
    steps: [
      [`${C} render sessions/mix.wav`, 'Render the whole session (+ metadata sidecar)', '전체 세션 렌더 (메타데이터 사이드카 포함)'],
      [`${C} render out.wav --locators --tail 1`, 'Render only the Locator range', '로케이터 구간만 렌더'],
      [`${C} render out.wav --sample-format pcm24 --dither tpdf --dither-seed 1`, 'Output format, deterministic dither (also --file-format aiff, --output-sample-rate N, --channel-mode mono)', '출력 형식과 결정적 디더 (--file-format aiff, --output-sample-rate N, --channel-mode mono 등)'],
      [`${C} render out.wav --track-id ID --track-id ID2`, 'Render only these tracks', '선택한 트랙만 렌더'],
      [`${C} render-stems stems.zip [--split-channels] [--mixdown] [--cycle-marker-id ID]`, 'Aligned per-track WAVs + manifest (ZIP up to 128 MiB)', '정렬된 트랙별 WAV와 매니페스트 (ZIP 128 MiB까지)'],
      [`${C} offline-render-stems-dir PROJECT.json NEW_DIR`, 'Server-less stems, one WAV at a time, no ZIP cap', '서버 없이 스템을 하나씩 폴더로 (ZIP 한도 없음)'],
      [`${C} offline-render-stems PROJECT.json stems.zip`, 'Server-less stem ZIP', '서버 없이 스템 ZIP'],
      [`${C} offline-render PROJECT.json mix.wav`, 'Server-less read-only render', '서버 없는 읽기 전용 렌더'],
      [`${C} export-midi out.mid [--midi-format 0|1] [--midi-ppq 480] [--locators]`, 'Editable MIDI (also --track-id, --midi-no-patch/-no-volume-pan/-no-modifiers/-no-markers/-no-delay)', '편집 가능한 MIDI (--track-id, --midi-no-* 옵션 등)'],
      [`${C} export-project out.json`, 'Project JSON only; audio is NOT included', '프로젝트 JSON만 (오디오 미포함)'],
      [`${C} export-bundle backup.zip`, 'Project + verified media ZIP (up to 64 MiB)', '프로젝트와 검증된 미디어 ZIP (64 MiB까지)']
    ]
  },
  {
    id: 'save',
    title: { en: 'Save, versions, backup and recovery', ko: '저장·버전·백업·복구' },
    intro: {
      en: 'Edits autosave; explicit Save sets the reference point that Revert and versions use. Recovery commands never overwrite the source or its backup.',
      ko: '편집은 자동 저장되고, 명시 저장은 Revert와 버전이 쓰는 기준점입니다. 복구 명령은 원본이나 백업을 덮어쓰지 않습니다.'
    },
    steps: [
      [`${C} save [--output PATH]`, 'Explicit Save (Untitled needs a new named path)', '명시 저장 (제목 없음은 새 이름 경로 필요)'],
      [`${C} save-new-version`, 'Save and activate the next numbered filename', '다음 번호 파일로 저장·활성화'],
      [`${C} save-as NEW.json`, 'Save under another new name', '새 이름으로 저장'],
      [`${C} revert-plan`, 'Preview what Revert would discard', 'Revert로 버려질 내용 미리보기'],
      [`${C} revert PLAN_ID --confirm --media keep|trash`, 'Return to the last explicit Save', '마지막 명시 저장으로 되돌리기'],
      [`${C} revert-trash`, 'List media moved aside by past Reverts', '이전 Revert로 따로 옮겨진 미디어 목록'],
      [`${C} restore-revert-media ID`, 'Restore one Revert trash operation (no overwrite)', 'Revert 휴지통 항목 하나 복원 (덮어쓰기 없음)'],
      [`${C} backups`, 'List automatic backups and settings', '자동 백업과 설정 목록'],
      [`${C} backup-now [--force]`, 'Back up now (--force even when unchanged)', '지금 백업 (--force는 변경이 없어도)'],
      [`${C} backup-settings '{"enabled":true,"intervalMinutes":10,"maxCount":20}' [--dry-run]`, 'Change automatic backup settings', '자동 백업 설정 변경'],
      [`${C} recover-backup PROJECT.json BACKUP_ID --output NEW.json`, 'Recover an automatic backup to a new file', '자동 백업을 새 파일로 복구'],
      [`${C} recover PROJECT.json --output NEW.json`, 'Recover from PROJECT.json.bak to a new file', 'PROJECT.json.bak에서 새 파일로 복구'],
      [`${C} collect PROJECT.json NEW_DIR [--dry-run]`, 'Copy a project and all media into a new folder', '프로젝트와 모든 미디어를 새 폴더로 복사']
    ]
  },
  {
    id: 'media',
    title: { en: 'Media pool and missing files', ko: '미디어 풀과 누락 파일' },
    intro: {
      en: 'Exact restore verifies the original SHA-256. Relinking to a different file is a separate, reviewed operation (search → plan → accept).',
      ko: '정확 복원은 원본 SHA-256을 검증합니다. 다른 파일로의 재연결은 별도의 검토 절차(검색 → 계획 → 수락)입니다.'
    },
    steps: [
      [`${C} assets`, 'Verify media hashes and show clip references', '미디어 해시 검증과 클립 참조 확인'],
      [`${C} restore-asset ASSET_ID SOURCE.wav [--dry-run]`, 'Restore exact original bytes', '정확한 원본 바이트 복원'],
      [`${C} source-archives`, 'List original-container archives', '원본 컨테이너 보관 상태 목록'],
      [`${C} source-archive-download ID OUTPUT`, 'Download and verify an original container', '원본 컨테이너 내려받기·검증'],
      [`${C} source-archive-restore ID SOURCE`, 'Restore a missing exact original (no overwrite)', '누락된 정확한 원본 복원 (덮어쓰기 없음)'],
      [`${C} media-search '{"assetId":"ID","location":"/folder","mode":"name"}'`, 'Search a folder for candidates', '폴더에서 후보 검색'],
      [`${C} media-search-status ID`, 'Read progress and candidates', '진행 상황과 후보 읽기'],
      [`${C} media-search-stop ID`, 'Stop a search, keep what was found', '검색 중단 (찾은 후보는 유지)'],
      [`${C} media-plan '{"searchId":"S","candidateId":"C"}'`, 'Preview a relink', '재연결 미리보기'],
      [`${C} media-accept PLAN_ID [--allow-replacement]`, 'Apply the reviewed mapping', '검토한 매핑 적용'],
      [`${C} remove-missing [--dry-run]`, 'Remove missing sources and their clips (never deletes files)', '누락 소스와 참조 클립 제거 (파일은 삭제하지 않음)']
    ]
  },
  {
    id: 'native',
    title: { en: 'macOS native MIDI output (optional)', ko: 'macOS 네이티브 MIDI 출력 (선택)' },
    intro: {
      en: 'Needs the Swift toolchain: `node scripts/build-native-midi.mjs`. Sends MIDI only, not synchronized audio.',
      ko: 'Swift 툴체인이 필요합니다: `node scripts/build-native-midi.mjs`. MIDI만 보내며 오디오와 동기 재생하지 않습니다.'
    },
    steps: [
      [`${C} native-ports`, 'List real CoreMIDI sources/destinations', '실제 CoreMIDI 입출력 목록'],
      [`${C} native-settings [JSON]`, 'Read/update this project\'s mode and routes', '프로젝트의 모드와 경로 읽기·갱신'],
      [`${C} native-status`, 'Read the native transport state', '네이티브 전송 상태'],
      [`${C} native-play [--start-tick N]`, 'Start routed MIDI', '라우팅된 MIDI 재생 시작'],
      [`${C} native-stop [JOB_ID]`, 'Stop the current job', '현재 작업 정지'],
      [`${C} midi-reset`, 'Cancel playback and reset configured ports on all 16 channels', '재생 취소와 설정된 포트의 16채널 리셋']
    ]
  }
];

const ALIASES = { setup: 'start', run: 'start', project: 'projects', workspace: 'projects', editing: 'edit', commands: 'edit', audio: 'import', render: 'export', backup: 'save', recovery: 'save', files: 'media', midi: 'native' };

export function guideTopicIds() { return GUIDE_TOPICS.map((t) => t.id); }

export function renderGuide(topic) {
  const id = topic === undefined ? undefined : (ALIASES[topic] ?? topic);
  if (id !== undefined && id !== 'all' && !GUIDE_TOPICS.some((t) => t.id === id)) {
    throw new Error(`Unknown guide topic "${topic}". Choose one of: ${guideTopicIds().join(', ')}, all`);
  }
  const lines = [];
  if (id === undefined) {
    lines.push('SovaRoll CLI guide / CLI 가이드', '');
    lines.push('Daily routine / 매일의 루틴:');
    lines.push('  1. npm start                      (terminal 1 / 터미널 1)');
    lines.push('  2. npm run cli -- status          (check project / 프로젝트 확인)');
    lines.push('  3. npm run cli -- command ... --dry-run   (check an edit / 편집 검증)');
    lines.push('  4. npm run cli -- command ...     (apply / 적용)');
    lines.push('  5. npm run cli -- save            (explicit Save / 명시 저장)');
    lines.push('  6. npm run cli -- export-bundle backup.zip   (backup / 백업)', '');
    lines.push('Topics / 주제: npm run cli -- guide TOPIC');
    for (const t of GUIDE_TOPICS) lines.push(`  ${t.id.padEnd(9)} ${t.title.en} / ${t.title.ko}`);
    lines.push('  all       Everything / 전체');
    lines.push('', 'Every command: npm run cli -- --help   Full docs: docs/CLI-GUIDE.en.md · docs/CLI-GUIDE.ko.md');
    return lines.join('\n');
  }
  for (const t of GUIDE_TOPICS.filter((x) => id === 'all' || x.id === id)) {
    lines.push(`## ${t.title.en} / ${t.title.ko}`, `${t.intro.en}`, `${t.intro.ko}`, '');
    for (const [cmd, en, ko] of t.steps) lines.push(`  ${cmd}`, `      ${en}`, `      ${ko}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderGuideMarkdown(lang) {
  const out = [];
  for (const t of GUIDE_TOPICS) {
    out.push(`## ${t.title[lang]}`, '', t.intro[lang], '', '```sh');
    for (const [cmd, en, ko] of t.steps) out.push(`# ${lang === 'ko' ? ko : en}`, cmd);
    out.push('```', '');
  }
  return out.join('\n');
}
