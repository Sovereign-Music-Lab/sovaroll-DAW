# 기능 인벤터리 — Sovereign DAW / SovaRoll

[English](FEATURE_INVENTORY.en.md) · [개발 노트](DEVELOPMENT.ko.md) · [검증 기록](VALIDATION.md)

2026-11-09 기준. `npm run agent:features`를 실행하면 원본 파일명과 식별자 배열을 포함한 `.test-output/feature-inventory.json`을 생성합니다.

## 주장된 2,500개 기능이 모두 구현됐는가?

**확인할 수 없으며 완료를 주장하지 않습니다.** 저장소에는 2,500개 항목의 기능 명세나 체크리스트가 없습니다. 정확한 비교에 사용할 원본 목록이 없으므로 2,500개 커버리지를 인증할 수 없습니다. 외부 목록이 있다면 정의와 수용 기준을 포함해야 항목별 비교가 가능합니다.

다음 수치는 서로 다른 구조의 관측값입니다. **합산해서 기능 개수로 부르지 않습니다.**

| 관측 항목 | 수 | 의미와 경계 |
|---|---:|---|
| 엔진 명령 | 144 | `src/core/schema.mjs`의 고유 명령 항목 |
| API 경로 문자열 | 92 | `src/server.mjs`의 고유 `/api/` 문자열; 완전한 HTTP 경로 분류가 아님 |
| native helper 명령 | 19 | MIDI·오디오·Audio Unit Swift helper의 명령 |
| UI ID | 865 | HTML/public 모듈의 파일별 ID; 파일 간 중복과 기능이 아닌 ID 포함 |
| 제품 테스트 선언 | 1,518 | 174개 제품 테스트 파일의 선언; 반복문과 실행 조건에 따라 실행 수는 달라질 수 있음 |
| native 테스트 선언 | 112 | 현재 native 테스트 선언 |
| GUI 검사 ID | 764 | GUI 스크립트의 리터럴 검사 ID; 조건부·환경 제한 경로 포함 |
| 제품 수용 ID | 30 | 공개 guard가 보존하는 FD-01–FD-30 |

## 현재 기능 범위

| 분야 | 현재 상태 | 중요한 경계 |
|---|---|---|
| 프로젝트·작업 공간 | 구현, 브라우저·제품 검사 | 프로젝트 폴더와 관리 미디어를 함께 보존; 복구 판단은 사람이 수행 |
| MIDI 편집 | GUI/CLI 이력을 공유하는 폭넓은 명령 | 내장 oscillator가 보존된 모든 MIDI 이벤트를 재현하지는 않음 |
| 오디오 녹음·편집 | WAV/AIFF 가져오기, 녹음, 비파괴 편집 검사 | 가짜 장치 검사는 실제 마이크 품질·지연이 아님 |
| 믹싱·보내기 | 내장 믹서, 믹스·스템·MIDI·묶음 경로 검사 | 고급 마스터링과 완전한 라우팅 동등성은 주장하지 않음 |
| native MIDI | 가상 endpoint로 macOS 라우팅·타이밍·Chase·Reset 검사 | 다른 플랫폼 backend는 주장하지 않음 |
| native 오디오 | 선택적 job 기반 AVAudioEngine 미리 듣기와 취소 가능한 host-time 예약 시작 | 저지연 엔진·native MIDI/오디오 동기 전송은 아님 |
| Audio Unit effect | 명시적 검색·인스턴스화, 숫자 파라미터, 선택 범위, 오프라인 WAV·가져오기·미리 듣기 | 사용 가능한 시스템 구성요소 검사; 외부 플러그인 호환성은 미검증 |
| Audio Unit 악기 | 선택 MIDI 클립을 fresh native 악기 instance로 렌더해 Undo 가능한 오디오 클립으로 가져오며, native 실시간 MIDI 재생은 출력 게인 0 수명주기 검사를 지원 | 실시간 악기 MIDI 호스팅·광범위 외부 플러그인 호환성은 미검증 |
| 언어·접근성 | 주 작업 공간 한국어/영어 전환 | 고급 대화상자와 완전한 접근성은 미완성 |
| 자율형 작곡 연동 | 선택적 미래 아키텍처 | DAW는 독립 실행; 완전한 자율형 피드백 루프는 주장하지 않음 |

상세 근거는 [VALIDATION.md](VALIDATION.md), 수용 경계는 [agent/REQUIREMENTS.md](agent/REQUIREMENTS.md)에 있습니다. `tests/feature-inventory.test.mjs`는 보고서 구조, 원본 식별자 uniqueness, 30개 수용 ID와 2,500개 주장의 미검증 상태를 검사합니다.
