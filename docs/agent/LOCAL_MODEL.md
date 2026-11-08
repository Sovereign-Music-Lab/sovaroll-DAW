# Gemma 4 development handoff / 개발 인계

The maintainer's future AI coding workflow uses **Gemma 4 only, locally**, after the 2026-11-08 initial publication. This document records that choice; it does not install a model, start a model session, or establish performance results. The DAW has no LLM dependency.

2026-11-08 초기 공개 이후 관리자의 AI 코딩 작업은 **로컬 Gemma 4만 사용**합니다. 이 문서는 방침을 기록합니다. 모델 설치·실행·성능 검증을 했다는 뜻이 아니며 DAW 실행에는 LLM이 필요하지 않습니다.

## Runtime setup / 실행 환경

Use a local coding-agent runtime that can read files, make bounded edits, execute shell commands, and report real output. Select the exact Gemma 4 model installed in that runtime. Record its model identifier, quantization, context setting, runtime version, and hardware with the first real result. No particular model tag, size, memory requirement, or runtime compatibility is asserted here.

파일 읽기·부분 편집·셸 실행·실제 출력 확인이 가능한 로컬 코딩 에이전트를 사용합니다. 설치된 정확한 Gemma 4 모델을 선택하고, 첫 실제 결과에 모델 ID·양자화·컨텍스트 설정·런타임 버전·장비를 기록합니다. 확인하지 않은 태그·크기·메모리 요구량·호환성을 가정하지 않습니다.

Keep context for `AGENTS.md`, one task card, one skill, and a small set of source excerpts. Use conservative settings supported by your runtime. Reduce task scope and read precise excerpts instead of feeding the entire repository into a prompt.

`AGENTS.md`, 작업 카드 하나, 스킬 하나와 필요한 코드 일부가 들어갈 컨텍스트를 확보합니다. 런타임에 맞는 보수적인 설정을 사용하고, 저장소 전체를 넣기보다 작업을 줄여 정확한 부분을 읽습니다.

## Shared harness / 공통 도구

| Tool | Purpose / 용도 |
|---|---|
| `agent:task` | Goals, acceptance, status, evidence / 목표·수용 기준·상태·근거 |
| `agent:checkpoint` | Local snapshots and recovery / 로컬 저장 지점·복구 |
| `agent:find`, `agent:show` | Small excerpts, including long lines / 긴 줄을 포함한 부분 읽기 |
| `agent:guard` | Fixtures, acceptance IDs, test loss, truncation / 보호 데이터·요건 ID·테스트 감소·잘림 검사 |
| `agent:verify` | Syntax and related tests / 문법·관련 테스트 판정 |
| `agent:e2e` | Real Chrome and isolated projects / 실제 Chrome·임시 프로젝트 |

Read [AGENTS.md](../../AGENTS.md) and [CONTINUE.md](../../CONTINUE.md) for the loop and prompts. The queue is [tasks.json](tasks.json); [REQUIREMENTS.md](REQUIREMENTS.md) is the acceptance catalogue; [CODEMAP.md](CODEMAP.md) locates modules and commands.

When blocked, preserve evidence and reduce scope with the human. Do not silently replace Gemma 4. The maintainer can explicitly revise the policy. Apache-2.0 remains the license regardless of downstream users' development tooling.

막히면 근거를 보존하고 사람과 범위를 줄입니다. Gemma 4를 몰래 바꾸지 않습니다. 관리자는 방침을 명시적으로 수정할 수 있습니다. 다른 이용자의 개발 도구 선택과 무관하게 라이선스는 Apache-2.0입니다.
