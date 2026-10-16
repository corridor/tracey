# Architecture (proposal)

Everything here is **(proposal)** until the owner approves it. Nothing is built yet.

## Package split under `@ggx/`

Names are placeholders. Dependencies point downward only.

```
@ggx/tracey            batteries-included viewer (composes everything below)
   |
   +-- @ggx/trace-view-timeline   waterfall / flame-style timeline
   +-- @ggx/trace-view-graph      node graph of steps and sub-agents
   +-- @ggx/trace-view-diff       text/JSON/run diff
   +-- @ggx/trace-view-json       virtualised JSON tree explorer
   +-- @ggx/trace-inspector       step detail panel (messages, tool calls, metadata)
   |
   +-- @ggx/trace-insights        findings engine: pure functions over the model
   +-- @ggx/trace-adapters        OTel GenAI, and vendor formats -> model
   |
   +-- @ggx/trace-model           types, normalisation, indexes (no DOM, no deps)
```

Rules:

- `trace-model` has no DOM and no dependencies. It is the contract everything shares.
- Views depend on `trace-model` only (plus a small shared rendering/virtualisation helper if
  it earns its place). Views do not depend on each other.
- `trace-insights` and `trace-adapters` are headless, so they work in Node, workers, CI.
- Each package is useful alone: e.g. someone can take only `trace-view-json`.

## Canonical model

**(proposal)** A flat, indexed span list rather than a nested tree: `id`, `parentId`,
`kind` (llm, tool, agent, retrieval, other), `start`, `end`, `status`, `attributes`,
`input`, `output`, `usage` (tokens, cost). Tree and graph shapes are derived indexes.
Flat arrays are faster to build, diff, virtualise, and ship to a worker.
OpenTelemetry GenAI conventions are the likely basis; they are still in Development status
upstream, so the model must absorb change in adapters, not in views.

## Performance strategy

Targets **(proposal, to be validated by measurement)**:

| Thing | Budget |
|---|---|
| First render of a 1k-span trace | < 100 ms |
| Pan/zoom/scroll | 60 fps on a 10k-span trace |
| Search across a trace | < 50 ms perceived |
| Core bundle (model + one view) | small enough to quote in KB, gzip, tracked in CI |

Techniques to use from the start rather than retrofit:

- **Virtualise everything long**: span lists, JSON trees, diff lines.
- **Canvas (or WebGL if needed) for the timeline and graph**, DOM for text and chrome.
  speedscope renders flamegraphs with WebGL for this reason. Don't make thousands of DOM nodes.
- **Parse and index off the main thread** (worker) for large inputs; transfer typed arrays.
- **Lazy-load heavy payloads**: render span metadata first, format big prompt/output text on
  demand.
- **Compute findings incrementally** and cache; show the trace before findings finish.
- **No framework runtime in core packages.** Framework bindings are thin wrappers.
- Perf regression benchmarks in CI with fixture traces of increasing size.

## Findings (insights) shape

A finding is `{ id, severity, title, spanIds, evidence }`. Rules are small pure functions
`(trace) => Finding[]`, registered in a list, so users can add their own. Candidate rules:
failed span, retry storm, repeated identical tool call (loop), slowest path, token/cost
outlier, empty or truncated output, context nearing limit, unhandled tool error swallowed
by the agent.

## Apps layer

The four surfaces in [surfaces.md](surfaces.md) sit on top of the packages:

```
apps/web        static site / PWA
apps/vscode     custom-editor extension (webview loads the web UI build)
apps/desktop    Tauri shell around the web UI build
apps/cli        terminal app (summary, findings, TUI, check, diff)
      \  |  /
   @ggx/tracey (app UI)  ->  views / inspector / insights / adapters / model
```

The web, VS Code and desktop apps share one UI bundle. The CLI shares the headless packages
(model, adapters, insights) and has its own terminal renderer.

## Technology calls (my defaults, since the owner is open on framework)

These are **my calls**, chosen for speed and small size. Each is cheap to revisit before code
exists and expensive after.

