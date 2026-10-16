# Verification: performance spike (parse, timeline, graph, UI shell, detection)

Roadmap step 1.4. Measured 2026-10-16. Spike code: `spikes/perf/` (throwaway, has its own README with rerun
steps; raw numbers in `spikes/perf/results/*.json`). Everything below is **measurement on one fast machine
with synthetic traces**; read the caveats before quoting any number.

## Summary and recommendations

| Open decision | Recommendation | Evidence in one line |
|---|---|---|
| Canvas 2D vs WebGL | **Canvas 2D by default, with mandatory LOD merging; keep WebGL2 as a capability-gated fast path behind the same renderer interface, build it only when 50k+ visible primitives matter.** | 10k spans/nodes: Canvas 2D 0.7-2 ms per frame (9-12 ms worst frame at 4x CPU), well inside 60 fps. 100k spans fully zoomed out: Canvas 2D 18 ms naive, 5.6 ms with merging, WebGL 0.5-0.8 ms. WebGL without a hardware GPU is 100-1500 ms per frame (SwiftShader), Canvas 2D is unaffected. |
| Solid vs Preact | **Keep Solid (architecture default).** It is a near tie on performance; the choice is ergonomics and ecosystem. | Cold start 31.1 vs 31.2 ms, select 0.37 vs 0.34 ms, 10k-row virtual scroll 0.52 vs 0.60 ms, gzip 5.4 vs 6.6 KB for the same shell. Vanilla is 1.6 KB but no faster at the update path I wrote. |
| Worker + streaming parse | **Yes: stream line by line in a Web Worker, transfer typed-array chunks, first chunk after the first line.** Parse on the main thread only for tiny inputs if the 30 ms worker start-up ever matters. | 241 MB: main-thread parse blocks the UI 280-370 ms; worker blocks it 0 ms and shows the first spans in 27 ms. 5 MB: 10 ms on main, 33 ms in worker, both inside the 200 ms budget. |
| WASM | **Not needed.** | `JSON.parse` per line runs at about 0.75-0.8 GB/s here: 241 MB / 100k spans fully parsed into the SoA model in 300-430 ms. A hand-written JS byte scanner was no faster (it only used less memory). Revisit only for protobuf OTLP, files over about 1 GB, or if the throttled-device numbers below turn out worse than extrapolated. |
| Layout | Compute in a worker: tidy tree 1.2 ms, layered DAG 9 ms for 10k nodes (see caveat on layout quality). | Not an open decision, but it confirms layout is not the bottleneck. |
| Detection | Sniff plus fingerprint from a sample costs about 1 ms regardless of file size. | 0.6-1.5 ms median on 2-241 MB files. |

Budget check (from `docs/architecture.md`):

| Budget | Result | Verdict |
|---|---|---|
| First render of a 1k-span trace < 100 ms | parse 5-10 ms (main) or 33 ms (worker), lane layout 4-15 ms, renderer setup 3-26 ms: about 25-60 ms of compute before real UI work (fonts, DOM chrome not included) | PASS (partial, no full app yet) |
| Pan/zoom/scroll 60 fps on 10k spans | timeline 10k: 0.7-2.2 ms draw p95, 9 ms worst phase at 4x CPU throttle; graph 10k: 1.0 ms p50, 2.8 ms p95 (12 ms p95 at 4x) with edge skipping; WebGL 0.4-3.5 ms p95 everywhere (the slow end is 100k spans at 4x CPU, or the 2D label overlay) | PASS for Canvas 2D with LOD. FAIL without edge LOD at 4x (62 ms p95 on the zoomed-out graph) |
| Parse + detect + first paint, 1k / 5 MB < 200 ms | detect 1.5 ms + parse 10 ms (main) / 33 ms (worker) + renderer setup under 30 ms | PASS |
| 100k / 200 MB: first spans < 1 s, then streaming | first spans 27 ms (worker), full parse 330-430 ms on the M5 Pro; 4x-slower device extrapolates to about 110 ms first spans and 1.3-1.7 s full | PASS (extrapolated for slow device) |
| Pan/zoom 60 fps at 10k visible-eligible spans | see above | PASS |
| Web TTI cold on 4G < 1 s, shell < ~100 KB gzip | shell + 10k virtual list + inspector: 5.4 KB (Solid) / 6.6 KB (Preact) gzip; cold interactive 31 ms local, 49 ms at 4x CPU, about 400 ms at 4x CPU plus 9 Mbps / 170 ms RTT (latency dominated). Renderers, layouts, parser and detection add about 7 KB gzip (Canvas 2D) to 11 KB (with WebGL2) | PASS (spike shell only: no fonts, no real app code) |
| Search across a trace < 50 ms | not measured in this spike | NOT MEASURED |
| Memory <= ~3x file size | main-thread whole-document `JSON.parse` 585 MB peak extra RSS for 241 MB (2.4x); streaming lines 193-241 MB (about 0.9x); byte scanner 75-86 MB (0.35x); keeping every long payload string resident adds about 140 MB (Node: 436 MB peak RSS, 1.8x) | PASS |
| Core bundle quoted in KB gzip | see "Bundle sizes" | n/a |
| CLI start, desktop cold start | out of scope here | NOT MEASURED |

