---
name: debug-failure
description: Systematic procedure for diagnosing newdaw test failures, INTERNAL_ERROR responses, browser-test timeouts, and regressions, using short-output harness tools and safe temporary logging. Use whenever verify or e2e fails.
---

# 실패 추적

원칙: **추측으로 고치지 말고, 재현 → 원인 위치 → 최소 수정** 순서. 한 번에 하나의 가설만 시험합니다.

## 1. 실패 하나만 재현

```bash
npm run agent:verify                     # 어떤 테스트 파일·이름이 실패했는지
node --test tests/core.test.mjs          # 그 파일만
node --test --test-name-pattern "tempo, gain" tests/core.test.mjs   # 그 테스트만
```

출력에서 볼 것: `actual` / `expected`, 그리고 `at file:///…/tests/X.test.mjs:줄` → 그 줄을 `show`로 엽니다.

## 2. 실패 종류별 절차

### A. 에러 코드가 기대와 다름 (예: `INTERNAL_ERROR` vs `INVALID_TEMPO_MAP`)

`INTERNAL_ERROR`는 엔진 안에서 `fail()`이 아닌 예외가 난 것입니다. 원래 예외를 보는 방법:

```bash
npm run agent:checkpoint -- save "before debug log"
npm run agent:find -- "code: 'INTERNAL_ERROR'" src/core/engine.mjs
```

그 줄의 `{ code: 'INTERNAL_ERROR', …}` 앞에 임시로 `(console.error('DBG', error), …)`를 넣고 실패 테스트를 실행하면 스택이 보입니다. **원인을 찾으면 DBG 줄을 반드시 지웁니다**(guard가 검사). 실제 사례: `tempo.set`이 검증 전에 `compileTempoMap`을 호출해 `MediaError`가 내부 오류로 바뀜 → 엔진이 `MediaError`를 사용자 오류로 전달하도록 수정.

### B. 검증 순서 문제 (다른 코드가 먼저 걸림)

예: `AUDIO_OUT_OF_BOUNDS`를 기대했는데 `INVALID_AUDIO_FADE`. 두 검사 중 더 근본적인 것(범위)이 먼저 와야 합니다. `find`로 두 코드 위치를 찾아 순서를 바꿉니다.

### C. 기대 문구·상한이 바뀜

현재 코드의 값(예: `render-limits.mjs`의 `MAX_RENDER_SECONDS=600`)이 의도된 사양인지 문서·README에서 확인합니다. 의도된 것이면 테스트를 갱신하고 근거를 기록합니다. 불확실하면 block.

### D. 브라우저 테스트 타임아웃

1. `.test-output/first-delivery-failure.png` 스크린샷을 엽니다.
2. `.test-output/first-delivery-workflow.json`에서 `tests`(마지막 통과 단계), `summary.failureNotice`(화면 알림), `httpErrors`, `pageErrors`를 봅니다.
3. 흔한 원인: 닫힌 메뉴 안 버튼 / 다른 요소가 클릭을 가로챔(고정된 눈금자 등) / 포커스가 빠져 단축키 무시 / 스크롤 때문에 좌표가 바뀜.
4. 페이지 상태를 직접 보려면 스모크에 임시로 `summary.debug = await page.evaluate(() => …)`를 넣고, 확인 후 지웁니다.

### E. 동작은 맞는데 값이 조금 다름

좌표 클릭 기반이면 1px = 수십 tick. 테스트는 `near()` 허용 오차를 쓰고, 제품 코드는 바꾸지 않습니다. 제품 결함인지(예: 스냅 미적용) 판단이 필요하면 block하고 질문합니다.

## 3. 수정 후

```bash
node --test tests/<그 파일>.test.mjs
npm run agent:verify
```

## 4. 회귀를 만든 것 같으면

```bash
npm run agent:checkpoint -- diff                        # 무엇을 바꿨나
npm run agent:checkpoint -- restore <ID> --file src/x.mjs --yes   # 한 파일만 되돌려 비교
```

git으로도 확인할 수 있습니다: `git diff --stat`(미커밋 변경 목록), `git diff 파일`(내용), `git restore 파일`(그 파일의 미커밋 변경 버리기), `git log --oneline -5`(최근 작업 커밋).

## 5. 멈춰야 할 때

같은 실패를 3번 시도해도 그대로면 되돌리고 기록합니다:

```bash
npm run agent:checkpoint -- restore <작업 시작 ID> --yes
npm run agent:task -- block T-0XX --reason "실패: <테스트 이름>. 시도: 1) … 2) … 3) …. 관찰: …"
```
