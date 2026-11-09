# 11. 명령줄(CLI)

[← 차례](README.md) · [English](../en/11-cli.md)

마우스로 하는 모든 일은 명령을 입력해서도 할 수 있습니다. 명령줄은 브라우저와 **같은 열린 프로젝트**를 같은 검사와 같은 실행 취소 이력으로 편집합니다. 터미널에서 입력한 편집이 화면에 바로 나타나고, 브라우저의 실행 취소 버튼으로 되돌릴 수 있습니다. 스크립트, 일괄 작업, 로컬 AI 도우미(SovaFlow 등)가 이 방식으로 SovaRoll과 일합니다.

CLI가 *꼭* 필요하지는 않습니다. 궁금하다면 이 장이 첫 명령부터 안전한 자동화까지 안내합니다.

## 11.1 SovaRoll 폴더에서 터미널 열기

- **macOS**: 터미널을 열고 `cd `(공백 포함)를 입력한 뒤 `sovaroll-DAW` 폴더를 창으로 끌어다 놓고 Enter.
- **Windows**: 탐색기에서 폴더를 열고 주소창을 눌러 `cmd`를 입력하고 Enter.

열린 프로젝트를 편집하는 명령은 SovaRoll이 실행 중이어야 합니다(1장). `--url http://127.0.0.1:포트`를 붙이지 않으면 `http://127.0.0.1:4317`로 연결합니다.

## 11.2 내장 안내(서버 없이 동작)

```sh
npm run cli -- guide          # 매일의 루틴과 주제
npm run cli -- guide edit     # 주제 하나: start, projects, edit, time, import, export, save, media, native, all
npm run cli -- --help         # 모든 명령
```

## 11.3 매일의 루틴

| 단계 | 명령 |
|---|---|
| 시작 | `npm start`(또는 더블클릭 실행 파일) |
| 어떤 곡이 열렸나? | `npm run cli -- document` |
| 적용하지 않고 편집 검사 | `npm run cli -- command 이름 'JSON' --dry-run` |
| 적용 | `npm run cli -- command 이름 'JSON'` |
| 기준점 저장 | `npm run cli -- save` |
| 내보내기 | `npm run cli -- render mix.wav` · `npm run cli -- export-midi song.mid` |
| 백업 | `npm run cli -- export-bundle backup.zip` |

## 11.4 편집 명령을 안전하게

모든 편집은 JSON 인자를 받는 이름 있는 **명령**입니다. 인자 규칙과 함께 목록을 봅니다.

```sh
npm run cli -- commands
```

먼저 `--dry-run`으로 시험하세요. SovaRoll이 완전히 검사하고 무엇이 *바뀔지* 알려 주지만 아무것도 바꾸지 않습니다. 아래 `TRACK_ID`와 `CLIP_ID`는 실제 프로젝트의 ID로 바꿔야 합니다.

```sh
npm run cli -- command track.add '{"type":"midi","name":"Strings"}' --dry-run
npm run cli -- command track.add '{"type":"midi","name":"Strings"}'
npm run cli -- command track.update '{"trackId":"TRACK_ID","gainDb":-6}' --dry-run
npm run cli -- command track.update '{"trackId":"TRACK_ID","gainDb":-6}'
npm run cli -- command midi.notes.transpose '{"clipId":"CLIP_ID","semitones":2}'
```

안전 규칙:

- 실제 프로젝트의 ID를 쓰세요. `npm run cli -- status`는 프로젝트 전체를 출력하며, 트랙 ID는 `project.tracks`, 클립 ID는 `project.clips` 아래에 있습니다. 예제의 ID를 복사하지 마세요.
- `--revision N`은 그사이 다른 편집이 있으면 거부합니다.
- `npm run cli -- batch edits.json`은 명령 목록을 **한 단계**로 적용합니다. 전부 성공하거나 아무것도 바뀌지 않고, 실행 취소 한 번에 모두 되돌아갑니다.
- `npm run cli -- command history.undo '{}'`와 `history.redo`는 브라우저와 같은 이력으로 실행 취소/다시 실행합니다.
- Windows `cmd`에서는 JSON 안 큰따옴표를 이스케이프해야 합니다: `"{\"type\":\"midi\"}"`. PowerShell은 macOS처럼 작은따옴표를 씁니다.

## 11.5 가져오기와 이력

```sh
npm run cli -- import voice.wav --at-sample 48000      # 1초 위치(48 kHz 프로젝트)
npm run cli -- import song.mid --midi-tempo preserve
npm run cli -- import-many a.wav b.wav --placement serial
npm run cli -- history
```

## 11.6 내보내기

```sh
npm run cli -- render mix.wav                       # 전체 곡 + 꼬리
npm run cli -- render part.wav --locators           # Locator 구간
npm run cli -- render mix.aiff --file-format aiff --sample-format pcm24
npm run cli -- render-stems stems.zip
npm run cli -- export-midi song.mid --midi-format 1 --midi-ppq 480
npm run cli -- export-musicxml score.musicxml
npm run cli -- export-bundle backup.zip
node src/cli.mjs offline-render /경로/Song.newdaw.json /경로/mix.wav   # 서버 없이
```

## 11.7 프로젝트·저장·복구

```sh
npm run cli -- init "$HOME/Music/SovaRoll/New Song/New Song.newdaw.json"
npm run cli -- serve --project "$HOME/Music/SovaRoll/New Song/New Song.newdaw.json" --port 4318
npm run cli -- projects
npm run cli -- save-new-version
npm run cli -- revert-plan            # 이어서: revert PLAN_ID --confirm --media keep
npm run cli -- backups                # 자동백업 목록
npm run cli -- assets                 # 미디어 파일 검증
```

## 11.8 마커·시간 등

```sh
npm run cli -- markers
npm run cli -- markers '{"sortBy":"name"}'
npm run cli -- time-convert '{"tick":3840}'
npm run cli -- tap-tempo '{"tapTimesMs":[0,625,1250,1875]}' --dry-run
```

모든 옵션의 전체 참고는 [CLI 가이드](../../CLI-GUIDE.ko.md)와 [CLI 레퍼런스](../../CLI.md), 그리고 언제나 `npm run cli -- --help`에 있습니다.

---
[← 10. 내보내기](10-export.md) · 다음: [12. 참고 자료 →](12-reference.md)
