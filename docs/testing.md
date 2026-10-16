# Testing tracey

## Automated

```bash
pnpm test           # unit tests (Vitest): model, adapters, insights, CLI, web loader
pnpm typecheck      # strict TypeScript across every package
pnpm test:e2e       # browser tests (Playwright, Chromium) against the real site
```

The first time, install the browser once: `pnpm --filter @ggx/tracey-web exec playwright install chromium`.
If you already have a Playwright Chromium, set `PLAYWRIGHT_BROWSERS_PATH` to its folder.
`pnpm test:e2e` starts its own dev server on port 5199 and a production build preview on port 4199 (and reuses them if already running).

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and the browser tests on every
pull request and push to `master`.

### What is covered

| Area | How |
|---|---|
| Span model: ordering, cycles, empty trace, self time, tokens | `packages/trace-model/test` |
| Format detection and mapping for OpenInference, OTel GenAI, OpenLLMetry, Claude Code | `packages/trace-adapters/test`, against the real fixtures in `fixtures/` |
| Findings: failed, swallowed, repeated, slow, grouping | `packages/trace-insights/test` |
| Graph layout (no overlaps, 50k spans) and timeline strip level-of-detail | `packages/trace-view-*/test` |
| Desktop bridge (asset-protocol read, launch file, later opens): `apps/web/test/desktop.test.ts`; Rust: argument parsing, session scan (folders, ordering, titles, limits), and the OTLP receiver with real HTTP requests: `pnpm --filter @ggx/tracey-desktop test` | automated |
| Desktop start screen against a stand-in for the shell (list, filter, open, empty state, phone width, Listen on/off, live run that grows, port in use): `apps/web/e2e/desktop.spec.ts` | automated |
| Live run decoding and grouping (protobuf, gzip, JSON): `apps/web/test/live.test.ts` | automated |
| Session discovery (config dirs, ordering, titles, limits, sub-agent exclusion) | `packages/trace-discover/test`, with temp folders |
| Picker state machine, key decoding, rendering, `sessions` and bare `tracey` | `apps/cli/test` |
| OTLP protobuf decoding (real Python-encoder bytes, negative ints, truncated input) | `packages/trace-adapters/test` |
| `tracey listen`: JSON, protobuf and gzip bodies, bad payloads, joined batches, `--save` round trip, live render, port in use, non-loopback warning | `apps/cli/test/listen.test.ts` |
| CLI output, `detect`, `check` exit codes, `--json`, bad input | `apps/cli/test` |
| Offline and install: manifest and icons served, site reopens and loads a sample with the network off (production build on port 4199) | `apps/web/e2e/offline.spec.ts` |
| Website: landing, sample, every supported format, paste, finding clicks, keyboard walk, list view, close inspector, theme change repaints the canvas, phone/tablet/wide viewports, unrecognised file, 20,000-span trace under 5 s | `apps/web/e2e` |

When you fix a bug, add a test that fails without the fix (the selection-echo bug between the graph
and the strip is covered by the "arrow keys walk the tree" browser test).

## By hand, with the dev server

```bash
pnpm dev            # http://localhost:5173
```

A short checklist (about five minutes):

1. **Landing.** Headline, drop target, *Try a sample*. Drop a text file: a readable error appears.
2. **Sample.** Click *Try a sample*. Expect an `OpenInference` chip, `16 spans`, `1 error`, and the
   graph framed on the failed `search_flights`.
3. **Graph.** Drag to pan, two-finger scroll to pan, Ctrl/Cmd + scroll or pinch to zoom, double-click
   a node to zoom in. Press `F` to fit. Click the canvas and use the arrow keys to walk the tree.
4. **Findings.** Hover a finding: its spans get an outline in the graph and the strip. Click one: the
   inspector shows that step.
5. **Strip.** Click a bar: the graph frames that step.
6. **List view.** Toggle *List*: every span is a row with a bar; click a row to inspect it.
7. **Themes.** Click the half-circle button: dark, light, auto. The canvases recolour.
8. **Formats.** Drop each file in `fixtures/` (see the table in [development.md](development.md)).
   The detected source in the header should match the file.
9. **Responsive.** Resize the window down to a phone width: panels become sheets, nothing scrolls
   sideways. Try browser device emulation (Chrome DevTools, Cmd+Shift+M).
10. **Big trace.** Generate one and drop it in: `node spikes/perf/gen.mjs` (see its README). Panning
    and zooming should stay smooth.

## Regenerating the README screenshots

```bash
SCREENSHOTS=1 pnpm --filter @ggx/tracey-web test:e2e screenshots
```

Writes `docs/images/*.png` (2x, dark and light, phone, landing).

## Performance checks

The throwaway perf spike lives in `spikes/perf` (own `package.json`, see its README). Re-run it when
you change parsing or rendering, and compare against the budgets in
[architecture.md](architecture.md). Results from the last run: [perf-spike.md](verification/perf-spike.md).

## Adding a fixture

Put real exporter output (scrubbed of secrets and private data) or a clearly synthetic file under
`fixtures/<source>/`, add a README saying how it was made, and add a test that reads it.

## `tracey listen` against a real exporter

The automated tests post fixtures with `fetch`. To check with the real Python exporter (what most agents use):

```bash
python3 -m venv /tmp/pbvenv && /tmp/pbvenv/bin/pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
pnpm tracey listen --port 4318 --save /tmp/live.jsonl      # terminal 1
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 /tmp/pbvenv/bin/python your_agent.py   # terminal 2
```

Spans appear within a fraction of a second; Ctrl-C prints a report and `pnpm tracey /tmp/live.jsonl` reopens it.

## Desktop app by hand

There is no automated UI test for the native window (Tauri's WebDriver does not support macOS).

1. `pnpm --filter @ggx/tracey-desktop build:app`, then launch the `.app` it prints.
2. The landing page appears; *Try a sample* works; the window resizes down to phone width.
3. Quit, then `open -a <path>/tracey.app $PWD/fixtures/openinference/travel-planner.collector-file.jsonl`:
   the trace opens straight away.
4. With the app running, run that `open -a` command again with another fixture: the new trace replaces the old one.
5. Right-click a `.jsonl` file in Finder: *Open With > tracey* is offered.
6. Drop a file onto the window, and use *Choose one*.
7. The offline service worker is deliberately not registered in the desktop app.
8. **Start screen:** launching with no file lists your Claude Code sessions; search filters; clicking one opens it; the logo returns.
9. **Listen:** click *Listen for a running agent*, run `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 python your_agent.py`
   (or `curl` a fixture, see development.md). A live run appears under Live; open it and watch it grow. Turn Listen off and the port frees.