## Environment

| Item | Value |
|---|---|
| Machine | Apple M5 Pro, 15 logical CPUs, 24 GB RAM, macOS 27.0.1 (26A434) |
| Node | v24.21.0 |
| Browser | Playwright 1.64.1 Chromium 156.0.8078.4, headless |
| GPU modes | "gpu": ANGLE Metal on the Apple M5 Pro (`--use-angle=metal`). "sw": Playwright default, ANGLE on SwiftShader (software Vulkan). Canvas 2D numbers are identical in both modes, so Canvas 2D was most likely CPU-rasterised in both (headless); a GPU-accelerated 2D canvas may behave differently. |
| Display | 1400x600 (timeline) and 1400x700 (graph) CSS px canvases at devicePixelRatio 2 |
| Tooling | Vite 7.3.7, esbuild 0.25.12, solid-js 1.9.17, preact 10.29.8, vite-plugin-solid 2.11.14 |
| Mid-range emulation | CDP `Emulation.setCPUThrottlingRate` 4x (main thread only; **not applied to workers**) |

## Method

**Data.** `spikes/perf/gen.mjs` takes the span attribute shapes from the real fixtures in
`fixtures/openinference/` and `fixtures/otel-genai/` and generates OTLP JSON traces: root agent, 2-6 LLM steps per
agent, sequential or parallel tool calls, sub-agents (nested up to 3 deep), wide fan-out (20-80 parallel tool spans),
loops (5-20 repeated calls), about 1.75% error spans with an exception event, long text payloads (mean about 2.4 KB per
span, 12x outliers), spans exported in end-time order, mixed OpenInference and OTel GenAI flavours. Files:

| Name | Spans | Size | Shape |
|---|---|---|---|
| 1k | 1,000 | 2.1 MB | collector-file JSONL (64 spans per line) and single `{"resourceSpans":[...]}` document |
| 1k (5 MB) | 1,000 | 5.3 MB | same, payloads 2.4x larger (the architecture budget's file) |
| 10k | 10,003 | 23 MB | same |
| 100k | 100,000 | 241 MB | same (this is the "~200 MB" file) |

For the render benches the parsed model is dumped once (`model.mjs`) and traces are laid back to back on one time axis,
so the 100k "timeline" is one long session. Lane packing gives 82 lanes for 100k spans.

**Parse.** Three strategies produce the same struct-of-arrays model (typed arrays for start, duration, parent, interned
name id, kind, error, tokens; chunks of 4096 spans), verified equal by checksum:
`whole` = read all text, one `JSON.parse` of the single document, then walk it;
`lines` = stream the file (`File.stream()`), split on newlines, `JSON.parse` each line;
`scan` = stream bytes and scan them with a hand-written JS scanner that never materialises payload strings
(uses native `indexOf` to skip string bodies). Each ran on the main thread and in a Web Worker that transfers the chunk
buffers. Each case ran 3 times in a fresh page; medians are shown. Memory is the peak RSS of all spike-launched Chromium
processes (sampled every 40 ms) minus idle, so it includes everything (file buffers, GC slack). It can miss sub-40 ms
spikes. "Max frame gap" is the longest gap between animation frames while parsing (17.7 ms is the idle 60 Hz cadence,
anything above means the UI froze).

**Timeline.** Spans are packed into lanes (greedy interval partitioning). Four renderers: Canvas 2D without LOD
(cull by binary search per lane, one `fillRect` per span, minimum 1 px width), Canvas 2D with LOD (consecutive
sub-pixel spans in a lane are merged into one run; an error inside a run wins its colour; draws are batched per colour),
WebGL2 without LOD (all spans as instanced quads in a static buffer, culling and min-width clamp in the shader, hi/lo
float split for time), WebGL2 with LOD (CPU cull+merge as above, upload only visible instances). Scripted 300-frame
interaction: hold fully zoomed out while scrolling lanes (every span eligible, the stress case), zoom to 3% of the
extent, pan, zoom back out. Frame time = draw call time + forced 1x1 readback so raster/GPU work is inside the number
(the idle readback floor is about 0.2 ms for 2D and about 1 ms for GL and is shown in the raw results).

**Graph.** Edges are parent-to-child plus "next LLM step" edges between consecutive non-overlapping sibling LLM spans
(so it is a DAG). Layouts, run in a Web Worker (median of 5 runs after warm-up): a tidy tree (O(n)) and a layered DAG
(longest-path layering, 4 barycentre sweep pairs, simple coordinate assignment). Rendering uses the tidy-tree positions
with all edges, because the crude DAG x-assignment produced very long edges that dominated draw cost. Renderers:
Canvas 2D (screen-space coordinates computed in JS, one batched path for edges, per-colour batched node paths,
rounded corners at zoom > 0.35, labels at zoom > 0.5, with and without sub-pixel edge skipping) and WebGL2 (instanced
quads for nodes, instanced lines for edges, labels via a 2D overlay canvas). Viewport culling is a linear bbox test per
node/edge in JS for Canvas 2D (the GPU culls for WebGL). Scripted like the timeline: hold fit-all, zoom in, pan, zoom out.

**UI shell.** Identical app in Solid, Preact and vanilla: header, a virtualised list of 10,000 spans (28 px rows,
about 40 rows in the DOM), and an inspector with an attribute table plus 2 KB of text. Built with Vite (esbuild
minify), served gzip-compressed with no cache. Cold start = `performance.now()` at the first animation frame after the
app rendered (26 runs per app, interleaved across apps, first 3 dropped, median). Select = 100 clicks, time to the DOM
mutation observer callback and to next paint. Scroll = 100 jumps of the list, handler invoked synchronously.

**Detection.** `detect()` reads the first 256 KB and three more 256 KB windows spread through the file (file `slice`
only), sniffs the container from the first bytes, and fingerprints with substring checks for known attribute keys.
`detectPrecise()` additionally `JSON.parse`s one line at each of 4 positions and collects real attribute keys.

## Results

### 1. Parse (browser, Chromium, median of 3)

| file | thread | strategy | total ms | first spans ms | max frame gap ms | peak extra RSS MB | main JS heap after MB |
|---|---|---|---|---|---|---|---|
| 1k (2.1MB) | main | whole | 5.8 | 5.7 | 17.7 | 11 | 5 |
| 1k (2.1MB) | main | lines | 5.2 | 1.3 | 17.7 | 12 | 10 |
| 1k (2.1MB) | main | scan | 7.0 | 1.9 | 17.7 | 16 | 6 |
| 1k (2.1MB) | worker | whole | 33.2 | 33.1 | 17.7 | 11 | 2 |
| 1k (2.1MB) | worker | lines | 32.6 | 28.9 | 17.7 | 11 | 2 |
| 1k (2.1MB) | worker | scan | 31.5 | 26.3 | 17.7 | 15 | 2 |
| 1k (5.3MB) | main | whole | 10.2 | 10.1 | 17.7 | 17 | 9 |
| 1k (5.3MB) | main | lines | 9.3 | 2.8 | 17.7 | 25 | 22 |
| 1k (5.3MB) | main | scan | 9.9 | 2.5 | 17.7 | 20 | 9 |
| 1k (5.3MB) | worker | whole | 35.7 | 35.6 | 17.7 | 16 | 2 |
| 1k (5.3MB) | worker | lines | 33.1 | 27.3 | 17.7 | 14 | 2 |
| 1k (5.3MB) | worker | scan | 33.3 | 26.8 | 17.7 | 19 | 2 |
| 10k (23MB) | main | whole | 37.9 | 37.5 | 17.7 | 68 | 53 |
| 10k (23MB) | main | lines | 35.4 | 1.4 | 17.7 | 87 | 68 |
| 10k (23MB) | main | scan | 41.5 | 1.9 | 35.4 | 50 | 39 |
| 10k (23MB) | worker | whole | 64.6 | 61.9 | 17.7 | 70 | 2 |
| 10k (23MB) | worker | lines | 65.1 | 28.8 | 17.7 | 54 | 2 |
| 10k (23MB) | worker | scan | 66.6 | 29.7 | 17.7 | 19 | 2 |
| 100k (241MB) | main | whole | 393.3 | 390.6 | 314.8 | 585 | 525 |
| 100k (241MB) | main | lines | 296.4 | 1.5 | 279.6 | 241 | 133 |
| 100k (241MB) | main | scan | 372.1 | 1.9 | 366.9 | 86 | 54 |
| 100k (241MB) | worker | whole | 425.2 | 370.6 | 17.7 | 573 | 6 |
| 100k (241MB) | worker | lines | 328.1 | 27.7 | 17.7 | 193 | 6 |
| 100k (241MB) | worker | scan | 427.2 | 27.7 | 17.7 | 75 | 6 |

Reading the table: "first spans" is when the first chunk is available to the UI. `whole` cannot show anything before
the whole document is parsed. Worker rows pay about 25-30 ms of worker start-up and structured-clone of the `File`, which
dominates for small inputs. "main JS heap after" is the retained JS heap on the page's main thread afterwards (the worker
case keeps the arrays in the receiving side only as transferred buffers, here dropped).