| Area | Call | Why |
|---|---|---|
| Language | TypeScript everywhere to start | One implementation of parse/detect/findings shared by web, VS Code, desktop and CLI. |
| Heavy lifting | Plain TS in a Web Worker; **benchmark before adding Rust/WASM** | V8 `JSON.parse` is very fast. Add WASM only where a benchmark proves a win (huge JSONL, protobuf, streaming). Avoid a second implementation unless needed. |
| App UI chrome | **Solid** (fine-grained reactivity, tiny runtime, no virtual DOM) | Fast updates with little code. Alternative: Preact if ecosystem reach matters more. |
| Trace canvases (timeline, graph) | **Canvas 2D first**, own thin renderer; WebGL later if a benchmark demands | Canvas 2D has the lowest startup cost; GPU setup costs matter for short-lived views. A WebGL graph test in search results showed much faster steady-state drawing but slower initial load. WebGPU support is not universal yet. |
| Graph layout | Run in a worker; incremental; layered layout for trees/DAGs | Layout is the usual graph bottleneck. |
| Library reach | Core is framework-agnostic; ship a **web component** wrapper plus a thin React wrapper | Agent developers use many stacks; custom elements work everywhere. |
| Desktop | **Tauri** (test WebKitGTK on Linux early); Electron as fallback | Small and fast to start; webview differences are the risk. |
| CLI | **TypeScript** compiled to a single binary; revisit Rust if start time or TUI quality fails budgets | Shares the core; avoids rewriting. |
| Build | pnpm workspaces monorepo, Vite for apps, tsup/esbuild for libs | Fast, simple. |
| Tests | Vitest (unit), Playwright (UI + perf), fixture traces per source | Perf tests run in CI. |

## Performance plan (expanded)

Performance is the top priority, so it has its own rules:

1. **Streaming, not slurping.** Parse JSON/JSONL incrementally, emit spans as they arrive,
   render the first spans before parsing finishes.
2. **Everything heavy off the main thread**: parse, detect, index, layout, findings, search.
   Results come back as typed arrays (transferable), not object graphs.
3. **Struct-of-arrays model** for spans (ids, parents, start, end, kind as typed arrays;
   strings in an interned table). Cheap to build, scan, sort, and transfer.
4. **Lazy payloads.** Keep input/output text as byte ranges into the original buffer; decode
   only what's on screen or selected.
5. **Draw only what's visible**: level-of-detail on the timeline (merge sub-pixel spans),
   viewport culling on the graph, virtualised lists and trees.
6. **Detect from a sample**, never a full scan.
7. **Fast start**: small initial bundle, code-split views, lazy-load fonts and heavy views,
   PWA/service worker caching on web, a lean webview shell on desktop, minimal imports in the
   CLI.
8. **Measure in CI**: fixture traces at 1k / 10k / 100k spans, report parse time, first paint,
   interaction frame times, bundle size, memory. Budgets below fail the build.

### Budgets **(proposal, to be validated by measurement)**

| Thing | Budget |
|---|---|
| Web: time to interactive, cold, 4G | < 1 s; shell < ~100 KB gzip before any trace loads **(to validate)** |
| Parse + detect + first paint, 1k-span / 5 MB file | < 200 ms |
| Parse + first paint, 100k-span / 200 MB file | first spans visible < 1 s, fully loaded streaming in background |
| Pan / zoom / scroll | 60 fps at 10k visible-eligible spans |
| Search across a trace | < 50 ms perceived |
| CLI start to first output, small file | < 100 ms |
| Desktop cold start | < 500 ms to window |
| Memory | no more than ~3x the file size loaded **(to validate)** |

## Open decisions

- Confirm Solid vs Preact, and Canvas 2D vs early WebGL, by building a spike with a 10k-span
  fixture before committing. A throwaway spike is cheap and the right way to settle this.
- Licence for published packages.
- Monorepo naming of packages (see split above).
- CLI language if the TypeScript binary misses start-time budgets.
