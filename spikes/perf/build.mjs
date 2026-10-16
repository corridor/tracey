// THROWAWAY spike. Bundles bench pages + workers into dist/ and reports gzip sizes of the individual pieces.
import esbuild from 'esbuild'
import fs from 'node:fs'
import zlib from 'node:zlib'
fs.mkdirSync('dist', { recursive: true })
await esbuild.build({ entryPoints: ['src/parse-bench.js', 'src/parse-worker.js', 'src/timeline-bench.js', 'src/graph-bench.js', 'src/layout-worker.js'], bundle: true, format: 'esm', outdir: 'dist', target: 'es2022', sourcemap: false })
for (const p of ['parse', 'timeline', 'graph']) fs.writeFileSync(`dist/${p}.html`, `<!doctype html><meta charset=utf-8><body style="margin:0;background:#0d1219"><input type=file id=f><script type=module src=./${p}-bench.js></script>`)
// piece sizes (minified, tree-shaken) ----------------------------------------------------------
const pieces = {
  'timeline: Canvas 2D renderer (cull+LOD+draw)': `export { canvas2d } from './src/timeline.js'`,
  'timeline: WebGL2 renderer (cull+LOD+draw+shaders)': `export { webgl2 } from './src/timeline.js'`,
  'timeline: lane layout': `export { layoutLanes } from './src/timeline.js'`,
  'graph: Canvas 2D renderer': `export { c2d } from './src/graph.js'`,
  'graph: WebGL2 renderer (+label overlay)': `export { gl2 } from './src/graph.js'`,
  'graph: tidy-tree layout': `export { tidyTree, buildEdges } from './src/graph-layout.js'`,
  'graph: layered DAG layout (+tidy)': `export { layeredDag, tidyTree, buildEdges } from './src/graph-layout.js'`,
  'parse: byte scanner + SoA model': `export { Ingest, runScan } from './src/parse.js'`,
  'parse: JSON.parse lines + SoA model': `export { Ingest, runLines } from './src/parse.js'`,
  'detect (sniff + fingerprint)': `export { detect, detectPrecise } from './src/detect.js'`,
}
const out = {}
for (const [k, v] of Object.entries(pieces)) {
  const r = await esbuild.build({ stdin: { contents: v, resolveDir: '.', loader: 'js' }, bundle: true, minify: true, format: 'esm', write: false, treeShaking: true, target: 'es2022' })
  const b = r.outputFiles[0].contents
  out[k] = { minKB: +(b.length / 1024).toFixed(2), gzipKB: +(zlib.gzipSync(b, { level: 9 }).length / 1024).toFixed(2), brotliKB: +(zlib.brotliCompressSync(b).length / 1024).toFixed(2) }
}
fs.writeFileSync('results/sizes.json', JSON.stringify(out, null, 1))
console.table(out)
