# The First Gemma 4 Handoff Prompt / 첫 Gemma 4 인계 프롬프트

**Authors / Project credits:** Hee-sung Kang / 강희성 · Do-won Lee / 이도원 · Sungmo Park / 박성모

Date / 기록일: 2026-11-08

## Abstract / 초록

This records the first continuation prompt prepared for local Gemma 4 after SovaRoll's public release. It marks the handoff of human intent, editable music, and evidence-based development into the next local coding stage. It does not claim that Gemma has run or completed a task. The prompt was prepared with Codex at the maintainer's request.

SovaRoll 공개 이후 로컬 Gemma 4에 처음 전달할 인계 프롬프트를 기록합니다. 인간의 의도, 편집 가능한 음악, 실제 검증을 중시하는 개발 철학을 다음 로컬 코딩 단계로 이어가는 출발점입니다. Gemma 실행이나 작업 완료를 주장하는 기록은 아닙니다. 관리자의 요청으로 Codex와 함께 준비했습니다.

## Contents / 목차

- [Usage / 사용법](#usage--사용법)
- [First prompt / 첫 프롬프트](#first-prompt--첫-프롬프트)

## Usage / 사용법

Use a local agent environment with file and terminal tools. Replace `<existing-sovaroll-DAW-checkout>` with your existing checkout's absolute path before pasting. This portable placeholder replaces the personal machine path in the original chat; the operating instructions below are preserved. Read current AGENTS.md and CONTEXT.md when resuming; task status may have changed.

파일·터미널 도구가 연결된 로컬 에이전트 환경에서 사용하세요. 붙여 넣기 전에 `<existing-sovaroll-DAW-checkout>`을 기존 저장소의 절대 경로로 바꾸세요. 공개 문서에서는 원래 대화의 개인 컴퓨터 경로만 자리표시자로 바꾸었습니다. 재개할 때는 최신 AGENTS.md와 CONTEXT.md를 확인하세요.

## First prompt / 첫 프롬프트

```text
Continue development of Sovereign DAW / SovaRoll in the EXISTING repository.

Working directory:
<existing-sovaroll-DAW-checkout>

Expected remote:
https://github.com/Sovereign-Music-Lab/sovaroll-DAW

This is a new instruction to resume development after the completed publication handoff. Do not create another repository or work in the old newdaw archive.

1. Establish context
- Change to the working directory.
- Run pwd, git remote -v, and git status --short --branch.
- Read AGENTS.md, CONTEXT.md, PHILOSOPHY.en.md, and skills/newdaw-dev-loop/SKILL.md.
- Treat current files, Git state, and actual test output as authoritative. Previous PASS records are historical evidence, not verification of your changes.
- Preserve existing uncommitted user changes.

2. Select one bounded task
- Inspect: npm run agent:task -- show T-007
- T-007 is the suggested first task for this handoff. Follow its actual acceptance criteria.
- If it is already completed or unavailable, inspect npm run agent:task -- next and choose one eligible small task.
- Do not resolve T-010's product ambiguity by guessing. T-015 records an unresolved intermittent browser timeout.
- Briefly state the task, relevant files, and required checks, then proceed without asking for routine confirmation.

3. Work carefully
- Follow the repository's start → checkpoint → inspect → edit → verify workflow.
- Initialize the guard baseline only if it has not already been initialized.
- Read exact source excerpts before editing. Avoid loading the entire repository into context.
- Make minimal changes and meaningful behavioral tests. Never weaken or skip tests to obtain a pass.
- Protect user sessions, fixtures, private data, and unrelated edits.
- Use temporary test projects; do not use port 4317.
- Add no npm dependencies or unrelated refactors.
- Follow the repository's recovery procedure after repeated failures.

4. Preserve the project direction
- SovaRoll is an independent open-source DAW aiming at professional use; distinguish current capabilities from future goals.
- Preserve editable MIDI/audio and shared GUI/CLI engine behavior.
- Keep optional integration with DeepChord and SovaFlow:
  human → local LLM (RAG/LoRA) → Sovereign DAW →
  autonomous composition → Logic Pro MCP → result →
  human feedback → repeat.
- Preserve Apache-2.0, repository navigation, and README structure:
  title → authors → abstract → contents.
- Preserve credits: Hee-sung Kang / 강희성,
  Do-won Lee / 이도원, Sungmo Park / 박성모.
- Use local Gemma 4 only. Do not switch to cloud models.
- Do not invent model settings, context limits, test results, listening evidence, or provenance claims.

5. Validate and hand off
- Run npm run agent:verify and all additional checks required by AGENTS.md and the task.
- Record actual results, including failures and limitations.
- Update CONTEXT.md IN ENGLISH before ending:
  task status, changed files, evidence, unresolved issues,
  and the next exact action.
- Keep CONTEXT.md compact; archive lengthy detail under docs/context/.
- Mark the task done only when its acceptance criteria and required checks pass.
- Then make a local commit containing only this task's changes, using the repository's commit format.
- Do not push, publish, rewrite history, or start another task without a new instruction.

Report completion in Korean: changes, checks, commit, limitations,
and the next action.

If file or terminal tools are unavailable, state that limitation and
request the minimum required file contents. Never pretend to have
read files or executed commands.
```
