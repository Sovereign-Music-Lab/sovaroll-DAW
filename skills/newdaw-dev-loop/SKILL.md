---
name: newdaw-dev-loop
description: Default step-by-step procedure for any code change in newdaw (task card → checkpoint → locate → minimal edit → verify → E2E → record). Use for every task before more specific skills.
---

# newdaw 기본 개발 절차

작은 모델도 안전하게 일하도록 만든 절차입니다. 단계를 건너뛰지 마세요.

## 1. 작업 받기

```bash
npm run agent:task -- next
```

카드에서 다음을 메모합니다: **목표 한 문장**, **수용 기준 번호 목록**, **먼저 읽을 파일**, **검증 명령**. 수용 기준이 모호하면 시작하지 말고 `block`합니다.

```bash
npm run agent:task -- start T-0XX
npm run agent:checkpoint -- save "T-0XX start"
```

## 2. 위치 찾기 (읽기 전용)

1. `docs/agent/CODEMAP.md`에서 관련 파일과 줄 수를 봅니다.
2. 짧은 검색으로 정확한 줄을 찾습니다.

```bash
npm run agent:find -- "repeat-selected-clips" public
npm run agent:find -- "'clips.repeat'" src/core
npm run agent:find -- "clips\.repeat|repeatClips" src public --regex
```

3. 찾은 줄 주변을 봅니다. 긴 줄은 `.c<열>` 조각으로 나뉘어 보입니다.

```bash
npm run agent:show -- src/core/editing.mjs 350 --count 25
npm run agent:show -- public/app.mjs 1383:200 --width 400     # 1383행의 200열 주변만
```

4. 비슷한 기존 기능을 찾아 **그 패턴을 복사**합니다. 새 패턴을 발명하지 않습니다.

## 3. 계획 쓰기 (3~6줄)

편집 전에 작업 기록(답변)에 적습니다:
- 바꿀 파일과 함수
- 추가할 테스트 이름
- 수용 기준 각각을 어떤 테스트가 증명하는지

## 4. 최소 편집

- 한 번에 한 파일·한 덩어리. 편집 도구의 "찾을 문자열"은 `show` 출력에서 **그대로 복사**합니다(행 번호 접두어 `  1234|` 와 `.c1|` 표시는 빼고).
- 긴 줄 일부를 바꿀 때는 그 줄에서 **유일한 짧은 조각**(30~80자)을 찾아 그 조각만 교체합니다.
- 새 함수는 기존 압축 스타일을 따르지 않아도 됩니다. 여러 줄로 읽기 쉽게 쓰세요.
- 편집 후 바로 문법 확인: `node --check 파일.mjs`

## 5. 테스트 추가

`skills/write-tests/SKILL.md`를 따릅니다. 최소: 정상 동작 1개 + 거부/실패 시 프로젝트 불변 1개.

## 6. 검증

```bash
npm run agent:verify          # 마지막 줄 VERIFY PASS 확인
npm run agent:e2e             # public/ 또는 src/server.mjs·저장·렌더를 바꿨다면 필수
```

실패 시:
1. 출력의 **첫 번째** 실패만 읽습니다 (`--- test failures ---` 아래).
2. `skills/debug-failure/SKILL.md` 절차로 원인을 찾습니다.
3. 고치고 다시 verify. 같은 실패 3회 → checkpoint restore 후 block.

## 7. 기록과 완료

1. 요건 상태가 바뀌면 `skills/requirement-tracking/SKILL.md`대로 기록합니다.
2. CODEMAP 갱신(새 파일·export를 만들었으면): `npm run agent:map`
3. 완료:

```bash
npm run agent:task -- done T-0XX --evidence "VERIFY PASS: tests/clip-group-repeat.test.mjs +2; E2E PASS 28 steps"
```

`done`은 마지막 verify가 PASS가 아니면 거부됩니다.

4. 로컬 커밋 (`AGENTS.md` 규칙 9가 "예"일 때만):

```bash
git status --short                       # 이 작업에서 바꾼 파일만 있는지 확인
git add src/... tests/... docs/agent/...  # 이 작업 파일만 (git add -A 금지: 관련 없는 파일이 섞임)
git commit -m "T-0XX: 제목" -m "변경: ... / 검증: VERIFY PASS, E2E PASS"
```

## 하지 말 것

- 수용 기준에 없는 "김에 고치기"
- 실패하는 테스트의 기대값을 근거 없이 바꾸기
- `sessions/` 프로젝트로 서버 실행, 포트 4317 사용
- 여러 작업을 동시에 `doing`으로 두기
