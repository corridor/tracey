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
```

`pnpm tracey` rebuilds the CLI first, then runs it. To run the built file directly after
`pnpm build`: `node apps/cli/bin/tracey.js <file>`. Set `NO_COLOR=1` to turn colour off.
`check` exits 1 when findings reach the chosen severity, so it can gate CI.

Claude Code sessions: sub-agent files next to a session
(`<session-id>/subagents/agent-*.jsonl` with `.meta.json`) are picked up automatically by the
CLI. Your own sessions live under your Claude config dir, `~/.claude/projects/` by default
(or wherever `CLAUDE_CONFIG_DIR` points).

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
packages/trace-model     span model (typed arrays)
packages/trace-adapters  read + detect OTLP JSON and Claude Code transcripts
packages/trace-insights  findings (errors, loops, slow steps, ...)
packages/trace-theme     GGX design tokens (dark / light / auto)
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