### 1b. Parse under Node (same code, one process per run, peak RSS from `resourceUsage`)

| file | strategy | keep text | total ms | first chunk ms | JSON.parse ms | retained heap MB | peak RSS MB |
|---|---|---|---|---|---|---|---|
| trace-1000-5mb.json | whole | no | 11.3 | 10.2 | 5.5 | 0.2 | 77 |
| trace-1000-5mb.jsonl | lines | no | 21.8 | 6.3 | - | 0.5 | 66 |
| trace-1000-5mb.jsonl | scan | no | 17.2 | 5.8 | - | 0.7 | 69 |
| trace-10000.json | whole | no | 51.8 | 49.2 | 38.2 | 1.0 | 167 |
| trace-10000.jsonl | lines | no | 58.7 | 2.8 | - | 1.3 | 78 |
| trace-10000.jsonl | scan | no | 56.2 | 3.5 | - | 2.5 | 81 |
| trace-100000.json | whole | no | 474.6 | 434.9 | 350.8 | 6.5 | 1144 |
| trace-100000.jsonl | lines | no | 533.7 | 2.9 | - | 6.5 | 162 |
| trace-100000.jsonl | scan | no | 569.9 | 3.5 | - | 18.9 | 246 |
| trace-100000.jsonl | scan | yes | 594.3 | 3.5 | - | 161.2 | 436 |
| trace-100000.jsonl | lines | yes | 573.6 | 2.8 | - | 148.1 | 377 |
| trace-100000.json | whole | yes | 495.5 | 451.8 | 358.2 | 147.1 | 1154 |

"keep text = yes" retains every attribute string longer than 200 characters (what an inspector would need without
re-reading the file): +140 MB heap for the 241 MB file. The lazy alternative is to store the source line number per span
(already in the model) and re-parse the one line on demand.

### 2. Timeline strip / waterfall

All timings are draw + GPU completion per frame, milliseconds. "full-extent" is the frames where every span is eligible
(the worst case); "rects/frame" is rectangles actually drawn in those frames, which shows what LOD merging saves.

**gpu cpu x1**

| spans | renderer | LOD | draw+GPU p50 ms | p95 | full-extent p50 / p95 | rects/frame (full) | setup ms | lane prep ms |
|---|---|---|---|---|---|---|---|---|
| 10000 | canvas2d | none | 0.66 | 2.10 | 2.01 / 2.17 | 9987 | 13.1 | 14.2 |
| 10000 | canvas2d | merge | 0.70 | 2.16 | 2.10 / 2.24 | 9581 | 7.4 | 4.5 |
| 10000 | webgl2 | none | 0.66 | 1.05 | 0.66 / 1.00 | 10003 | 25.6 | 4.2 |
| 10000 | webgl2 | merge | 0.68 | 1.02 | 0.69 / 1.18 | 9581 | 8.1 | 4.7 |
| 100000 | canvas2d | none | 3.51 | 17.79 | 17.55 / 18.18 | 99757 | 35.1 | 19.1 |
| 100000 | canvas2d | merge | 3.33 | 7.57 | 5.64 / 5.85 | 26837 | 14.4 | 19.1 |
| 100000 | webgl2 | none | 0.44 | 0.51 | 0.49 / 0.54 | 100000 | 8.0 | 18.9 |
| 100000 | webgl2 | merge | 0.48 | 0.92 | 0.80 / 1.14 | 26837 | 9.1 | 19.3 |

