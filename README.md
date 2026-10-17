<h1 align="center">tracey</h1>

<p align="center"><b>Drop in an AI agent trace. See what it really did, and what went wrong.</b></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/images/hero-light.png">
    <img alt="tracey showing an agent run as a call graph, with a failed tool call flagged in the findings panel and a timeline strip along the bottom" src="docs/images/hero-dark.png">
  </picture>
</p>

An agent run is a long tree of model calls, tool calls, retries and sub-agents, each carrying big
blobs of prompt and output. Reading that as raw JSON or logs is slow, and the thing that went
wrong (a failed tool, a retry loop, a runaway step) is buried. tracey turns the file into a
picture and points at the problems.

In the screenshot above, `search_flights` timed out three times, the planner carried on without
the result, and one model call took two thirds of the run. tracey found all three on its own.

**Everything runs in your browser. Traces are never uploaded.**

## What you get

- **A call graph** you can pan and zoom, with every step as a card: kind, duration, errors.
- **Findings first.** Failed steps, failures the agent carried on past, the same call repeated,
  slow steps. Click one to jump to it; hover to outline every span involved.
- **A timeline strip** along the bottom that shows where the time went and where it broke.
- **An inspector** with a step's status, input, output and error, pretty-printed.
- **Compare two runs.** Open a run, press *Compare…*, pick another file: steps are lined up and you see what was added,
  removed, newly failing or slower, with a line diff of the changed inputs and outputs. `tracey diff a b` does it in the terminal.
- **Source detection.** tracey works out where a file came from and says how sure it is.
- **Light, dark and auto themes**, and layouts that work from a phone to an ultrawide monitor.
- **Fast.** The graph is drawn on a 2D canvas with level-of-detail rendering; a 100,000-span
  trace parses in a fraction of a second in the perf spike ([numbers](docs/verification/perf-spike.md)).

## Try it

**Website:** <https://tracey.genguardx.ai> (drop a file, paste, or click *Try a sample*).
It is published with GitHub Pages from this repo (see [`.github/workflows/pages.yml`](.github/workflows/pages.yml)).

**Or run it locally** (Node 20+ and pnpm):

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

Sample files to drop in are in [`fixtures/`](fixtures/). More in [docs/development.md](docs/development.md).

**In the terminal:**

```bash
pnpm tracey fixtures/openinference/travel-planner.collector-file.jsonl
```

```
✓ OpenInference (high confidence)
16 spans · 4.9s · 8 llm · 6 tool · 868 tokens

✕ search_flights failed 3×
  flight API timed out after 400ms
▲ planner carried on after search_flights failed 3×
▲ search_flights called 3× with the same input
▲ ChatCompletion took 3.2s  (66% of the run)
```

Any command takes a link instead of a file (`tracey https://…`, with `-H 'Authorization: …'` for private ones), and `tracey download <url>`
saves one. `tracey check <file>` exits non-zero when findings reach a severity, for CI. Run `tracey` with no
file to pick from the Claude Code sessions already on your machine, or `tracey listen` to point a running
agent at tracey and watch it live (`OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`).

<p align="center">
  <img alt="tracey comparing two runs: one step removed, one step's input changed from Paris to Rome, shown as a line diff" src="docs/images/diff-dark.png" width="820">
</p>

## What it reads

| Source | Notes |
|---|---|
| OpenInference (Arize Phoenix, `openinference-instrumentation-*`) | OTLP JSON |
| OpenTelemetry GenAI (Strands, Dynatrace, Honeycomb, ...) | OTLP JSON or protobuf |
| OpenLLMetry / Traceloop | OTLP JSON |
| Claude Code session transcripts | JSONL, sub-agents included |
| GGX platform span exports | JSONL, one span per line |

Planned: Datadog LLM Observability, Langfuse, LangSmith, Codex, VS Code Copilot, Zed, HAR
captures. See the [roadmap](docs/roadmap.md).

**Don't have a trace file yet?** The [getting-started guides](docs/guides/README.md) show how to
get one from your tracing tool, from LangGraph / DeepAgents / Strands / OpenAI Agents / Claude
Agent SDK with no tracing set up, from a coding-agent harness, or from a third-party app.

## Packages

tracey is a set of small, separately usable packages under the `@ggx/` scope, plus apps built on them.

| Package | What it is |
|---|---|
| `@ggx/trace-model` | Compact, dependency-free span model (typed arrays) |
| `@ggx/trace-adapters` | Detect and read OTLP JSON and Claude Code transcripts |
| `@ggx/trace-insights` | The findings engine |
| `@ggx/trace-view-graph` | Pan-and-zoom call graph on a 2D canvas |
| `@ggx/trace-view-timeline` | Compact timeline strip |
| `@ggx/trace-diff` | Aligns two runs and finds what changed (plus a line diff) |
| `@ggx/trace-theme` | GGX design tokens (dark, light, auto) |
| `@ggx/trace-discover` | Finds sessions already on this machine (Node) |
| `apps/web` | The website |
| `apps/cli` | The terminal app |
| `apps/desktop` | Desktop app (Tauri, about 3 MB): session list, live receiver |

Not published to npm yet.

## Tests

```bash
pnpm test           # unit tests
pnpm test:e2e       # browser tests (Chromium via Playwright)
pnpm typecheck
```

See [docs/testing.md](docs/testing.md) for what is covered and how to test by hand.

## Project docs

[Vision](docs/vision.md) · [Design](docs/design.md) · [UX principles](docs/ux-principles.md) ·
[Architecture](docs/architecture.md) · [Roadmap and next step](docs/roadmap.md) ·
[Decisions](docs/decisions.md) · [Competitive analysis](docs/competitive-analysis.md) ·
[Contributor and agent guide](AGENTS.md)

## Status

Early. The core packages, CLI (with a session picker and a live receiver), website and a macOS desktop
build (session list and live receiver) work; the VS Code extension and more sources are planned.

## License

Apache-2.0. See [LICENSE](LICENSE).
