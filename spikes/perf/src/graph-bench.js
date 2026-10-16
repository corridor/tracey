// THROWAWAY spike. Bench entry (page glue).
import { PAL, css, BG, loadModel, stats, nextFrame, glInfo, compile } from './common.js'
import { NW, NH } from './graph-layout.js'
import { c2d, gl2, view, runLayout, sub, KN, PHASES } from './graph.js'
const cache = {}
window.runGraph = async ({ n, mode, labels = true, lod = true, frames = 300, dpr = window.devicePixelRatio, W = 1400, H = 700 }) => {
  const key = n
  if (!cache[key]) {
    const full = await loadModel(n === 1000 ? 1000 : 10000)
    const m = sub(full, n)
    // layout timings: 5 runs after a warm-up, median
    const runs = { tidy: [], dag: [] }, last = {}
    for (const algo of ['tidy', 'dag']) for (let k = 0; k < 6; k++) { const r = await runLayout(m, algo); if (k) runs[algo].push(r); last[algo] = r }
    const med = (a, f) => { const s = a.map(f).sort((x, y) => x - y); return +s[s.length >> 1].toFixed(1) }
    const layoutStats = Object.fromEntries(['tidy', 'dag'].map((a) => [a, { workerMs: med(runs[a], (r) => r.totalMs), roundTripMs: med(runs[a], (r) => r.roundTripMs), edges: last[a].edges, layers: last[a].layers }]))
    const r = { x: last.tidy.x, y: last.tidy.y, src: last.dag.src, dst: last.dag.dst } // tidy-tree positions, tree + sequence edges (the crude DAG x-assignment gave very long edges)
    const c = new Uint8Array(n); for (let i = 0; i < n; i++) c[i] = m.err[i] ? 5 : m.kind[i]
    const label = new Array(n); for (let i = 0; i < n; i++) label[i] = `${KN[m.kind[i]]} #${i}`
    let bx = 0, by = 0; for (let i = 0; i < n; i++) { bx = Math.max(bx, r.x[i] + NW); by = Math.max(by, r.y[i] + NH) }
    cache[key] = { G: { N: n, E: r.src.length, x: r.x, y: r.y, src: r.src, dst: r.dst, c, label }, bounds: { w: bx, h: by }, layoutStats }
  }
  const { G, bounds, layoutStats } = cache[key]
  document.body.innerHTML = '<div id=h></div>'
  const host = document.getElementById('h')
  await nextFrame()
  const t0 = performance.now()
  const r = mode === 'canvas2d' ? c2d(host, G, W, H, dpr, labels, lod) : gl2(host, G, W, H, dpr, labels)
  r.draw(view(0, frames, W, H, bounds)); r.sync()
  await nextFrame()
  const setupMs = performance.now() - t0
  const idle = []
  for (let i = 0; i < 30; i++) { const a = performance.now(); r.draw({ z: 1, cx: -1e6, cy: -1e6 }); r.sync(); idle.push(performance.now() - a); await nextFrame() }
  const js = [], fr = [], work = [], sy = [], ph = []
  let last = performance.now()
  for (let i = 0; i < frames; i++) {
    const v = view(i, frames, W, H, bounds)
    const a = performance.now(); work.push(r.draw(v)); js.push(performance.now() - a); r.sync(); sy.push(performance.now() - a); ph.push(v.phase)
    await nextFrame(); const now = performance.now(); fr.push(now - last); last = now
  }
  return { n, mode, labels, lod, dpr, nodes: G.N, edges: G.E, bounds, layoutStats, setupMs: +setupMs.toFixed(1), jsMs: stats(js), drawSyncMs: stats(sy), perPhase: Object.fromEntries(PHASES.map((p, k) => [p, stats(sy.filter((_, j) => ph[j] === k))])), idleSyncMs: stats(idle), frameMs: stats(fr.slice(1)), primitivesPerFrame: Math.round(work.reduce((a, b) => a + b, 0) / work.length), gpu: r.gl ? glInfo(r.gl) : null }
}
