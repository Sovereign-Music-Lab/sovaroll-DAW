# SovaRoll development instructions

Read this file first, then the compact English [CONTEXT.md](CONTEXT.md). Sovereign DAW / SovaRoll is an independent local MIDI/audio workstation. Read [the philosophy](PHILOSOPHY.en.md) or [철학](PHILOSOPHY.ko.md) before choosing product scope.

## Development model

After the initial public-release handoff dated 2026-11-08, the maintainer's AI coding work uses **local Gemma 4 only**. Do not silently substitute a cloud model or a different model. If blocked, preserve the work, record the error, and ask the maintainer to narrow the task or explicitly change the policy. Do not attribute historical code or this publication preparation to Gemma. This workflow policy adds no restriction to Apache-2.0 and is not a requirement for using the app.

## Product boundaries

- SovaRoll is the professional-grade DAW project; the current version is still in development.
- DeepChord uses a local LLM to compose with Logic Pro. Sovereign Flow / SovaFlow integrates the two tools and the human feedback loop. Integration is optional; this repository must run on its own.
- Preserve editable MIDI, source audio, undo history, and useful interchange formats. GUI and CLI must use the same engine commands.
- Publish factual development notes. Distinguish implemented, tested, partial, planned, and hardware/manual verification. Do not make unsupported copying, clean-room, provenance, listening, or quality claims.

## Rules

1. Work on one task at a time. Read `npm run agent:task -- next`, or the exact task explicitly requested by the maintainer. Avoid unrelated refactors and whole-file reformatting, especially in `public/app.mjs`.
2. Never modify or delete user projects in `sessions/` or protected fixtures in `examples/`. Use temporary projects and an OS-assigned port or an unused test port; do not use the user's port 4317.
3. Do not delete or weaken tests to make a change pass. No focused or skipped tests. Preserve product acceptance IDs FD-01–FD-30.
4. Add no npm dependencies without a specific maintainer request. Playwright is an external E2E tool. Node.js 22+ and built-in modules are the runtime baseline.
5. Read exact source with `agent:find` and `agent:show` before editing a long line. Make small, reviewable replacements.
6. Validate input and use structured errors; keep deterministic renders. Preserve state on failed commands. Use revision checks for concurrent edits. Advertise new server capabilities when GUI code depends on them.
7. Report only commands actually run and results actually observed. Never claim that a waveform check proves musical quality or physical-device playback.
8. Keep secrets, private source collections, model weights, and personal media out of Git. Preserve relevant third-party notices if introducing licensed components.
9. Local commits are allowed after the task is `done` with passing evidence. Stage only that task's files. Format: `T-0XX: description`, then a body with changes and validation. Push, publication, destructive operations, and history rewriting require an explicit maintainer instruction. Do not infer authorization for future pushes from the initial release.

## Work loop

```sh
npm run agent:task -- next
npm run agent:task -- start T-0XX
npm run agent:checkpoint -- save "T-0XX start"
npm run agent:find -- "search term" src public
npm run agent:show -- path/to/file.mjs 100 --count 20
# Plan, minimal edit, meaningful behavioral coverage.
npm run agent:verify
# Required for GUI, server, storage, or render changes:
npm run agent:e2e
npm run agent:task -- done T-0XX --evidence "Actual passing commands and results"
```

Use `agent:verify:full` for a release or broad core changes and `test:native` for native transport. The first failure guides the next edit. After three failed attempts at the same failure, restore the task checkpoint, mark the task `blocked` with evidence, and return the decision to the maintainer. Preserve unrelated human edits during recovery.

The public guard checks protected fixtures, acceptance IDs, test loss, truncation, debug leftovers, and syntax. Initialize the fixture baseline once with `node scripts/agent/guard.mjs --init` before work. Checkpoints in `.agent/` are local only.

## Completion

Every acceptance criterion must have evidence, `agent:verify` must end in `VERIFY PASS`, and required browser tests must end in `E2E PASS`. Record changed capability status in [requirements](docs/agent/REQUIREMENTS.md) and [validation](docs/VALIDATION.md). Update both language editions when changing user documentation. Regenerate the map with `agent:map` when adding exports or modules.

Read [skills/newdaw-dev-loop/SKILL.md](skills/newdaw-dev-loop/SKILL.md) and the relevant specialized skill for engine, GUI, tests, failures, or requirement tracking.

## 한국어 요약

초기 공개 인계 이후 AI 개발은 로컬 Gemma 4만 사용합니다. 한 번에 한 작업, 사용자 프로젝트 보존, 공통 엔진, 최소 편집, 실제 검증과 근거 기록을 지킵니다. 어려운 작업 때문에 다른 모델로 자동 전환하지 않습니다. 프로급은 개발 목표이며 실제 지원 범위와 미완성 항목을 숨기지 않습니다. 세 프로젝트의 연결은 선택 사항이고 SovaRoll은 단독 실행되어야 합니다.


## Compact memory

The receiving target is Gemma 4 26B / MLX on M5 Pro 24 GB; exact model ID, quantization, runtime/tool support and usable context are unverified. Read CONTEXT.md before the task; update it after every completed/blocked task and before ending a session. Keep it around 80 lines initially, measure real token use, and archive older detail under docs/context/. The mixed-tier strategy in docs/MODEL_OPERATIONS.en.md is reusable across projects; it does not authorize automatic escalation from this repository's current Gemma-only policy.
