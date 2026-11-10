# Local small-model notes (2026-11-10)

Observations from the maintainer's Mac (M5 Pro, 24 GB) with Codex CLI 0.167 and Ollama, using `gemma4:12b-mlx` (12.4B, nvfp4, MLX runner). One machine and a few short tasks; not a benchmark. The 26B target was not re-tested here.

## Context budget

- The earlier local-model failure ("input length 163,086 tokens exceeds the maximum context length 131,072") came from tool schemas of globally enabled MCP servers and ChatGPT app connectors: 393 tools, about 563k characters, sent with every request. This repository's `AGENTS.md` and `CONTEXT.md` were not the cause.
- With a lean Codex profile (apps, plugins and MCP servers disabled; a server is enabled only for the task that needs it), the first request in this repository was about 5.4k tokens in total, of which `AGENTS.md` was about 1.6k.
- Method: Codex's first request was captured at a local dummy endpoint (no model call). Tokens are estimated as characters / 3.5, calibrated against one Ollama-reported count.
- Codex sends no base prompt to Ollama-catalog models and offers them no `apply_patch` tool, so edits go through shell commands.

## Observed with the 12B model

- It followed an index (`AGENTS.md` pointing to one linked file), ran bounded search and read commands, and made one-line file edits (3 of 3 in a scratch test).
- Two-line edits succeeded 4 of 6 times. One failure was degenerate output; one was a timeout while another session was using the same Ollama model.
- A multi-line shell command emitted as a tool call once failed Ollama's gemma4 tool-call parser (`expected '{' in tool call`). Single-line edit commands avoided it.

## Rules that helped

- Keep always-loaded instructions short and link detail files instead of inlining them.
- Prefer single-line edit commands; re-read the changed lines afterwards.
- Use this repository's bounded tools: `npm run agent:find`, `npm run agent:show`, then `npm run agent:verify`.
- Keep the task loop from AGENTS.md: one task card, checkpoint, minimal edit, verify.
- Measure instead of assuming: on this machine Ollama's automatic default context was 4096 tokens for llama.cpp (GGUF) models, while MLX models accepted longer prompts.

## Example lean profile

Start with `codex -p lean` after saving this as `lean.config.toml` in the Codex home directory:

```toml
model = "gemma4:12b-mlx"
model_provider = "ollama-launch"
model_auto_compact_token_limit = 64000

[model_providers.ollama-launch]
name = "Ollama"
base_url = "http://127.0.0.1:11434/v1/"
wire_api = "responses"

[features]
apps = false
plugins = false
multi_agent = false

# Repeat for every configured MCP server; enable one per task with
#   codex -p lean -c mcp_servers.<name>.enabled=true
[mcp_servers.example]
enabled = false
```
