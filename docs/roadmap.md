# Roadmap

This file is how work continues across sessions. When the owner says **"let's continue with
the next step"**, an agent should:

1. Read `AGENTS.md`, then this file, then `docs/decisions.md`.
2. Find the **Next step** below. Do it, following the linked docs.
3. Tick its boxes, update **Next step** to the following item, update `docs/decisions.md` if
   anything was decided, and add new steps if the work revealed them.
4. Report what was done and what is next. Commit only if asked.

Rule: before any step that creates code, check the gate in `AGENTS.md` (owner approval).

## Next step

> **Open from a URL** (owner request): CLI first (`tracey <url>`, `tracey download <url>`, `--header`, no CORS), then the website
> (`?url=` and a paste field, CORS-bound, with a clear message when blocked) and the desktop app (a Rust fetch to a temp file).
> Rules and flows are in `docs/user-flows.md`, Flow H. Then the **VS Code extension** (Phase 7), diff polish (colour changed steps on
> the graph, normalise step names across conventions so a cross-convention comparison is useful), a desktop CI job for
> macOS/Linux/Windows (8.3), hand-verifying the desktop window (`docs/testing.md`), and more sources once real exports exist.

## Phase 0: Vision and docs (done)

- [x] Vision, goals, non-goals ([vision.md](vision.md))
- [x] Competitive analysis ([competitive-analysis.md](competitive-analysis.md))
- [x] Architecture proposal ([architecture.md](architecture.md))
- [x] Design system: GGX theme ([design.md](design.md))
- [x] Surfaces ([surfaces.md](surfaces.md)), flows ([user-flows.md](user-flows.md)), format detection ([format-detection.md](format-detection.md))
- [x] Getting-started guides, draft ([guides/](guides/README.md))
- [x] UX principles incl. responsive rules ([ux-principles.md](ux-principles.md))
- [x] Roadmap and decision log (this file, [decisions.md](decisions.md))

## Phase 1: Decide and de-risk (no product code)

- [~] **1.1 Confirm scope.** DONE: v1 sources (OpenInference, OTel GenAI, Claude Code
      transcripts, Strands and OpenAI Agents guides), drop-a-file site, responsive UI.
      Licence Apache-2.0. `tracey listen` is in scope (see 6.4 and 8.4).
      LEFT (needed before 1.5): package names under `@ggx/`.
- [~] **1.2 Collect real fixtures and verify the guides.** DONE for OTel, OpenInference, Claude Code,
      Strands, OpenAI Agents, LangGraph, DeepAgents, Claude Agent SDK (see `docs/verification/`,
      `fixtures/`). LEFT: Phoenix/Dynatrace/Datadog/Langfuse/LangSmith export shapes (need real
      accounts or exports from the owner). Run each v1 guide against the real
      tool, save real exported traces as fixtures (scrubbed), correct the guides and the
      detection fingerprints. Includes researching Codex and Salesforce if they're in scope.
- [~] **1.3 Visual mockups.** DONE: landing A and result C chosen, saved in `docs/mockups/`.
      LEFT (do before Phase 4): mockups for diff, JSON explorer, CLI output, the desktop
      session picker (option B chosen), mobile sheets, and light theme; refine C at higher fidelity.
- [x] **1.4 Performance spike (throwaway, labelled).** DONE (`docs/verification/perf-spike.md`). 10k-span fixture; compare Canvas 2D vs
      WebGL graph/timeline (graph is the main view, so include layout of 10k nodes), Solid vs Preact shell, JSON.parse vs streaming parse. Report numbers
      against budgets in [architecture.md](architecture.md). Settle the "open decisions".
- [ ] **1.5 Write the implementation plan** for Phase 2-4 (use the writing-plans skill) and
      get owner approval. This lifts the "no code" gate.

## Phase 2: Foundation

- [x] 2.1 Monorepo (pnpm workspaces), TypeScript, lint, test, CI, size and perf budget checks.
- [x] 2.2 Design tokens package (`@ggx/trace-theme`; fonts not bundled yet): GGX light/dark/auto, fonts ([design.md](design.md)).
- [x] 2.3 `@ggx/trace-model`: struct-of-arrays model, ids, kinds, usage, tests.

## Phase 3: Ingest

- [ ] 3.1 Streaming parser + worker pipeline (JSON, JSONL), tested on 1k / 10k / 100k fixtures.
- [~] 3.2 Format detection (OTLP conventions done; other containers pending) ([format-detection.md](format-detection.md)) with evidence output.
- [~] 3.3 Adapters for v1 sources (OpenInference, GenAI done; Claude Code transcript next) (one at a time, each with real fixtures).
- [~] 3.4 Findings engine (failed, swallowed, repeated, slow, empty output done; token/cost outliers pending): first rules (errors, retries/loops, slow, cost/token outliers,
      truncated/empty output, swallowed tool error).

