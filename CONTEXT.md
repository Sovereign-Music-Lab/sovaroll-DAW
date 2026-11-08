# CONTEXT — Sovereign DAW / SovaRoll

Updated: 2026-11-08 handoff. This file is part of the initial public release commit.

## Identity
- Repository: Sovereign-Music-Lab/sovaroll-DAW, intended branch main.
- Version: 0.129.0. Node.js 22+, no npm runtime dependencies.
- Goal: a professional-grade independent open-source DAW; current release remains in development.

## Operating policy
- Receiving coding environment: Gemma 4 26B, MLX, M5 Pro, 24 GB unified memory (user-specified target).
- Exact model artifact, quantization, runtime tool support, context cap and performance: not verified by this handoff.
- Use local Gemma 4 for the next coding stage. No silent model substitution or automatic cloud escalation.
- The High/Middle/Low method is reusable planning guidance; it does not override the current model lock or license.
- Read one task and bounded source excerpts. Measure real context/memory usage; do not assume a safe token count from RAM alone.

## Durable decisions
- Credits: Hee-sung Kang, Do-won Lee, Sungmo Park; keep them under README titles.
- README structure: title, authors/credits, abstract, contents, then details; maintain English and Korean editions.
- Tools remain independently usable. Cross-links are navigation, not hidden runtime dependencies.
- Target loop: human → local LLM (optional RAG/LoRA) → Sovereign DAW → autonomous composition → Logic Pro MCP → result → human feedback → repeat.
- Current capability and future architecture are separate. Preserve editable sources and actual evidence.

## Current state and evidence
- English/Korean philosophy, manuals, development notes, navigation and Apache-2.0 are included.
- All 170 inherited product test files and all seven native test files remain unchanged.
- Added three public-guard regression tests in one file.
- Full guard/syntax/product verification: PASS, 171 files, 2026-11-08.
- Native tests: 97 passed after building the macOS bridge.
- First-delivery Chrome E2E: 27 steps passed. Fake microphone; no physical listening claim.
- Fresh-tree startup passed; E2E passed on retry after an intermittent mixer-pan timeout. T-015 tracks the unresolved cause; assertions are unchanged.
- E2E wrapper now creates its output directory for a fresh checkout; native test command builds its bridge first.
- Gemma coding and hardware audio latency/quality have not been verified.
- Detailed release record: docs/VALIDATION.md; tasks: docs/agent/tasks.json.

## First continuation prompt
- T-016 records the first Gemma continuation prompt in docs/agent/FIRST_GEMMA_PROMPT.md, with bilingual introduction and README links.
- This is a documented handoff, not evidence of a Gemma run. The maintainer explicitly requested publication of this prompt; future pushes still require authorization.

## Next task and unresolved decisions
- Current work ends at publication/handoff; do not expand features automatically.
- Start with `npm run agent:task -- show T-007` for a small supervised keyboard undo/redo test task, or `next` for queue order.
- Follow AGENTS.md: start → checkpoint → find/show → minimal edit → verify/E2E → evidence → context update → done → local commit.
- T-010 remains blocked on whether ruler clicks should obey snap. Do not invent the product decision.
- No low-latency native audio, external plugin hosting, full bilingual UI or complete autonomous workflow claim.

## Navigation
- [Organization](https://github.com/Sovereign-Music-Lab)
- [Website](https://sovereign-music-lab.github.io/)
- [DeepChord](https://github.com/Sovereign-Music-Lab/DeepChord)
- [Sovereign DAW](https://github.com/Sovereign-Music-Lab/sovaroll-DAW)
- [Sovereign Flow](https://github.com/Sovereign-Music-Lab/SovaFlow)

## Update rule
Read AGENTS.md, this file, Git status, then one task. Update this English file after each completed/blocked task and before ending a session. Keep it short; archive detail under docs/context/. Recheck the working directory and remote whenever switching repositories. Git and actual test output outrank stale summaries. Publication must be verified against the remote; this document alone is not proof of a push.