**gpu cpu x4**

| spans | renderer | LOD | draw+GPU p50 ms | p95 | full-extent p50 / p95 | rects/frame (full) | setup ms | lane prep ms |
|---|---|---|---|---|---|---|---|---|
| 10000 | canvas2d | none | 2.81 | 9.13 | 8.87 / 9.39 | 9987 | 14.6 | 16.0 |
| 10000 | canvas2d | merge | 2.77 | 8.81 | 8.47 / 9.15 | 9581 | 13.3 | 14.9 |
| 10000 | webgl2 | none | 0.91 | 1.38 | 0.93 / 1.39 | 10003 | 19.0 | 15.4 |
| 10000 | webgl2 | merge | 0.92 | 1.41 | 0.89 / 1.41 | 9581 | 17.8 | 15.0 |
| 100000 | canvas2d | none | 14.51 | 74.75 | 74.03 / 75.48 | 99757 | 67.4 | 68.5 |
| 100000 | canvas2d | merge | 14.44 | 31.79 | 23.85 / 25.19 | 26837 | 33.7 | 69.9 |
| 100000 | webgl2 | none | 1.26 | 1.95 | 1.32 / 2.87 | 100000 | 22.9 | 70.1 |
| 100000 | webgl2 | merge | 1.38 | 3.51 | 2.82 / 3.72 | 26837 | 25.7 | 70.3 |

**sw cpu x1**

| spans | renderer | LOD | draw+GPU p50 ms | p95 | full-extent p50 / p95 | rects/frame (full) | setup ms | lane prep ms |
|---|---|---|---|---|---|---|---|---|
| 10000 | canvas2d | none | 0.65 | 2.02 | 1.97 / 2.09 | 9987 | 7.4 | 4.5 |
| 10000 | canvas2d | merge | 0.62 | 1.99 | 1.92 / 2.08 | 9581 | 6.1 | 6.4 |
| 10000 | webgl2 | none | 102.45 | 151.19 | 149.83 / 152.60 | 10003 | 209.6 | 4.2 |
| 10000 | webgl2 | merge | 26.99 | 145.57 | 144.50 / 146.91 | 9581 | 163.7 | 4.5 |
| 100000 | canvas2d | none | 3.42 | 17.69 | 17.28 / 18.31 | 99757 | 22.9 | 19.0 |
| 100000 | canvas2d | merge | 3.25 | 7.34 | 5.50 / 5.78 | 26837 | 11.2 | 18.7 |
| 100000 | webgl2 | none | 929.80 | 1487.40 | 1464.38 / 1501.49 | 100000 | 1518.0 | 18.8 |
| 100000 | webgl2 | merge | 266.05 | 625.37 | 445.22 / 469.00 | 26837 | 499.2 | 29.2 |

### 3. Graph canvas

Layout (Web Worker, median of 5): 1k nodes / 1,107 edges: tidy tree 0.3 ms, layered DAG 1.4 ms (3.5 ms round trip
including copying the model in). 10k nodes / 11,191 edges: tidy tree 1.2 ms, layered DAG 9.1 ms (11.3 ms round trip), 11
layers. Layout is not a bottleneck.

**gpu cpu x1**

| nodes | edges | renderer | labels | LOD | draw+GPU p50 ms | p95 | fit-all p50 | zoom-in p50 | pan p50 | setup ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | 1107 | canvas2d | yes | edge-skip | 0.74 | 1.27 | 1.22 | 0.62 | 0.62 | 10.4 |
| 1000 | 1107 | canvas2d | no | edge-skip | 0.72 | 1.32 | 1.25 | 0.65 | 0.58 | 3.3 |
| 1000 | 1107 | canvas2d | no | none | 0.71 | 1.36 | 1.30 | 0.59 | 0.56 | 3.3 |
| 1000 | 1107 | webgl2 | no | GPU | 0.35 | 0.38 | 0.37 | 0.35 | 0.35 | 10.5 |
| 1000 | 1107 | webgl2 | yes | GPU | 0.75 | 1.05 | 0.66 | 0.70 | 0.77 | 7.4 |
| 10000 | 11191 | canvas2d | yes | edge-skip | 1.05 | 2.79 | 2.75 | 0.85 | 0.93 | 9.9 |
| 10000 | 11191 | canvas2d | no | edge-skip | 1.01 | 2.89 | 2.80 | 0.75 | 0.92 | 8.3 |
| 10000 | 11191 | canvas2d | no | none | 1.06 | 15.60 | 14.49 | 0.81 | 0.95 | 11.0 |
| 10000 | 11191 | webgl2 | no | GPU | 0.38 | 0.42 | 0.41 | 0.38 | 0.38 | 10.5 |
| 10000 | 11191 | webgl2 | yes | GPU | 0.73 | 0.84 | 0.73 | 0.72 | 0.75 | 9.1 |