## Phase 4: The website (first shippable)

- [x] 4.1 Landing + drop/paste/sample (`apps/web`, Solid + Vite; main-thread parse for now) ([ux-principles.md](ux-principles.md)).
- [~] 4.2 Overview: chips + findings list done; verdict headline ("This run failed at X") pending.
- [x] 4.3 Graph canvas (main view): worker layout, viewport culling, pan/zoom, framing the first
      error, 60 fps on 10k nodes. Floating findings/inspector panels.
- [x] 4.3b Timeline strip and waterfall view (strip done; list view serves as the waterfall), virtualised, linked to the graph.
- [~] 4.4 Inspector done (pretty JSON, long-payload truncation); JSON explorer (virtualised tree, search, copy path).
- [ ] 4.5 Keyboard navigation, themes, a11y pass, responsive layouts (360/768/1280/2560 px,
      touch and pinch-zoom) with Playwright visual checks.
- [x] 4.6 Bundled sample, PWA/offline (manifest, icons, service worker, tested), perf and size budgets enforced in CI.
- [ ] 4.8 **Open from a URL** (website): a "Paste a link" field on the landing page and `?url=https://...` that loads the
      trace in the browser (CORS permitting), with a size cap, progress, and a clear message when the host blocks
      cross-origin reads (use download-and-drop, the desktop app, or the CLI). Also gzip (`.gz`) files by magic bytes.
      The link carries only the URL, never trace data. See "Open from a URL" in `docs/user-flows.md`.
- [ ] 4.7 Publish the site. **Milestone: "drop a file" website live.**

## Phase 5: Diff

- [x] 5.1 Run-vs-run diff (engine `@ggx/trace-diff`, website view, `tracey diff`; the graph does not colour changed steps yet): span alignment, text diff for payloads.

## Phase 6: CLI

- [ ] 6.1 `tracey <file>`, `detect`, `check`, `--json`; streaming; start-time budget.
- [x] 6.1b Session scan on start with no args: picker of found sessions (Claude Code only so far; verified in a pty on real sessions).
- [ ] 6.2 Terminal explorer (TTY), `diff`.
- [ ] 6.3 Single-binary distribution.
- [ ] 6.5 **Fetch from a URL** (CLI): `tracey <https://...>` opens a remote trace, `tracey download <url> [-o file]` saves it,
      with `--header 'Authorization: ...'` for private links (no CORS limits in Node), redirects, a size cap and a timeout.
- [x] 6.4 `tracey listen` (done; verified with the real Python OTLP protobuf exporter, including a pty check of the live view): local OTLP/HTTP receiver (JSON + protobuf), loopback-only, in-memory,
      `--save`, live-updating graph, runs by trace id. Test with a real Strands/OpenAI Agents/
      LangGraph script. Update `docs/guides/no-tracing.md` when it ships.

## Phase 7: VS Code extension

- [ ] 7.1 Custom editor hosting the web UI; open/diff commands.
- [ ] 7.2 Workspace watcher for new trace files (no session scanning in VS Code; keep it simple).

## Phase 8: Desktop app

- [~] 8.1 Tauri shell (`apps/desktop`), file association and open-with built; macOS .app builds at 3.2 MB and launches with a file. Recent files pending. Linux/Windows untested.
- [~] 8.2 Session scan on start: done (Rust scan + picker UI, tested in Rust and in the browser against a stand-in shell). Folder watching pending.
- [ ] 8.3 Renderer QA on WebKit, WebView2, WebKitGTK; installers for macOS/Windows/Linux.
- [ ] 8.5 **Open from a URL** (desktop): a "Paste a link" box in the start screen, fetched by the shell (a Rust command that
      streams to a temp file, so there is no CORS limit and large files do not cross the IPC), with optional headers.
- [x] 8.4 "Listen" toggle in the desktop app (Rust receiver hands raw bodies to the shared TypeScript decoder; endpoint shown). Copy button pending. The real window could not be driven here; verified by Rust tests, browser tests with a stand-in shell, and the app building and launching.

## Phase 9: More sources

- [ ] 9.1 Datadog, Langfuse, LangSmith, OpenLLMetry.
- [ ] 9.2 Harness sessions: Claude Code (v1 if chosen), Codex, VS Code Copilot, Zed.
- [ ] 9.3 Third-party: Vapi, HAR capture; Salesforce after research.

## Phase 10: Open-source release

- [ ] 10.1 Split and publish `@ggx/*` packages, each with README, examples, size badge.
- [ ] 10.2 Web component + React wrapper.
- [ ] 10.3 Docs site, contribution guide, issue templates.

## Parking lot (ideas not scheduled)

- Share a redacted trace (one-click redaction) without a server.
- Source-line jumping from a span (VS Code).
- Watch mode comparing the latest run to the previous one automatically.
- MCP server / agent-readable summary of findings.
