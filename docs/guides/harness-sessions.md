# What are Claude Code, Codex, Zed, Copilot doing?

> Draft, untested. Locations and formats change between versions. **(verify)** each.

These tools already save session records locally. You only need to find the file and drop
it in. tracey turns turns and tool calls into spans.

**Privacy:** sessions contain your code and possibly secrets. tracey never uploads anything.
Be careful sharing screenshots or exported files.

## Claude Code

1. Sessions are JSONL files: `~/.claude/projects/<project-folder>/<session-id>.jsonl`. The
   folder name is your working directory path with non-alphanumerics turned into `-`.
2. Pick the newest file (by modified time) for the project, or use `/export` from within
   Claude Code. **(verify)**
3. Drop it in. Expect *Detected Claude Code transcript*.

Notes: Anthropic's docs say the record format is internal and can change between versions,
so tracey may warn "unknown version, showing best effort". Old sessions may be cleaned up
automatically.

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
