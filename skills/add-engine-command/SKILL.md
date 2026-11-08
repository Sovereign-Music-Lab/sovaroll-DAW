---
name: add-engine-command
description: How to add or change an undoable project-editing command in newdaw (schema definition, applyCommand logic, history label, tests, CLI/GUI exposure). Use when a feature changes project data.
---

# 엔진 명령 추가·수정

프로젝트 데이터를 바꾸는 모든 기능은 엔진 명령입니다. 명령은 자동으로 Undo·revision 충돌 검사·원자성·CLI 노출을 얻습니다.

## 0. 먼저 확인

```bash
npm run agent:find -- "'clip.update'" src/core      # 비슷한 명령이 어디 정의·적용되는지
```

이미 비슷한 명령이 있으면 **새 명령 대신 기존 명령에 선택 인자를 추가**하는 편이 낫습니다(예: `clip.update`에 `fadeInFrames`가 추가된 방식).

## 1. 스키마 정의 — `src/core/schema.mjs`

`definitions` 배열에 `[이름, 설명, 인자스키마]`를 추가합니다. 같은 파일 위쪽의 헬퍼를 씁니다: `object(속성, 필수목록)`, `id`, `text`, `integer(min,max)`, `number(min,max)`, `boolean`, `array(항목, 최소개수)`, `gain`(-60..12), `color`, `instrument`. `object`는 `additionalProperties:false`라서 스키마에 없는 인자는 거부됩니다.

```js
['track.example','Set the example value on one MIDI track (0..10).',object({trackId:id,value:integer(0,10)},['trackId','value'])],
```

```bash
npm run agent:find -- "'clips.repeat'," src/core/schema.mjs
npm run agent:show -- src/core/schema.mjs <행> --count 3 --width 300
```

- 이름 규칙: `대상.동작` (`clip.split`, `midi.notes.transpose`, `tracks.clearMuteSolo`).
- 설명은 영어 한 문장, 범위·제약을 적습니다(CLI `commands`와 CODEMAP에 그대로 나옵니다).
- 필수 인자는 스키마의 required로. 숫자는 반드시 min/max.

## 2. 적용 로직

- 간단한 것: `src/core/engine.mjs`의 `applyCommand` 안 `switch(command)`에 `case` 추가.
- 편집 계열(클립·노트 다수): `src/core/editing.mjs`의 `editingCommands` 집합 + 처리 분기.
- 패턴:

```js
case 'track.example': {
  const track = find(project.tracks, args.trackId, 'Track');          // 없으면 NOT_FOUND
  if (track.type !== 'midi') fail('TYPE_MISMATCH', 'Example requires a MIDI track.');
  track.someField = args.value;
  changes.updated.push(track.id);
  resolvedTargets = [track.id];
  break;
}
```

규칙:
- `project`는 이미 사본입니다. 그 안을 직접 바꿉니다. 실패하면 엔진이 사본을 버립니다.
- 사용자 오류는 반드시 `fail(CODE, message, details)`. 다른 예외는 `INTERNAL_ERROR`가 됩니다.
- `changes.created/updated/removed`에 바뀐 ID를 넣습니다(GUI가 이걸로 선택·표시를 갱신).
- 원본 미디어 파일을 읽거나 쓰지 않습니다(엔진은 I/O 없음). 오디오 분석이 필요하면 서버 엔드포인트에서 계산 후 결과값을 명령 인자로 넘깁니다(예: `normalize-audio` → `clip.update gainDb`).
- 새 프로젝트 필드를 만들면 `projectSchema`(schema.mjs)에 **선택(optional)** 필드로 추가하고, 교차 제약은 `validateProject`(engine.mjs)에 추가합니다. 기존 프로젝트 파일이 계속 열려야 합니다.

## 3. 이력 이름 — `src/core/engine.mjs`의 `actionLabels`

```bash
npm run agent:find -- "const actionLabels" src/core/engine.mjs
```

`'track.example': 'Example track',` 한 줄 추가. 없으면 이력 목록에 명령 이름이 그대로 보입니다.

## 4. 테스트 — `tests/<기능>.test.mjs`

`tests/core.test.mjs` 맨 위 헬퍼(`command`, `applied`, `rejected`, `seed`)를 복사해 씁니다.

```js
test('track.example sets the value and undo restores it', () => {
  const engine = seed();
  applied(command(engine, 'track.example', { trackId: 'track-one', value: 3 }));
  assert.equal(engine.project.tracks[0].someField, 3);
  applied(command(engine, 'history.undo'));
  assert.equal(engine.project.tracks[0].someField, undefined);
});
test('track.example rejects audio tracks without changing the project', () => {
  const engine = seed(); const before = engine.checkpoint();
  rejected(command(engine, 'track.example', { trackId: 'missing', value: 3 }), 'NOT_FOUND');
  assert.deepEqual(engine.checkpoint(), before);
});
```

## 5. CLI·GUI 노출

- CLI는 자동: `node src/cli.mjs command track.example '{"trackId":"t1","value":3}' --url http://127.0.0.1:PORT`. `--dry-run`으로 검증만.
- GUI: `skills/gui-feature/SKILL.md`. `runCommand('track.example', {...})`.
- 재생/렌더에 영향을 주면 `src/media/render.mjs`와 렌더 테스트(`tests/media.test.mjs` 패턴)도 수정합니다.

## 6. 마무리

```bash
npm run agent:map        # 명령 표 갱신
npm run agent:verify     # engine/schema 변경은 자동으로 전체 테스트
```
