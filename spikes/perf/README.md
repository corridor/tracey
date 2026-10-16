# tracey performance spike (roadmap 1.4)

> **THROWAWAY.** This directory is a disposable measurement spike, not production code and not
> part of the pnpm monorepo. Nothing here is imported by any package. Its only product is the
> numbers and recommendations in `docs/verification/perf-spike.md`. Delete it once the
> decisions are folded into the real packages. It has its own `package.json`,
> `node_modules/` and Playwright Chromium, all git-ignored via the local `.gitignore`.

## Rerun

Needs Node 24 and about 1.3 GB of disk (generated data 520 MB, Chromium 570 MB, deps 75 MB).

```sh
cd spikes/perf
npm run setup            # npm install + Playwright chromium into ./.browsers
node gen.mjs 1000 10000 100000        # data/trace-N.jsonl (collector-file style) + data/trace-N.json (single doc)
SCALE=2.4 TAG=-5mb node gen.mjs 1000  # the 5 MB / 1k-span file from the architecture budget
node model.mjs           # data/model-N.bin: parsed SoA dumps used by the render benches
node build.mjs           # esbuild bundles into dist/ + per-piece gzip sizes (results/sizes.json)
for a in vanilla preact solid; do APP=$a npx vite build -c shell/vite.config.mjs; done
node run.mjs all         # or one of: parse detect timeline graph shell node   (about 15 minutes for all)
node report.mjs          # prints the markdown tables used in the report
```

The generator uses the real files under `fixtures/` (openinference + otel-genai) as templates for
span attribute shapes, then builds agent/llm/tool trees with sub-agents, wide fan-out (20-80
parallel tools), loops (5-20 repeated calls), about 2% errors and long text payloads, exported in
end-time order like a real exporter. Output is deterministic.

## Layout

| Path | What |
|---|---|
| `gen.mjs`, `model.mjs` | synthetic data generator, parsed-model dumper |
| `src/parse.js` | struct-of-arrays model + three ingest strategies (`whole` JSON.parse, `lines` stream + JSON.parse, `scan` byte scanner) |
| `src/parse-worker.js`, `src/parse-bench.js` | worker transfer of typed-array chunks, browser bench page glue |
| `src/detect.js` | format sniff + attribute fingerprint from a sample |
| `src/timeline.js` | lane packing, Canvas 2D and WebGL2 timeline renderers with sub-pixel LOD merging |
| `src/graph-layout.js`, `src/layout-worker.js`, `src/graph.js` | tidy-tree and layered-DAG layout in a worker; Canvas 2D and WebGL2 graph renderers |
| `shell/` | Solid, Preact and vanilla app shells (virtualised 10k list + inspector) |
| `run.mjs` | Playwright orchestrator; writes `results/*.json` |
| `report.mjs` | results to markdown |
| `node-parse.mjs`, `node-detect.mjs` | same parse and detect code under Node (clean peak RSS per process) |

## Notes on method

* Chromium is Playwright's build, launched with `--use-angle=metal` (real Apple GPU, "gpu") or
  default (SwiftShader software GL, "sw"), `--disable-frame-rate-limit --disable-gpu-vsync` and
  `--enable-precise-memory-info`. The bench server sends COOP/COEP headers for 5 us timers.
* Render "frame time" is draw time plus a forced 1x1 pixel readback (so raster and GPU work are
  included). The idle readback cost is reported next to it.
* CPU throttling uses CDP `Emulation.setCPUThrottlingRate` (4x). It throttles the page main
  thread, not Web Workers.