**gpu cpu x4**

| nodes | edges | renderer | labels | LOD | draw+GPU p50 ms | p95 | fit-all p50 | zoom-in p50 | pan p50 | setup ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | 1107 | canvas2d | yes | edge-skip | 3.06 | 5.62 | 5.30 | 2.76 | 2.57 | 12.3 |
| 1000 | 1107 | canvas2d | no | edge-skip | 3.04 | 5.47 | 5.17 | 2.64 | 2.60 | 6.7 |
| 1000 | 1107 | canvas2d | no | none | 3.08 | 5.99 | 5.56 | 2.77 | 2.69 | 8.7 |
| 1000 | 1107 | webgl2 | no | GPU | 0.90 | 1.28 | 0.92 | 0.88 | 0.95 | 17.9 |
| 1000 | 1107 | webgl2 | yes | GPU | 2.17 | 2.78 | 2.11 | 2.13 | 2.28 | 16.4 |
| 10000 | 11191 | canvas2d | yes | edge-skip | 4.31 | 11.96 | 11.46 | 3.55 | 3.86 | 20.4 |
| 10000 | 11191 | canvas2d | no | edge-skip | 4.51 | 11.99 | 11.33 | 3.51 | 3.97 | 19.7 |
| 10000 | 11191 | canvas2d | no | none | 4.35 | 62.13 | 59.95 | 3.39 | 4.01 | 26.2 |
| 10000 | 11191 | webgl2 | no | GPU | 0.88 | 1.31 | 0.94 | 0.86 | 0.91 | 22.2 |
| 10000 | 11191 | webgl2 | yes | GPU | 2.18 | 2.77 | 2.26 | 2.15 | 2.25 | 25.1 |

**sw cpu x1**

| nodes | edges | renderer | labels | LOD | draw+GPU p50 ms | p95 | fit-all p50 | zoom-in p50 | pan p50 | setup ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | 1107 | canvas2d | yes | edge-skip | 0.74 | 1.30 | 1.23 | 0.66 | 0.61 | 4.7 |
| 1000 | 1107 | canvas2d | no | edge-skip | 0.74 | 1.31 | 1.24 | 0.62 | 0.59 | 4.5 |
| 1000 | 1107 | canvas2d | no | none | 0.75 | 1.44 | 1.37 | 0.62 | 0.58 | 4.6 |
| 1000 | 1107 | webgl2 | no | GPU | 19.60 | 34.43 | 33.66 | 19.75 | 17.37 | 101.1 |
| 1000 | 1107 | webgl2 | yes | GPU | 20.31 | 34.37 | 33.86 | 20.20 | 18.32 | 80.3 |
| 10000 | 11191 | canvas2d | yes | edge-skip | 1.09 | 2.88 | 2.79 | 0.88 | 0.99 | 7.5 |
| 10000 | 11191 | canvas2d | no | edge-skip | 1.07 | 2.91 | 2.79 | 0.81 | 0.97 | 7.3 |
| 10000 | 11191 | canvas2d | no | none | 1.07 | 14.45 | 14.26 | 0.79 | 0.95 | 19.6 |
| 10000 | 11191 | webgl2 | no | GPU | 132.96 | 313.49 | 309.11 | 131.71 | 114.04 | 360.9 |
| 10000 | 11191 | webgl2 | yes | GPU | 138.85 | 316.38 | 313.23 | 130.80 | 115.93 | 346.7 |

### 4. UI shell

