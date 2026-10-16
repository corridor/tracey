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
| 2026-10-16 | Licence for all `@ggx/*` packages: Apache-2.0. | Owner |
| 2026-10-16 | On start, the CLI and desktop app scan the common places traces are kept (`~/.claude*`, `~/.codex`, `~/.zed`, ...) and ask the user what to look at. | Owner |

## Technology (all Mine until a spike confirms)

| Date | Decision | Status |
|---|---|---|
| 2026-10-16 | TypeScript everywhere; plain TS in a worker; Rust/WASM only if benchmarks demand | Proposed, spike 1.4 |
| 2026-10-16 | Solid for app UI (Preact alternative) | Proposed, spike 1.4 |
| 2026-10-16 | Canvas 2D first, WebGL if needed | Proposed, spike 1.4 |
| 2026-10-16 | Web component core wrapper + thin React wrapper | Proposed |
| 2026-10-16 | Tauri for desktop (Electron fallback) | Proposed, QA on WebKitGTK |
| 2026-10-16 | CLI in TypeScript single binary (Rust if budgets missed) | Proposed |
| 2026-10-16 | pnpm monorepo, Vite, Vitest, Playwright | Proposed |

## Still open

- Whether `tracey listen` (local OTLP receiver) is in scope.
- Package names.
- Local session discovery: permission model per surface.
- Codex and Salesforce Agentforce formats (not researched).
