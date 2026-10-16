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

- Registers a **custom editor** for trace files (`.otlp.json`, `.jsonl`, `.tracey`, ...), so
  clicking a trace opens tracey, as excalidraw-vscode does for its files.
- Runs the same web UI inside a webview; the extension host reads files and talks to the
  workspace. Commands: "Open trace", "Diff two traces", "Open latest trace in workspace".
- Nice-to-have: jump from a span to the source file/line when the trace carries it. **(guess)**
- Also works in vscode.dev / Codespaces if it's a web-compatible extension.

## 3. CLI

Purpose: be useful without leaving the terminal and be scriptable in CI.

- `tracey <file>`: detect source, print a compact summary and the **findings**, then (in a
  TTY) open an interactive terminal view of the timeline/tree with the inspector.
- `tracey open <file>`: hand off to the desktop app or browser for the full visual.
- `tracey detect <file>`: just print the detected format with evidence.
- `tracey check <file> --fail-on error`: exit code for CI on findings.
- `tracey diff a b`: terminal diff of two runs.
- Output modes: human (colour, respects `NO_COLOR`), `--json` for machines.
- Must start fast (budget in architecture doc) and stream large files rather than load
  them whole.

Open: implementation language. TypeScript (shares the core exactly, ships as a single
binary via a bundler/runtime) vs Rust (fastest start, better TUI libraries such as ratatui,
but a second implementation of parsing/detection/findings). See architecture decisions.

## 4. Desktop app

- Same UI as the website, packaged as a native window for macOS, Linux, Windows.
- Adds: open files via OS file association and double-click, "Open with tracey", recent
  files, watching a file/folder for new traces (live-reload as the agent runs), native menus,
  offline always.
- Packaging: Tauri vs Electron. Search results (blog benchmarks, unverified by us) report Tauri
  apps in the low MBs and ~100s of ms cold start vs ~80+ MB and ~1s+ for Electron, but Tauri
  uses the OS web view, so canvas/WebGL behaviour can differ per platform and needs QA.
  **Recommendation:** Tauri, and test the renderer on WebKit (macOS), WebView2 (Windows) and
  WebKitGTK (Linux) from the start, because WebKitGTK is the likely weak spot.
- Fallback if rendering differences hurt: Electron for consistent Chromium.

## Cross-surface capability matrix

| Capability | Web | VS Code | CLI | Desktop |
|---|---|---|---|---|
| Open file | drag/drop, picker | custom editor | arg | OS open, drag/drop |
| Paste | yes | yes | stdin | yes |
| Watch for new traces | no | workspace watcher | `--watch` | folder watch |
| Full visual (timeline, graph, diff) | yes | yes | no (TUI subset) | yes |
| Findings | yes | yes | yes | yes |
| Offline | PWA | yes | yes | yes |
| Sends data anywhere | never | never | never | never |