| app | JS raw KB | JS gzip KB | JS brotli KB | cold TTI ms (x1) | x4 CPU | x4 CPU + 4G | FCP x1 |
|---|---|---|---|---|---|---|---|
| vanilla | 3.0 | 1.61 | 1.32 | 34.7 | 61.0 | 405.7 | 39.8 |
| preact | 15.3 | 6.63 | 6.00 | 31.2 | 48.6 | 399.2 | 40.5 |
| solid | 12.3 | 5.37 | 4.84 | 31.1 | 48.7 | 398.1 | 40.2 |
| app | cpu | select->DOM p50/p95 ms | select->paint p50/p95 | scroll re-render p50/p95 | scroll->paint p50/p95 |
|---|---|---|---|---|---|
| vanilla | x1 | 1.13 / 1.61 | 2.88 / 4.21 | 0.34 / 0.51 | 2.47 / 3.31 |
| vanilla | x4 | 0.99 / 1.82 | 3.2 / 4.81 | 0.18 / 0.75 | 3.49 / 5.39 |
| preact | x1 | 0.34 / 0.5 | 1.68 / 2.13 | 0.6 / 0.91 | 2.42 / 3.37 |
| preact | x4 | 0.13 / 0.84 | 1.32 / 2.88 | 0.77 / 1.3 | 3.63 / 5.56 |
| solid | x1 | 0.37 / 0.56 | 1.84 / 2.45 | 0.52 / 0.79 | 2.44 / 3.19 |
| solid | x4 | 0.11 / 0.46 | 1.32 / 3.18 | 0.55 / 1.42 | 3.42 / 5.46 |

The shell is too small to separate the frameworks: every number is under 1 ms or within noise (the vanilla "select"
number is high only because my vanilla version rebuilds the inspector with `innerHTML`).

### 5. Format detection

Browser (File slices), median of 5 repeats:

| file | size MB | sniff median ms | sniff max ms | precise median ms | result |
|---|---|---|---|---|---|
| 1k (2.1MB) | 2.1 | 0.80 | 3.00 | 0.90 | otlp-json/mixed |
| 1k (5.3MB) | 5.3 | 1.50 | 5.50 | 1.90 | otlp-json/mixed |
| 10k (23MB) | 23.2 | 1.20 | 3.60 | 2.90 | otlp-json/mixed |
| 100k (241MB) | 241.4 | 1.30 | 4.10 | 2.70 | otlp-json/mixed |

Node:

| file | size MB | sniff median ms | precise median ms |
|---|---|---|---|
| trace-1000-5mb.jsonl | 5.3 | 0.79 | 1.37 |
| trace-10000.jsonl | 23.2 | 0.62 | 1.67 |
| trace-100000.jsonl | 241.4 | 0.65 | 1.76 |

### Bundle sizes (minified + gzip, each piece bundled alone with tree-shaking, spike code)

| piece | min KB | gzip KB | brotli KB |
|---|---|---|---|
| timeline: Canvas 2D renderer (cull+LOD+draw) | 1.86 | 1.01 | 0.91 |
| timeline: WebGL2 renderer (cull+LOD+draw+shaders) | 4.41 | 2.11 | 1.92 |
| timeline: lane layout | 1.52 | 0.77 | 0.72 |
| graph: Canvas 2D renderer | 1.98 | 1.11 | 1 |
| graph: WebGL2 renderer (+label overlay) | 4.7 | 2.11 | 1.89 |
| graph: tidy-tree layout | 1.09 | 0.57 | 0.54 |
| graph: layered DAG layout (+tidy) | 2.54 | 1.14 | 1.07 |
| parse: byte scanner + SoA model | 6.38 | 2.52 | 2.3 |
| parse: JSON.parse lines + SoA model | 6.33 | 2.5 | 2.28 |
| detect (sniff + fingerprint) | 2 | 0.98 | 0.9 |

The Canvas 2D renderers are about 1.0-1.1 KB gzip each (timeline, graph); WebGL2 versions about 2.1 KB. The parse/detect
pieces are about 2.5 KB and 1 KB. Real code will be larger; these are floors for the techniques, not budgets.

## Findings worth keeping

1. **LOD is non-negotiable for Canvas 2D at 100k.** Merging sub-pixel runs cut rectangles from 99,757 to 26,837 per
   fully zoomed-out frame and frame time from 17.6 to 5.6 ms (x1) and from 74 to 24 ms (x4 CPU). Skipping sub-pixel
   edges cut the 10k-node graph's zoomed-out frame from 14.5 to 2.8 ms (x1) and from 60 to 11.5 ms (x4). Without LOD
   the 4x-throttled device misses 60 fps.
