---
name: model-tier-handoff
description: Design or carry out a cost-aware handoff from frontier to mid-size to local coding models using bounded tasks, executable evidence, and a compact English CONTEXT.md. Use for model handoffs, small-context continuation, and reusable development workflows; do not switch models or expand publication scope without the user's authorization.
---

# Model tier handoff

## Establish the operating policy

Read the latest user request, repository instructions, English `CONTEXT.md`, active task, and Git status. The repository and actual test output outrank an outdated memory summary. Preserve explicit model locks: a local-only project must not automatically escalate to a paid/cloud model. Do not pretend the running agent is a different model.

Treat High / Middle / Low as allocation of work, not a ranking of people or a benchmark claim:

- High: ambiguous architecture, new interfaces, systemic failure analysis, high-impact review.
- Middle: a bounded feature spanning known interfaces, test expansion, integration work.
- Low/local: one well-defined task with a short file list, exact acceptance checks, and recoverable edits.

Choose the smallest suitable tier from measured outcomes, available tools, task risk and the user's allowed models. If the chosen tier cannot complete the work, shrink the task or return a concrete blocker. Escalation needs the user's existing authorization, not merely elapsed retries. Read [the operating guide](references/OPERATIONS.en.md) when designing a full project strategy; the [Korean edition](references/OPERATIONS.ko.md) is for human review.

## Make the handoff executable

1. State one objective, files/entry points, acceptance criteria, exact checks and rollback boundary. Use the repository's task/checkpoint harness if it has one; do not impose a new package manager or rewrite its tools.
2. Establish a baseline on an isolated test project. Distinguish an environment failure from a product failure. Never weaken tests or copy an old PASS result.
3. Give the receiving model the compact context and relevant excerpts, not an entire chat transcript or repository. Keep a record of exact model/runtime settings; unknown values remain unknown.
4. Reserve context for tool output and completion. Read long files by symbols/line ranges, cap command output and archive detailed logs outside the always-read file.
5. Inspect diffs, run the required checks, and update task evidence and `CONTEXT.md` at every completed/blocked task and before ending a session.

## Keep durable context small and trustworthy

Use [assets/CONTEXT.template.md](assets/CONTEXT.template.md) for a new repository, adapting it to existing conventions. `CONTEXT.md` is English and is the single current handoff; Korean manuals link to it rather than maintain a second copy.

Include the active model policy, project identity, current task, verified facts, open decisions, changed files, next executable action, evidence paths and publication state. Record commit identity when known; before committing use the last verified base and say that the next commit contains the handoff. Do not create a self-referential guessed commit SHA.

Keep the initial target around 80 lines; this is a practical starting point, not a token guarantee. Measure with the actual tokenizer/runtime. Move older decisions to `docs/context/` and link them. Never put secrets, personal paths, raw private prompts, datasets or model weights in a public handoff. Never discard an unresolved constraint while shortening context.

For memory-limited local inference, measure loaded-model memory, KV-cache growth, generation speed and task success before choosing the context cap. Run one inference task at a time when memory pressure warrants it. A model name, quantization or RAM total alone does not establish a safe context length.

## Evaluate efficiency and finish

Compare cost per accepted, verified change, including retries and human review time. Keep input/output tokens, runtime, money spent, attempts, checks and outcome when observed; label missing measurements. Do not claim savings from a few passing tests.

On completion, report the actual changes, checks, limits, next receiving-model prompt and artifact locations. Do not start a different model, purchase inference, push code, publish data or create another repository unless authorized by the task. Stop after the requested handoff.
