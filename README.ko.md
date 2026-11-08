# Sovereign DAW / SovaRoll

**Authors / Project credits:** [Hee-sung Kang · 강희성](https://ikoffices.com/) · [Do-won Lee · 이도원](https://music.bugs.co.kr/artist/80353758?wl_ref=list_ar_02_search) · [Sungmo Park · 박성모](mailto:vividsaebom@gmail.com)

[Organization](https://github.com/Sovereign-Music-Lab) · [Website](https://sovereign-music-lab.github.io/) · [DeepChord](https://github.com/Sovereign-Music-Lab/DeepChord) · [Sovereign DAW](https://github.com/Sovereign-Music-Lab/sovaroll-DAW) · [Sovereign Flow](https://github.com/Sovereign-Music-Lab/SovaFlow)

## 초록
**The Sovereign MIDI Workstation · 프로급 오픈소스 DAW 개발 프로젝트**

[English](README.md) · [한국어 설명서](docs/MANUAL.ko.md) · [English manual](docs/MANUAL.en.md) · [철학](PHILOSOPHY.ko.md) · [Philosophy](PHILOSOPHY.en.md)

SovaRoll은 Sovereign Music Lab의 로컬 MIDI·오디오 워크스테이션, **소버린 DAW**입니다. 브라우저 화면과 CLI가 같은 프로젝트, 명령 엔진, 검증과 실행 취소 이력을 공유합니다. 음악을 편집 가능한 상태로 유지하고, 자신의 컴퓨터에서 작업하며, 선택한 제작 도구로 MIDI와 오디오를 이어갈 수 있게 만듭니다.

**0.129.0은 개발 중인 버전입니다.** 프로급 제작 환경을 목표로 합니다. 현재 재생은 렌더된 오디오 스냅샷을 사용하며, 저지연 네이티브 오디오, 플러그인 호스팅, 악보 편집기와 화면 전체의 영어·한국어 전환은 앞으로의 과제입니다. 현재 화면은 한국어 중심이며 두 언어의 사용 설명서를 제공합니다.

## 목차

- [시작하기](#시작하기)
- [포함된 기능](#포함된-기능)
- [전체 작업 흐름](#전체-작업-흐름)
- [앞으로의 Gemma 4 개발](#앞으로의-gemma-4-개발)
- [라이선스](#라이선스)
- [개발 인계](#개발-인계)

## 시작하기

**Node.js 22 이상**과 Git을 설치합니다. 여기서 검증한 브라우저 작업에는 데스크톱 Chrome을 사용합니다. 기본 실행에는 npm 패키지 설치, LLM, 모델 가중치, 계정, 다른 저장소가 필요하지 않습니다.

```sh
git clone https://github.com/Sovereign-Music-Lab/sovaroll-DAW.git
cd sovaroll-DAW
npm start
```

[로컬 워크스테이션](http://127.0.0.1:4317)을 엽니다. 첫 실행은 `sessions/`에 짧은 합성 데모를 만들고, 기존 프로젝트가 있으면 보존합니다. 종료는 터미널에서 **Ctrl+C**입니다. [설명서](docs/MANUAL.ko.md)에 빈 프로젝트, 일상 작업, 저장, 백업, 내보내기, 문제 해결, 업데이트와 작업물을 보존하는 삭제 방법을 정리했습니다.

4317 포트를 사용 중이라면:

```sh
npm start -- --port 4318
```

[4318 포트](http://127.0.0.1:4318)를 열고, 해당 서버에 연결하는 CLI 명령에는 `--url http://127.0.0.1:4318`을 붙입니다.

## 포함된 기능

- MIDI 피아노롤, 노트·컨트롤러 편집, 클립, 트랙 폴더, 시간·퀀타이즈·스텝 입력과 Undo/Redo.
- WAV/AIFF·MIDI 가져오기, 오디오 클립 편집, 브라우저 녹음, 믹서, WAV·MIDI·프로젝트 묶음 내보내기.
- 로컬 프로젝트, 명시 저장, 버전 저장, 자동 백업·복구와 미디어 무결성 확인.
- 사람과 에이전트가 함께 사용하는 명령 인터페이스: 검증, 미리 검사, 리비전 충돌 거부와 원자적 일괄 편집.
- 선택적 macOS CoreMIDI 출력. MIDI만 전송하며 네이티브 오디오와 동기 재생하지 않습니다.
- 제품 테스트, 브라우저 인수 테스트, 개발 노트, 작업 큐와 로컬 에이전트 하네스.

[개발 노트](docs/DEVELOPMENT.ko.md), [English development notes](docs/DEVELOPMENT.en.md), [요건표](docs/agent/REQUIREMENTS.md), [검증 기록](docs/VALIDATION.md)에서 구현된 기능, 실제 검증한 범위와 남은 작업을 확인할 수 있습니다.

## 전체 작업 흐름

**인간 → 로컬 LLM(선택적 RAG·LoRA) → 소버린 DAW → 자율형 작곡 → Logic Pro MCP → 결과 → 인간 피드백 → 반복.**

소버린 DAW는 독립적인 편집 워크스테이션입니다. **DeepChord(딥코드)**는 로컬 LLM으로 Logic Pro를 사용하며 작곡하는 도구이고, **Sovereign Flow / SovaFlow(소버린 플로우)**는 두 도구를 연결하는 통합 워크플로입니다. [철학 문서](PHILOSOPHY.ko.md)에 역할을 정리했습니다. 전체 자율형 순환은 개발 방향이며 이번 버전에 모두 내장된 기능은 아닙니다. SovaRoll은 다른 두 프로젝트 없이 실행됩니다.

## 앞으로의 Gemma 4 개발

이번 인계 이후 관리자의 AI 코딩 작업은 **로컬 Gemma 4만 사용**합니다. 이는 개발 방침이며 실행 의존성이나 라이선스 제한이 아닙니다. 이전 작업을 Gemma의 작업으로 바꾸어 기록하지 않으며, 이번 공개에서 Gemma 실행을 검증했다고 주장하지 않습니다.

[AGENTS.md](AGENTS.md), [CONTINUE.md](CONTINUE.md), [Gemma 4 인계 문서](docs/agent/LOCAL_MODEL.md)를 읽고 이어갑니다.

```sh
npm run agent:task -- next
npm run agent:verify:full
npm run test:native
npm run agent:e2e
```

브라우저 테스트에는 외부 Playwright와 Chrome, 타임 스트레치 테스트에는 FFmpeg가 필요합니다. 설치 방법은 설명서에 있습니다. 이 도구들은 DAW의 npm 실행 의존성이 아닙니다.

## 라이선스

[Apache License 2.0](LICENSE) · [NOTICE](NOTICE). 사용·재배포에는 라이선스 전문이 적용됩니다. 별도로 설치하는 모델, 런타임, 외부 도구와 사용자 미디어에는 각자의 라이선스가 적용됩니다. Gemma 4 개발 방침은 Apache-2.0의 이용 권한에 추가 제한을 만들지 않습니다.

기존 파일과의 호환성을 위해 `.newdaw.json` 확장자, `NEWDAW_*` 환경 변수와 일부 내부 식별자를 유지합니다.

## 개발 인계

[CONTEXT.md](CONTEXT.md) · [Model operations / 모델 운영](docs/MODEL_OPERATIONS.ko.md) · [Reusable skill / 재사용 스킬](skills/model-tier-handoff/SKILL.md)