2. **WebGL is faster but fragile.** On a real GPU it is flat at about 0.4-1.4 ms p50 (3.5 ms worst p95: 100k spans at 4x CPU) regardless of count, and nothing needs
   culling. Without a GPU (SwiftShader) it takes 100-1500 ms per frame unless the CPU does LOD first (still 27-445 ms),
   and context + shader setup costs 100-1500 ms. Canvas 2D is the same speed in both modes. Software-GL environments are
   common (VMs, remote desktops, blocklisted drivers, some CI), so WebGL needs a capability probe
   (`failIfMajorPerformanceCaveat: true`, or check the renderer string) and a Canvas 2D fallback anyway. That makes
   Canvas 2D the thing to build first. On a real GPU, setup cost (context, shaders, buffer upload, first frame) was similar: WebGL 7-28 ms vs Canvas 2D
   3-35 ms. So this spike does **not** reproduce the "WebGL is slower to start" claim in `docs/architecture.md` on
   a real GPU; the startup penalty only appears without one (SwiftShader: 80-1500 ms).
3. **Worker parse has a fixed cost of about 30 ms and buys freedom from jank.** On 241 MB the main thread froze 280-370
   ms in every main-thread strategy, including streaming (chunks resolve too fast to yield). In the worker the UI never
   dropped a frame and the first spans arrived at 27 ms. Chunked transfer of typed arrays is cheap.
4. **Streaming lines beats one big `JSON.parse` on memory and latency, not on throughput.** 100k spans: whole document
   393 ms and 585 MB peak extra RSS; lines 296 ms and 241 MB; byte scanner 372 ms and 86 MB. The scanner's one advantage
   is memory/GC (it never creates the 2 KB payload strings). It is 300 lines of fragile code; not worth it until memory
   is a measured problem.
5. **Layout quality caveat.** The "layered DAG" here is Sugiyama-lite (longest-path layering, barycentre ordering,
   greedy coordinates). Its x-assignment produced very long edges on wide forests, so rendering used tidy-tree
   positions. A proper coordinate assignment (Brandes-Koepf) and crossing minimisation will cost several times more than
   the 9 ms measured, probably tens of ms at 10k, still comfortably off the main thread.
6. **Detection is free** at about 1 ms because it reads about 1 MB however large the file. The substring fingerprint is
   faster than the precise one by about 1 ms and enough to pick a parser; use the precise pass to confirm.

## Caveats

- One machine (M5 Pro, a very fast chip). The 4x throttle is a main-thread-only approximation of a mid-range device,
  it does not slow workers, GPU, or memory bandwidth. Worker parse times on a mid-range device are extrapolated
  (about 4x), not measured.
- Synthetic traces from 3 fixture templates. Real traces have more attribute variety, escaped JSON-in-JSON payloads,
  and different batch sizes; the 64-span lines here are about 150-330 KB. Pathological single-line multi-hundred-MB
  documents were not tested; whole-document `JSON.parse` of the 241 MB file worked (585 MB peak) but V8 string limits
  and memory will bite somewhere above about 500 MB, where a streaming splitter is required.
- Frame time is draw + forced readback, not end-to-end compositor latency or input-to-photon time. Readback adds a
  floor (about 0.2 ms 2D, about 1 ms GL). Real apps also draw text, hit-testing, selection overlays and hover.
- Graph WebGL path draws straight edges, no rounded-corner SDF and no text (labels use a 2D overlay canvas, measured).
  The Canvas 2D path draws bezier edges and rounded rects. Hit-testing was not built for either; at 10k nodes a grid
  index in the worker is the expected approach.
- Canvas 2D was identical in the "gpu" and "sw" modes, which suggests headless Chromium CPU-rasterised it in both. If the
  desktop browser uses GPU-accelerated 2D canvas, Canvas 2D may be faster or slower than reported. Re-check in headed
  Chrome/Safari/Firefox before locking in. Only Chromium was measured; Safari and Firefox have different canvas and
  WebGL costs (Safari in particular).
- Memory is whole-process RSS deltas sampled every 40 ms; it includes GC slack and the browser's file read buffers.
- The UI shell is tiny: it cannot show how Solid and Preact diverge on large component trees. Bundle size difference
  (1.2 KB gzip) will change with real app code (Solid compiled output grows per component; Preact's runtime is
  constant).
- Search (< 50 ms budget) and CLI/desktop start-up budgets were out of scope and are not measured.
