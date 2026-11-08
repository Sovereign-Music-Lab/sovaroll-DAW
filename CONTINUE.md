# Continue with Gemma 4 / Gemma 4로 개발 이어가기

Read [AGENTS.md](AGENTS.md) and [the local-model handoff](docs/agent/LOCAL_MODEL.md). Start in this repository's root. The model policy begins after the initial public release. A Gemma session and actual audio-device listening have not been validated by the release preparation.

## Establish your baseline / 기준 상태 확인

```sh
git status --short
node scripts/agent/guard.mjs --init
npm run agent:verify:full
npm run test:native
npm run agent:e2e
npm run agent:task -- list --all
```

Set up Chrome, external Playwright, and FFmpeg as explained in the [English manual](docs/MANUAL.en.md) or [한국어 설명서](docs/MANUAL.ko.md). Use your own fresh evidence if a prerequisite is missing; never copy another machine's PASS claim.

## Give the model one task / 작업 하나 맡기기

Use this prompt with the locally selected **Gemma 4** model:

```text
Work in this SovaRoll checkout. Read AGENTS.md and docs/agent/LOCAL_MODEL.md.
Read `npm run agent:task -- next` and complete one bounded task.
Follow start → checkpoint → find/show → plan → minimal edit → tests → verify
→ required E2E → done with actual evidence → local commit of task files.
Do not modify user projects or weaken tests. Do not switch models.
After three failed attempts at the same failure, preserve evidence, restore
the task checkpoint without losing unrelated user edits, and block the task.
Report the actual diff, checks, remaining limits, and next task.
```

```text
이 SovaRoll 폴더에서 작업한다. AGENTS.md와 docs/agent/LOCAL_MODEL.md를 읽는다.
`npm run agent:task -- next`의 작업 하나만 수행한다.
start → checkpoint → find/show → 계획 → 최소 편집 → 테스트 → verify
→ 필요한 E2E → 실제 근거로 done → 해당 파일만 로컬 커밋 순서를 따른다.
사용자 프로젝트를 바꾸거나 테스트를 약하게 만들지 않는다. 모델을 바꾸지 않는다.
같은 실패를 세 번 해결하지 못하면 근거를 보존하고 다른 사용자 변경을 지키며
작업 체크포인트로 복원한 뒤 block한다. 실제 변경과 검사 결과, 한계, 다음 작업을 보고한다.
```

Use `show T-007` instead of `next` for the small keyboard undo/redo task if you prefer a supervised first task. T-010 remains a product decision about whether ruler clicks obey snap; a model should not invent that decision.

## Review and recovery / 확인과 복구

- Inspect `git diff`, task evidence, and `.agent/last-verify.json`. Re-run relevant checks.
- Keep tasks small. Start a fresh model conversation for the next task; repository documents carry durable context.
- Restore only your own task changes. `git revert COMMIT` preserves the history of a committed correction. Do not use a blanket restore on unrelated work.
- If blocked, record the first failure and smallest unresolved decision. Reduce the task or repair the environment with the maintainer; do not use an automatic model fallback.
- Public claims must match [validation](docs/VALIDATION.md). Hardware listening and timing still need human checks.

한국어: 변경 파일·작업 근거·검증 JSON을 함께 확인합니다. 작업을 작게 나누고 새 대화에서도 저장소 문서로 맥락을 이어갑니다. 복구는 자신의 작업에만 적용합니다. 막혔을 때에는 실패와 결정이 필요한 지점을 기록하고 사람이 범위를 줄입니다. 자동 검증과 실제 장치 청취를 구분합니다.
