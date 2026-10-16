# Running tracey locally

Everything runs locally; no accounts, no servers, no API keys.

## Prerequisites

- **Node.js 20 or newer** (developed on 24).
- **pnpm** (the repo pins the version in `package.json`; `corepack enable` will pick it up, or
  `npm i -g pnpm`).

```bash
git clone https://github.com/corridor/tracey.git
cd tracey
pnpm install
```

## The website (dev server)

```bash
pnpm dev            # http://localhost:5173
```

Open it, then drop a trace file on the page, press **Choose one**, paste a trace with
**Cmd/Ctrl+V**, or click **Try a sample**. Good files to try are in `fixtures/`:

| File | What it is |
|---|---|
| `fixtures/openinference/travel-planner.collector-file.jsonl` | OpenInference spans (failing tool called 3×, one slow call) |
| `fixtures/otel-genai/travel-planner.collector-file.jsonl` | The same run in OpenTelemetry GenAI conventions |
| `fixtures/claude-code/session.jsonl` | Synthetic Claude Code session transcript |
| `fixtures/frameworks/*/otlp-*.json` | Real exporter output from Strands, OpenAI Agents, LangGraph, DeepAgents, Claude Agent SDK |

Production build and preview:

```bash
pnpm build          # builds the website (apps/web/dist) and the CLI (apps/cli/dist)
pnpm preview        # serves the built website at http://localhost:4173
```

## The CLI

```bash
pnpm tracey fixtures/openinference/travel-planner.collector-file.jsonl
pnpm tracey detect fixtures/claude-code/session.jsonl
pnpm tracey check fixtures/otel-genai/travel-planner.collector-file.jsonl --fail-on error
pnpm tracey fixtures/openinference/travel-planner.collector-file.jsonl --json
pnpm tracey                    # interactive picker of sessions found on this machine (needs a terminal)
pnpm tracey sessions [--json]  # the same list, non-interactive
```

`pnpm tracey` rebuilds the CLI first, then runs it. To run the built file directly after
`pnpm build`: `node apps/cli/bin/tracey.js <file>`. Set `NO_COLOR=1` to turn colour off.
`pnpm tracey listen` starts a local receiver for a running agent (OTLP over HTTP on `127.0.0.1:4318`):

```bash
pnpm tracey listen                      # then, in the agent's shell:
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

Options: `--port N`, `--host H` (anything but loopback prints a warning), `--save file.jsonl`. Ctrl-C prints a report.
To try it without an agent, send a fixture: `curl -s -X POST --data-binary @fixtures/otlp-protobuf/sample.pb -H 'content-type: application/x-protobuf' http://127.0.0.1:4318/v1/traces`.

The picker looks in `$CLAUDE_CONFIG_DIR` and every `~/.claude*` folder (for example `~/.claude_work`) for Claude Code
sessions, lists the newest first, and filters as you type (`↑↓` move, `↵` open, `esc` quit).
`check` exits 1 when findings reach the chosen severity, so it can gate CI.

Claude Code sessions: sub-agent files next to a session
(`<session-id>/subagents/agent-*.jsonl` with `.meta.json`) are picked up automatically by the
CLI. Your own sessions live under your Claude config dir, `~/.claude/projects/` by default
(or wherever `CLAUDE_CONFIG_DIR` points).

## The desktop app (macOS, Linux, Windows)

A Tauri window around the website, with "Open with tracey" for `.json` and `.jsonl` files. It needs
the Rust toolchain (`rustup`; `cargo -V` should work) and, on Linux, Tauri's system libraries
([prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
pnpm --filter @ggx/tracey-desktop dev          # live-reloading window (starts the web dev server)
pnpm --filter @ggx/tracey-desktop build:app    # macOS: apps/desktop/src-tauri/target/release/bundle/macos/tracey.app (~3 MB)
pnpm --filter @ggx/tracey-desktop build        # all installers for this OS
pnpm --filter @ggx/tracey-desktop test         # Rust unit tests
```

The start screen lists Claude Code sessions found on the machine and has a **Listen for a running agent** toggle
(the receiver on `127.0.0.1:4318`; the page shows the `OTEL_EXPORTER_OTLP_ENDPOINT` line to export).

Open a file with it: `open -a apps/desktop/src-tauri/target/release/bundle/macos/tracey.app path/to/trace.jsonl`
on macOS, or pass the path as an argument on Windows and Linux. Dropping a file onto the window and
**Choose one** work as on the website.

## Tests and type checks

```bash
pnpm test           # all unit tests (Vitest), including the real fixtures
pnpm test:watch
pnpm typecheck      # strict TypeScript across every package
```

## Layout

```
apps/web                 website (Vite + Solid)
apps/cli                 terminal app
apps/desktop             desktop app (Tauri shell around apps/web)
packages/trace-model     span model (typed arrays)
packages/trace-adapters  read + detect OTLP JSON and Claude Code transcripts
packages/trace-insights  findings (errors, loops, slow steps, ...)
packages/trace-theme     GGX design tokens (dark / light / auto)
packages/trace-discover  find sessions already on this machine (Node)
fixtures/                real and synthetic traces used by tests and the sample
spikes/perf              throwaway performance spike (own package.json; see its README)
docs/                    vision, design, flows, roadmap, verification notes
```

Workspace packages are consumed as TypeScript source (no build step for libraries yet).

## Generating your own traces

See [docs/guides/](guides/README.md): get a file out of your tracing tool, your framework, a
coding-agent harness, or a third-party app, then drop it in.

## Contributing

Small, atomic commits following [committing.md](committing.md), on a branch, not on `master`.
The next planned work is in [roadmap.md](roadmap.md).
