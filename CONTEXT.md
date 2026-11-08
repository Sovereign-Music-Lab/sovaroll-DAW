# CONTEXT — Sovereign DAW / SovaRoll

Updated: 2026-11-09 after T-001–T-006.

## Identity
- Repository: Sovereign-Music-Lab/sovaroll-DAW, intended public branch main; current local branch sovaroll-continuation, not pushed.
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
- First-delivery Chrome E2E: 34 steps passed on 2026-11-09, including T-001 fade-in, T-002 clip mute/polarity, T-003 normalize, T-004 cycle transport and T-006 MIDI transpose/velocity coverage. Fake microphone; no physical listening claim.
- T-001–T-006 `agent:verify`: VERIFY PASS (guard and all JavaScript syntax; unit tests skipped because the GUI-smoke-only changes had no related unit test file). No product code changed.
- T-005 added a separate 4-step new-project/first-save/restart E2E; it passed along with the default 32-step E2E. Its project writes are confined to a temporary folder and the original project bytes remain unchanged.
- T-002 initially exposed a silent default fake-microphone fixture; a deterministic tone WAV now supplies fake capture. Recorded-region RMS fell from 0.0975930279 to 0 after mute, and the polarity sample changed from -0.1178283691 to +0.1178283691.
- The maintainer explicitly authorized this cloud Kimi coding session on 2026-11-09. This session-specific exception does not replace the local-Gemma-only default for later sessions; no remote push was authorized.
- Fresh-tree startup passed; E2E passed on retry after an intermittent mixer-pan timeout. T-015 tracks the unresolved cause; assertions are unchanged.
- E2E wrapper now creates its output directory for a fresh checkout; native test command builds its bridge first.
- Gemma coding and hardware audio latency/quality have not been verified.
- Detailed release record: docs/VALIDATION.md; tasks: docs/agent/tasks.json.

## First continuation prompt
- T-016 records the first Gemma continuation prompt in docs/agent/FIRST_GEMMA_PROMPT.md, with bilingual introduction and README links.
- This is a documented handoff, not evidence of a Gemma run. The maintainer explicitly requested publication of this prompt; future pushes still require authorization.

## Next task and unresolved decisions
- T-001–T-006 are done with evidence in docs/VALIDATION.md; FD-01 GUI creation and FD-14 transpose/velocity are verified, FD-20 retains fade-out E2E work, and FD-25 cycle transport is verified without a listening claim.
- Run `npm run agent:task -- next` for queue order, or `show T-007` for the small supervised keyboard undo/redo test task.
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
