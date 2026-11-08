---
name: write-tests
description: Patterns for newdaw unit tests (engine/media), HTTP+CLI integration tests, and Playwright browser smoke tests, including what every test must assert. Use when adding or fixing tests.
---

# 테스트 작성

Node 내장 테스트 러너(`node:test`, `node:assert/strict`)만 사용합니다.

## 무엇을 반드시 검사하나

1. **정상 결과**: 바뀐 값이 정확히 기대값인가 (근사값은 허용 오차를 명시).
2. **Undo**: 되돌리면 이전과 같은가.
3. **거부 시 불변**: 잘못된 입력은 정해진 에러 코드로 거부되고 `engine.checkpoint()`(또는 `/api/state`의 project, 디스크 파일)가 그대로인가.
4. 렌더에 영향이 있으면 PCM 값(RMS·특정 샘플)으로 확인.

## 1. 단위 테스트 (엔진·미디어) — 빠름, 가장 먼저

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createProject } from '../src/core/engine.mjs';
const command = (engine, name, args = {}, extra = {}) => engine.execute({ command: name, arguments: args, ...extra });
const applied = r => { assert.equal(r.status, 'applied', JSON.stringify(r.errors)); return r; };
const rejected = (r, code) => { assert.equal(r.status, 'error'); assert.equal(r.errors[0].code, code, JSON.stringify(r)); assert.deepEqual(r.changes, {}); return r; };
```

- 시드 프로젝트는 `tests/core.test.mjs`의 `seed()`를 복사.
- 렌더: `import { renderProject } from '../src/media/render.mjs'` — `tests/media.test.mjs`의 `project()`·`audioProject()` 헬퍼 참고.
- 파일 이름: `tests/<기능>.test.mjs`. 실행: `node --test tests/<기능>.test.mjs`.

## 2. 통합 테스트 (실제 서버 + HTTP + CLI)

`tests/integration.test.mjs`의 `session(t)`, `get`, `post`, `cmd` 헬퍼를 복사합니다.

- 반드시 임시 폴더(`fs.mkdtemp(os.tmpdir()…)`)와 `startServer({projectPath, port:0, demo:false, quiet:true})`.
- `t.after(()=>server.close())`와 임시 폴더 삭제.
- CLI는 `execFile(process.execPath, ['src/cli.mjs', ..., '--url', s.url], {cwd: root})`.
- 파일 이름: `tests/<기능>-integration.test.mjs`.

## 3. 브라우저 스모크 (Playwright + 시스템 Chrome)

- 템플릿: `scripts/gui-first-delivery-smoke.mjs`. 헬퍼: `act(fn)`(revision 증가까지 대기 후 project 반환), `check(id)`(PASS 출력), `gridPoint(tick,pitch)`, `clickRuler(selector,tick)`, `openMenu(id)`, `download(trigger,name)`.
- 가짜 마이크: Chrome 인자 `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`.
- 좌표 기반 위치는 1ms(48샘플)·몇 tick 오차가 생길 수 있으니 `near(a,b,tol)`을 씁니다. 그 외 값은 정확히 비교합니다.
- 결과 JSON을 `.test-output/`에 쓰고, 실패 시 스크린샷을 남깁니다.
- 실행: `npm run agent:e2e -- scripts/<파일>.mjs`.

## 4. 금지

- 테스트 삭제, `test.only`, `skip`, 기대값을 실제 출력으로 그냥 덮어쓰기.
- 실제 시간 대기에 의존(`setTimeout 5000`) — 조건 대기(`waitForFunction`)를 씁니다.
- 사용자 `sessions/` 파일 사용.

## 5. 기존 테스트 기대값을 바꿔야 할 때

사양이 의도적으로 바뀐 경우만. 예: 렌더 상한이 120초→600초로 바뀌어 `tests/media.test.mjs`의 `/120/`을 `/600/`으로 바꿈. 근거 위치(`src/media/render-limits.mjs`)를 작업 기록에 적습니다.
