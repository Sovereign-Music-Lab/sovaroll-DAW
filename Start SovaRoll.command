#!/bin/bash
# Double-click on macOS to start SovaRoll and open it in your browser.
# Your songs are kept in ~/Music/SovaRoll (outside this app folder), so updating or deleting the app never touches them.
cd "$(dirname "$0")" || exit 1
say() { echo "$1"; echo "$2"; }
if ! command -v node >/dev/null 2>&1; then
  say "Node.js is not installed. Install the LTS version (22 or newer) from https://nodejs.org, then double-click this file again." \
      "Node.js가 없습니다. https://nodejs.org 에서 LTS(22 이상)를 설치한 뒤 이 파일을 다시 더블클릭하세요."
  read -r -p "Press Enter to close / Enter를 누르면 닫힙니다 " _; exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 22 ]; then
  say "Node.js $MAJOR is too old. Install Node.js 22 or newer from https://nodejs.org." "Node.js $MAJOR 버전은 너무 오래됐습니다. https://nodejs.org 에서 22 이상을 설치하세요."
  read -r -p "Press Enter to close / Enter를 누르면 닫힙니다 " _; exit 1
fi
PORT="${SOVAROLL_PORT:-4317}"
SONG_DIR="${SOVAROLL_SONG_DIR:-$HOME/Music/SovaRoll/My First Song}"
PROJECT="$SONG_DIR/My First Song.newdaw.json"
if curl -s "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  say "SovaRoll is already running. Opening the browser." "SovaRoll이 이미 실행 중입니다. 브라우저를 엽니다."
  open "http://127.0.0.1:$PORT"; exit 0
fi
mkdir -p "$SONG_DIR"
[ -f "$PROJECT" ] || node src/cli.mjs init "$PROJECT" >/dev/null
say "Starting SovaRoll with: $PROJECT" "SovaRoll 시작: $PROJECT"
say "Keep this window open while you work. To quit: stop playback, then press Ctrl+C here (or close this window)." \
    "작업하는 동안 이 창을 열어 두세요. 끝낼 때: 재생을 멈추고 이 창에서 Ctrl+C (또는 창 닫기)."
( for i in $(seq 1 40); do curl -s "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && { open "http://127.0.0.1:$PORT"; break; }; sleep 0.5; done ) &
node src/cli.mjs serve --project "$PROJECT" --port "$PORT"
