# CONTEXT — Sovereign DAW / SovaRoll

Updated: 2026-11-09. T-001–T-038 are done; T-039 continues recording-assistance coverage. Real-device observations remain human work.

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
- First-delivery Chrome E2E: 39 steps passed on 2026-11-09, including recording panel, fade-in/out, audio controls, cycle, quantize/transpose/velocity, keyboard history and ruler Snap/Alt coverage. Fake microphone; no physical listening claim.
- T-001–T-038 `agent:verify`: VERIFY PASS. T-012 also ran its related long-project integration file (2 tests); earlier GUI-only changes had no related unit test file.
- T-038 added a 4-step automatic-backup recovery smoke: GUI backup, independent CLI recovery and GUI open preserve the original track and source project bytes.
- Final `agent:smoke-sweep`: 64/64 unique GUI smokes passed with one first-delivery run. Results and screenshots are in .test-output/.
- T-013 added six-step bilingual manual hardware checklist with empty result columns; no physical-device result claimed.
- T-017–T-035: all 19 failed-smoke follow-ups completed individually; details and exact step counts are in docs/VALIDATION.md.
- T-012 CLI rendered a 150-second project with non-zero PCM at 140 seconds and preserved state on the 600-second limit rejection. Standalone GUI playback advanced and stopped without silent failure; evidence is .test-output/long-project-gui.json.
- T-011 keeps all recording control IDs inside one closed-by-default panel that opens while recording is active. Recording workflow/protection passed 4/6 steps; before/after screenshots are in .test-output/.
- T-009 `agent:smoke-sweep`: all 64 unique GUI smokes completed, 45 passed and 19 failed; JSON evidence is in .test-output/smoke-sweep.json and each failure has one follow-up, T-017–T-035. The sweep's exit 1 is not a passing-suite result.
- T-008 existing recording protection/workflow smokes passed unchanged: 6 and 4 steps. Physical microphone/device listening remains unverified.
- T-005 added a separate 4-step new-project/first-save/restart E2E; it passed along with the default 32-step E2E. Its project writes are confined to a temporary folder and the original project bytes remain unchanged.
- T-002 initially exposed a silent default fake-microphone fixture; a deterministic tone WAV now supplies fake capture. Recorded-region RMS fell from 0.0975930279 to 0 after mute, and the polarity sample changed from -0.1178283691 to +0.1178283691.
- The maintainer explicitly authorized this cloud Kimi coding session on 2026-11-09. This session-specific exception does not replace the local-Gemma-only default for later sessions; no remote push was authorized.
- Fresh-tree startup passed. T-015 deterministically reproduced the intermittent mixer-pan timeout as an SSE/POST test synchronization race; the helper now waits for real busy release and the current 37-step flow passes with unchanged assertions/timeouts.
- E2E wrapper now creates its output directory for a fresh checkout; native test command builds its bridge first.
- Gemma coding and hardware audio latency/quality have not been verified.
- Detailed release record: docs/VALIDATION.md; tasks: docs/agent/tasks.json.

## First continuation prompt
- T-016 records the first Gemma continuation prompt in docs/agent/FIRST_GEMMA_PROMPT.md, with bilingual introduction and README links.
- This is a documented handoff, not evidence of a Gemma run. The maintainer explicitly requested publication of this prompt; future pushes still require authorization.

## Next task and unresolved decisions
- T-001–T-038 are done with evidence in docs/VALIDATION.md. Continue with T-039 recording-assistance E2E, then add scoped follow-ups for newly discovered work.
- T-010's recorded decision is implemented: ruler clicks use current primary/piano Snap; Alt/Option preserves exact position. The 37-step E2E covers both.
- Human listening, microphone latency and hardware quality remain unverified; use docs/agent/MANUAL_CHECKS.md without marking results automatically.
- No low-latency native audio, external plugin hosting, full bilingual UI or complete autonomous workflow claim.

## Navigation
- [Organization](https://github.com/Sovereign-Music-Lab)
- [Website](https://sovereign-music-lab.github.io/)
- [DeepChord](https://github.com/Sovereign-Music-Lab/DeepChord)
- [Sovereign DAW](https://github.com/Sovereign-Music-Lab/sovaroll-DAW)
- [Sovereign Flow](https://github.com/Sovereign-Music-Lab/SovaFlow)

## Update rule
Read AGENTS.md, this file, Git status, then one task. Update this English file after each completed/blocked task and before ending a session. Keep it short; archive detail under docs/context/. Recheck the working directory and remote whenever switching repositories. Git and actual test output outrank stale summaries. Publication must be verified against the remote; this document alone is not proof of a push.
