---
name: gui-feature
description: How to wire a GUI control (button, input, dialog, keyboard shortcut) in newdaw's framework-free browser app to the shared command engine, with capability gating and a browser test. Use for any change under public/.
---

# GUI 기능 연결

GUI는 프레임워크가 없습니다. `public/index.html`에 정적 요소, `public/app.mjs`에 상태·렌더·이벤트, 기능별 모듈이 따로 있습니다. `app.mjs`는 매우 긴 줄이 많으니 `show.mjs`로만 읽으세요.

## 1. 비슷한 기능 찾기

```bash
npm run agent:find -- "repeat-selected-clips" public          # 버튼 ID로 마크업·핸들러 찾기
npm run agent:find -- "addEventListener('click'" public/editing.mjs --max 10
```

## 2. 마크업 — `public/index.html`

- 새 요소에 **고유 id**를 줍니다(`kebab-case`). 테스트가 id로 찾습니다.
- 접근성: 버튼에 보이는 텍스트 또는 `aria-label`(한국어).
- 메뉴(`<details id="editing-tools-menu">` 등) 안에 넣으면 테스트에서 메뉴를 먼저 열어야 합니다.
- 긴 대화상자는 기존 `<dialog id="...-dialog"><form id="...-form">` 패턴을 복사합니다.

## 3. 동작 — 서버로 명령 보내기

```js
$('my-button').addEventListener('click', async () => {
  if (!project || busy || !connected) return;                  // 항상 이 가드
  const result = await runCommand('track.example', { trackId: selectedTrack, value: 3 }, project.revision);
  if (result) notice('적용했습니다.');                          // runCommand가 실패 알림을 이미 띄웁니다
});
```

- **`project`를 직접 수정하지 않습니다.** 서버 스냅샷이 SSE/refresh로 다시 옵니다.
- 대화상자처럼 열어 둔 사이에 상태가 바뀔 수 있는 경우: 열 때 `{documentId: documentState?.id, revision: project.revision}`을 저장하고, 제출 때 문서가 바뀌었으면 거부하고, `runCommand(..., draft.revision)`으로 보냅니다(`repeat-clips-form` 핸들러가 예).
- 버튼 활성화/비활성화는 `updateButtons()` 계열 함수에서 `busy`, `connected`, 선택 상태로 결정합니다(`app.mjs`의 `$('add-clip').disabled = ...` 참고).

## 4. 서버 기능 여부(capability)

서버에 새 기능(엔드포인트·명령·필드)을 추가했다면:

1. `src/server.mjs`의 `CAPABILITIES`에 `myFeature: true` 추가
2. GUI 초기화에서 `snapshot.capabilities.myFeature === true`일 때만 컨트롤을 보이거나 활성화 (`app.mjs`의 `repeat-selected-clips').hidden=snapshot.capabilities.clipGroupRepeat!==true` 패턴)

## 5. 키보드 단축키

- 전역 처리: `app.mjs`의 `document.addEventListener('keydown', …)` (find로 위치 확인).
- 입력칸·열린 대화상자에서는 단축키를 무시하는 기존 가드를 유지합니다.
- 편집기 단축키는 `event.target.closest('.editor')`를 확인합니다. 클릭해도 포커스가 편집기 안에 남도록 영역에 `tabindex="-1"`을 주는 방식으로 해결한 예: `#piano-scroll`.

## 6. 스타일 — `public/styles.css`

색은 기존 CSS 변수(`var(--...)`)를 사용합니다. 레이아웃을 크게 바꾸지 마세요(테스트가 좌표를 씁니다).

## 7. 브라우저 테스트 (필수)

- 첫 납품 흐름에 속하면 `scripts/gui-first-delivery-smoke.mjs`에 단계를 추가합니다. 아니면 비슷한 `scripts/gui-*-smoke.mjs`를 복사해 새 스모크를 만듭니다.
- 패턴(스모크 안 헬퍼 사용):

```js
p = await act(() => page.locator('#my-button').click());        // revision 증가까지 기다림
assert.equal(p.tracks[0].someField, 3);
check('feature.GUI-my-button-sets-value');                       // PASS 단계 이름
```

- 실행: `npm run agent:e2e` (또는 `npm run agent:e2e -- scripts/gui-새스모크.mjs`)
- 실패하면 `.test-output/first-delivery-failure.png`를 열어 화면을 확인합니다.

## 흔한 실수

| 증상 | 원인 | 해결 |
|---|---|---|
| 클릭 타임아웃 "element is not visible" | 닫힌 `<details>` 메뉴 안 | `openMenu('editing-tools-menu')` 후 클릭 |
| strict mode violation (2 elements) | 같은 data 속성이 타임라인과 피아노롤에 있음 | `#note-grid [data-note-id=...]`처럼 범위 지정 |
| 단축키가 무시됨 | 포커스가 body로 빠짐 | 포커스 가능한 컨테이너 확인, `document.activeElement` 출력 |
| 노트가 하나 더 생김 | 빈 피아노롤 칸 클릭(Alt 포함)은 노트 추가 | 선택 해제는 Escape |
