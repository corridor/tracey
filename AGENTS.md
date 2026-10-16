# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What tracey is

A **UI-only**, modular, very fast library and standalone app (web, VS Code, CLI, desktop) for visualising AI-agent traces, surfacing the
problems in them quickly, and helping people debug. No backend, no storage, no auth, no
SDK for emitting traces. See `docs/vision.md`.

Primary user: the agent developer. Reference products for feel: diffchecker (diffing), jsonviewer.stack.hu (JSON
exploration), netron (graph inspection), excalidraw (snappy, elegant canvas).

## Status

Early implementation. Foundation packages, a CLI and a website shell exist (see `docs/roadmap.md`
for what is done and next). The owner asked to start building and tweak plans later; keep the
roadmap and decision log current. Decisions marked **(proposal)** may still change.

## Continuing work

When the owner says "continue with the next step": read `docs/roadmap.md` (it defines the
protocol and the **Next step**), then `docs/decisions.md`. Do that step, tick it off, update
the roadmap and decision log, and report. Keep the roadmap current whenever plans change.

## Docs map

- `docs/development.md` — how to install, run, test locally.
- `docs/roadmap.md` — phased plan and the current **Next step**. Start here to resume.
- `docs/decisions.md` — what the owner decided vs. my defaults, and what is still open.
- `docs/ux-principles.md` — simplicity rules; the product should feel like fast.com/excalidraw.
- `docs/guides/` — getting-started guides for each kind of user (draft, unverified).
- `docs/vision.md` — why this exists, goals, non-goals, anti-goals.
- `docs/architecture.md` — proposed package split under `@ggx/`, data flow, perf strategy.
- `docs/competitive-analysis.md` — what similar tools do well and badly.
- `docs/design.md` — GGX docs theme: colour tokens, fonts, shape, UI rules. Follow it.
- `docs/surfaces.md` — web, VS Code, CLI, desktop: how each works and shares one core.
- `docs/user-flows.md` — how users get a trace in and debug an agent, per tool/framework.
- `docs/format-detection.md` — detecting trace source (OpenInference, OTel GenAI, ddtrace, Langfuse...).

## Non-negotiable principles

1. **Fast first.** Interaction must feel instant. Budgets live in `docs/architecture.md`.
   A feature that blows a budget needs an explicit trade-off note, not a silent merge.
2. **Modular.** Every package under `@ggx/` must be independently publishable and usable.
   No package may import from a sibling's internals, only its public entry point. No cycles.
3. **Small.** Treat bundle size as a feature. Prefer zero or near-zero runtime dependencies;
   justify each one.
4. **UI only.** Data comes in through a plain, documented trace model. Never add network,
   storage, or vendor-specific SDK code to core packages. Vendor formats are adapters.
5. **Surface what matters.** Every view should answer "what's wrong here?" before "what
   happened?". Findings (errors, retries, loops, cost/latency outliers) are first-class.
6. **Privacy by default.** Traces contain prompts and user data. Everything runs
   client-side; nothing leaves the browser.

## Working in this repo

- Write code that matches surrounding code: comment density, naming, idiom.
- Prefer editing existing files over adding new ones.
- Keep docs in sync when a decision changes; update the relevant file in `docs/`.
- **Commit in small, atomic commits** (owner's standing instruction), following
  `docs/committing.md`: Conventional Commits with an area, `type(area): outcome`, title at
  most 72 chars, body explains *why*. Each commit leaves the repo working. Work on a branch,
  not directly on `master`.
