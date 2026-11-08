# High–Middle–Low development operations

**Project credits:** Hee-sung Kang (강희성) · Do-won Lee (이도원) · Sungmo Park (박성모)

## Abstract

Allocate model capability to the uncertainty and risk of a task. Use frontier reasoning to establish sound interfaces and resolve difficult failures, mid-size models for bounded implementation, and local models for repeatable work supported by precise tasks and executable checks. The objective is more accepted work per unit of money, time and human attention. This is an operating method, not a measured claim that any model is cheaper or better.

## Contents

- [Allocation](#allocation)
- [Mission contract](#mission-contract)
- [Execution and escalation](#execution-and-escalation)
- [Small-context memory](#small-context-memory)
- [Gemma handoff profile](#gemma-handoff-profile)
- [Evidence and efficiency](#evidence-and-efficiency)
- [Apply to another project](#apply-to-another-project)

## Allocation

The high–middle–low analogy is a resource allocation principle: use scarce capability where it changes the outcome, and build a reliable support system for routine work.

| Tier | Suitable work | Handoff artifact | Exit condition |
|---|---|---|---|
| High / frontier | Ambiguous architecture, critical interfaces, systemic failures, consequential review | Decisions, invariants, interface contract, small tasks, baseline checks | Another developer can implement without reconstructing the whole conversation |
| Middle / mid-size | A bounded feature across established interfaces, integration and test expansion | Reviewable implementation, edge cases, executable checks | Scope and failure modes are bounded enough for routine follow-up |
| Low / local | Small fixes, specified tests, documentation, repeated edits with clear acceptance | Minimal diff, test evidence, updated context | Acceptance passes without hidden changes or fabricated results |

Tier selection is independent of product users' model choice. A model lock takes priority over automatic routing. SovaRoll's immediate post-release coding policy is Gemma 4 only; the broader mixed-tier method can guide future projects or a later explicit policy revision.

## Mission contract

Before work, record the objective, allowed files/entry points, invariant behavior, acceptance criteria, exact validation commands, rollback boundary and stop condition. Identify whether the task is documentation, code, data migration or publication. A coding task does not automatically authorize publication, paid inference or destructive changes.

Start from a known baseline. A missing compiler or test-output directory is an environment/tooling problem; an incorrect musical result is a product problem. Diagnose the first failure before changing implementation or expectations. Preserve user projects and unrelated edits.

## Execution and escalation

1. Human sets the objective and allowed model policy.
2. Inspect Git, instructions, `CONTEXT.md` and one task card.
3. Checkpoint the relevant files; read symbols and short excerpts.
4. Make one reviewable change and validate behavior, including refusal/state preservation where meaningful.
5. Review the diff and actual output; complete or block the task with evidence.
6. Update English `CONTEXT.md`, then hand over or stop.

If a local task fails repeatedly, shrink its scope and record the exact unresolved condition. Follow the repository's retry limit; in SovaRoll the same failure gets at most three repair attempts before checkpoint recovery and blocking. If the project permits escalation, hand over a minimal reproducer, error and attempted changes. If it is local-only, return the decision to the human; do not quietly invoke a frontier model.

## Small-context memory

`CONTEXT.md` is the compact current state. Keep goals, immutable decisions, the active model policy, task ID, relevant paths, observed checks, blockers, next command and publication state. Start around 80 lines, then measure actual token usage. That size is a working convention, not a safe-context guarantee.

Archive completed details under `docs/context/` and keep links in the current file. The task queue carries future work; logs carry raw output. Do not load all three in full for every edit. Preserve unresolved constraints when condensing. English is the canonical memory language; translate human-facing guides without maintaining a second current-state file.

At a repository switch, read that repository's own instructions and context. Never carry an active task's assumptions, working directory, credentials or publication target into another repository. Confirm `pwd`, `git remote -v` and `git status --short` before writing or pushing.

## Gemma handoff profile

The requested target is **Gemma 4 26B in an MLX runtime on an M5 Pro with 24 GB unified memory**. This is a user-specified target, not a benchmark or a verified fit for a particular quantization/context. Exact model ID, artifact, quantization, tool-call format and runtime configuration must be inspected on the receiving machine.

Measure model load, available memory, KV-cache growth, generation rate and completion success with a short representative task. Increase context only when evidence supports it. Reserve room for source excerpts, tool output and a final response; reduce logs before sacrificing the current task or constraints. Avoid simultaneous inference jobs when memory pressure is high. Record failures and actual settings instead of inventing a universal token count for 24 GB.

The initial DAW publication does not start Gemma, reconfigure the runtime or report a successful Gemma coding session. Its first trial should use a small test-only task such as T-007, with human review and isolated temporary projects.

## Evidence and efficiency

Track: task ID, tier/model/runtime, input/output tokens if known, cash cost if known, elapsed time, attempts, review minutes, checks, accepted result and follow-up defects. Use `unknown` for unobserved values.

Compare **total cost per accepted verified change**, including retries and review. A lower token bill with more defects is not automatically efficient. Compare similar tasks and acceptance standards; keep model capability, orchestration overhead and musical quality separate. No savings percentage is claimed until measured.

## Apply to another project

Copy the self-contained `model-tier-handoff` skill and its context template. Adapt paths, commands, acceptance tests and allowed models to the new repository. Keep its existing language/toolchain and user permissions. Start with a small pilot and use results to choose task size. This method does not require a DAW, Node.js, Gemma, a fixed number of layers, multiple paid agents or another repository.
