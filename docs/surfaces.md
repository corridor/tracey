# Surfaces

One core, four ways to run it **(decided)**. Everything below about *how* is **(proposal)**
unless marked.

| # | Surface | Like | Audience moment |
|---|---|---|---|
| 1 | Website | excalidraw.com | "Someone sent me a trace" / quick look, nothing to install. |
| 2 | VS Code extension | excalidraw-vscode | "I'm in my editor, the agent just ran, let me see it." |
| 3 | CLI | (jq, htop feel) | "I'm in a terminal or CI, what happened in this run?" |
| 4 | Desktop app (macOS, Linux, Windows) | netron | "Open this file from my disk, offline, privately." |

## Shared rule

One UI codebase, one core. Surfaces are thin shells that supply: how to get bytes in, how to
save/open files, and platform integration. A feature is not done until it works in every
surface it applies to, or the docs say why not.

## 1. Website

- Static site, no backend, no account. Drag a file in, or paste, or open `?url=` (CORS
  permitting). Everything is processed in the browser; nothing is uploaded.
- Installable PWA with offline support, so it opens instantly the second time.
- Shareable state: a link can restore view settings and selected span, but **never carries
  trace data** unless the user explicitly exports a file.
- Ships bundled sample traces for a "try it now" start.

## 2. VS Code extension

- Keep it simple: just open a trace file and see it. No session scanning, no landing page.
- Registers a **custom editor** for trace files (`.otlp.json`, `.jsonl`, `.tracey`, ...), so
  clicking a trace opens tracey, as excalidraw-vscode does for its files.
- Runs the same web UI inside a webview; the extension host reads files and talks to the
  workspace. Commands: "Open trace", "Diff two traces", "Open latest trace in workspace".
- Nice-to-have: jump from a span to the source file/line when the trace carries it. **(guess)**
- Also works in vscode.dev / Codespaces if it's a web-compatible extension.

## 3. CLI

Purpose: be useful without leaving the terminal and be scriptable in CI.

- `tracey <file>`: open that file: detect source, print a compact summary and the **findings**,
  then (in a TTY) open an interactive terminal view of the graph/tree with the inspector.
- `tracey listen`: start the live receiver and show traces as they arrive (below).
- `tracey` (no arguments): scan for sessions and open the picker (see "Session discovery").
  **(owner is still unsure about the CLI shape; this mapping is a proposal to revisit once the
  CLI is prototyped)**
- `tracey open <file>`: hand off to the desktop app or browser for the full visual.
- `tracey detect <file>`: just print the detected format with evidence.
- `tracey check <file> --fail-on error`: exit code for CI on findings.
- `tracey diff a b`: terminal diff of two runs.
- Output modes: human (colour, respects `NO_COLOR`), `--json` for machines.
- Must start fast (budget in architecture doc) and stream large files rather than load
  them whole.

`tracey listen` **(decided: in scope; built in the CLI as described, desktop toggle pending)**: start a local receiver and
watch an agent live, with no collector and no file step.

- Run `tracey listen`, then point the agent at it: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
  Spans stream into the same canvas as they arrive; the graph grows while the agent runs.
- Speaks OTLP over HTTP (JSON and protobuf) on port 4318. gRPC (4317) later if needed.
  Anything that exports OpenTelemetry works: OpenInference, OpenLLMetry, Strands, the OpenAI
  Agents instrumentor, and so on. Format detection runs per span as usual.
- **Local only.** Binds to `127.0.0.1` by default. Binding to another interface needs an
  explicit flag and prints a warning. No authentication on loopback, a token when exposed.
  Never forwards anything anywhere.
- **In memory by default**, with `--save traces.json` to keep a file. The UI can export the
  current run at any time.
- Groups spans into runs by trace id; a new run shows up as a new entry, and the latest is
  followed automatically unless the user pins one.
- Handles a busy or already-used port (clear message, `--port`), batching/late spans, and a
  trace that never closes (mark as "still running" after a quiet period).
- Desktop app has the same receiver, started from a "Listen" toggle, with the endpoint shown
  and a copy button. The website and VS Code webview can't open ports; VS Code can start the
  receiver through the extension host.
- Cost: protobuf decoding adds a dependency; keep it lazy-loaded so the normal start stays fast.

Open: implementation language. TypeScript (shares the core exactly, ships as a single
binary via a bundler/runtime) vs Rust (fastest start, better TUI libraries such as ratatui,
but a second implementation of parsing/detection/findings). See architecture decisions.

## 4. Desktop app

- Same UI as the website, packaged as a native window for macOS, Linux, Windows.
- **Start screen (built):** a list of the Claude Code sessions found on this machine (the same scan as the CLI, done in
  Rust), with a source sidebar, search, and a **Listen** toggle that starts a loopback OTLP receiver in the shell. Live
  runs appear in the list and, when opened, grow in place as spans arrive without losing pan or zoom.
- Adds: open files via OS file association and double-click, "Open with tracey", recent
  files, watching a file/folder for new traces (live-reload as the agent runs), native menus,
  offline always.
- Packaging: Tauri vs Electron. Search results (blog benchmarks, unverified by us) report Tauri
  apps in the low MBs and ~100s of ms cold start vs ~80+ MB and ~1s+ for Electron, but Tauri
  uses the OS web view, so canvas/WebGL behaviour can differ per platform and needs QA.
  **Recommendation:** Tauri, and test the renderer on WebKit (macOS), WebView2 (Windows) and
  WebKitGTK (Linux) from the start, because WebKitGTK is the likely weak spot.
- Fallback if rendering differences hurt: Electron for consistent Chromium.

## Session discovery on start **(decided)**

When the CLI or desktop app starts with no file argument, it scans the common places traces
are kept (for example `~/.claude*`, `~/.codex`, `~/.zed`, the VS Code workspace storage, and
tracey's own recent files), lists what it found newest first, and asks what to look at.
Rules **(proposal; built for the CLI)**: scanning lists names, times and sizes, and reads only the first
32 KB of the newest files to show a title and project path, never the conversation; the scan list is a documented, user-editable set of locations; it runs in the
background so the app opens instantly and results stream in; VS Code and the website use
the website and VS Code do **not** scan: they stay as simple as netron/excalidraw, just open
a file (VS Code opens trace files through its custom editor, the website by drop/paste).

**Desktop picker (decided: option B)**: a sidebar of sources (All, Claude Code, Codex, Zed,
VS Code Copilot, Files, plus a Live entry for `tracey listen`) with counts, a search box, and
richer rows (title, project path, turns, tool calls, duration, error/warning badge). Mockup
in `docs/mockups/`. The CLI picker is a terminal version of the same list; live runs appear in
it too, tagged "Listening" **(proposal; owner has not answered)**.

## Cross-surface capability matrix

| Capability | Web | VS Code | CLI | Desktop |
|---|---|---|---|---|
| Open file | drag/drop, picker | custom editor | arg | OS open, drag/drop |
| Paste | yes | yes | stdin | yes |
| Watch for new traces | no | workspace watcher | `--watch` | folder watch |
| Live receiver (`tracey listen`) | no | via extension host | yes | yes (toggle) |
| Full visual (timeline, graph, diff) | yes | yes | no (TUI subset) | yes |
| Findings | yes | yes | yes | yes |
| Offline | PWA | yes | yes | yes |
| Sends data anywhere | never | never | never | never |
