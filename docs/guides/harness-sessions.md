# What are Claude Code, Codex, Zed, Copilot doing?

> Draft, untested. Locations and formats change between versions. **(verify)** each.

These tools already save session records locally. You only need to find the file and drop
it in. tracey turns turns and tool calls into spans.

**Privacy:** sessions contain your code and possibly secrets. tracey never uploads anything.
Be careful sharing screenshots or exported files.

## Claude Code

1. Sessions are JSONL files: `<config dir>/projects/<project-folder>/<session-id>.jsonl`.
   The config dir is `~/.claude/` by default, but **it can differ**: if `CLAUDE_CONFIG_DIR`
   is set (or you use a wrapper/profile) it lives there instead (checked: `~/.claude_ali/`
   on one machine). Run `echo $CLAUDE_CONFIG_DIR` if you cannot find it. The folder name is
   your working directory path with non-alphanumerics turned into `-`.
2. Pick the newest file (by modified time) for the project.
3. Sub-agents are stored next to it, in `<session-id>/subagents/agent-<id>.jsonl`. Drop the
   whole `<session-id>` folder as well (or open the session in desktop/CLI, which finds them)
   to see sub-agents nested. A single file alone shows the sub-agent as one tool call.
4. Drop it in. Expect *Detected Claude Code transcript, version 2.1.x*.

Notes: this format is not documented by Anthropic and changes between versions (checked on
2.1.296 to 2.1.301 only), so tracey may warn "unknown version, showing best effort". Old
sessions may be cleaned up automatically **(verify)**. `/export` is a different thing and
may not produce JSONL **(verify)**; use the files above.

Richer alternative for new sessions: Claude Code can emit OpenTelemetry traces
(`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`,
`OTEL_TRACES_EXPORTER=otlp`, plus `OTEL_LOG_*` switches for content). Beta, off by default,
and content is redacted unless you opt in. See `docs/verification/claude-code.md`.

## Codex CLI

Sessions are JSONL under `~/.codex/sessions/`. **(not yet researched; do this before
publishing)**

## Zed

Agent threads live in a local SQLite database (payloads are reported as zstd-compressed
JSON). Locate Zed's data directory's `threads` database **(verify path per OS)** and open it
in tracey desktop/CLI; the website may only accept an exported copy.

## VS Code (GitHub Copilot Chat)

Either:

- Run **Chat: Export Session** to save a JSON file. **(verify command name)**
- Or enable the agent debug log (`github.copilot.chat.agentDebugLog.fileLogging.enabled`)
  and export it as OTLP JSON, which is richer. **(verify)**

## The easy way (desktop, VS Code, CLI)

"Find sessions" lists the known session locations on your machine, newest first, with your
permission. Pick one and it opens. No hunting for paths.

## What to look at first

Findings for coding agents include: a tool call that errored and the model carried on, the
same file read repeatedly, a runaway context, a retry loop, a sub-agent that returned nothing,
a denied permission. Then use the debug playbook, adding one step: compare what the model was
**told** (system prompt, tools) with what it **did**.
