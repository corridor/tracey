# Decision log

Newest first. **Owner** = decided by the owner. **Mine** = my default, open to change.

## Product

| Date | Decision | By |
|---|---|---|
| 2026-10-16 | Primary user is the agent developer. | Owner |
| 2026-10-16 | Tracey is a modular library under `@ggx/` **and** a standalone app. | Owner |
| 2026-10-16 | Surfaces: website (drop-a-file), VS Code extension, CLI, desktop (macOS/Linux/Windows). | Owner |
| 2026-10-16 | Support four groups: already tracing; no tracing yet; coding-agent harnesses; third-party apps. | Owner |
| 2026-10-16 | UI only. No backend or SDK. Getting-started instructions are provided for every flow. | Owner |
| 2026-10-16 | Detect the trace source automatically. | Owner |
| 2026-10-16 | Visual and UX bar: stunning, simple, fast.com / excalidraw / jsonviewer / netron style. | Owner |
| 2026-10-16 | Performance is the top priority. | Owner |
| 2026-10-16 | Keep a roadmap so work can resume with "continue with the next step". | Owner |
| 2026-10-16 | Design follows the GGX docs theme (docs.genguardx.ai). | Owner |
| 2026-10-16 | UI is responsive across screen sizes (phone to ultrawide), container-query driven. | Owner |
| 2026-10-16 | v1 sources accepted as proposed: OpenInference, OTel GenAI, Claude Code transcripts; no-tracing guides for Strands and OpenAI Agents; diff and JSON explorer right after; third-party apps later. | Owner ("go with your sources") |
| 2026-10-16 | Website with drop-a-file is needed; sample traces bundled. | Owner |
| 2026-10-16 | Landing: option A (centered, calm drop target). Result view: option C (graph canvas first, floating findings/inspector panels, timeline strip, waterfall as a view switch). See `docs/mockups/`. | Owner |
| 2026-10-16 | `tracey listen` is in scope: CLI and desktop run a local receiver so an agent's spans appear live, with no collector or file step. | Owner |
| 2026-10-16 | Session picker: desktop uses option B (sidebar of sources + rich rows). Website and VS Code stay simple: just open a file (no session scanning). CLI: `tracey <file>` opens that file, `tracey listen` shows live traces, bare `tracey` opens the picker (owner unsure, treated as proposal). | Owner |
| 2026-10-17 | Open a trace from an http(s) URL on the website, CLI and desktop app (and download it with the CLI). Roadmap 4.8, 6.5, 8.5. | Owner |
| 2026-10-16 | Licence for all `@ggx/*` packages: Apache-2.0. | Owner |
| 2026-10-16 | On start, the CLI and desktop app scan the common places traces are kept (`~/.claude*`, `~/.codex`, `~/.zed`, ...) and ask the user what to look at. | Owner |

## Technology (all Mine until a spike confirms)

| Date | Decision | Status |
|---|---|---|
| 2026-10-16 | TypeScript everywhere; streaming parse in a worker; **no WASM** (100k spans parse in 330-430 ms in a worker) | Confirmed by spike 1.4 (one machine; see perf-spike.md) |
| 2026-10-16 | Solid for app UI (5.4 KB gzip vs Preact 6.6 KB; performance is a tie, so ergonomics decide) | Confirmed by spike 1.4 |
| 2026-10-16 | Canvas 2D with mandatory level-of-detail merging; WebGL2 only as a capability-gated fast path for 50k+ primitives (software WebGL costs 100-1500 ms/frame, Canvas 2D is unaffected) | Confirmed by spike 1.4 |
| 2026-10-16 | Web component core wrapper + thin React wrapper | Proposed |
| 2026-10-16 | Tauri for desktop (Electron fallback) | Proposed, QA on WebKitGTK |
| 2026-10-16 | CLI in TypeScript single binary (Rust if budgets missed) | Proposed |
| 2026-10-16 | pnpm monorepo, Vite, Vitest, Playwright | Proposed |

## Calls made when the owner said "just start working" (2026-10-16)

- Package names: `@ggx/trace-model`, `@ggx/trace-adapters`, `@ggx/trace-insights`, `@ggx/trace-theme`, views to follow `@ggx/trace-view-*` per architecture.md.
- `tracey listen` is scheduled in the CLI/desktop phases as decided; no change.
- Technology choices stay as proposed until `docs/verification/perf-spike.md` reports.

## Still open

- `tracey listen` details: gRPC support, default retention, wire formats (see surfaces.md).
- Local session discovery: permission model per surface.
- Codex and Salesforce Agentforce formats (not researched).
