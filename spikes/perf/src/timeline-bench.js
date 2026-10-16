// THROWAWAY spike. Bench entry (page glue).
import { PAL, css, BG, loadModel, stats, nextFrame, glInfo, compile } from './common.js'
import { layoutLanes, canvas2d, webgl2, viewAt, PHASES } from './timeline.js'
const cache = {}
window.runTimeline = async ({ n, renderer, lod, frames = 300, dpr = window.devicePixelRatio, W = 1400, H = 600 }) => {
  cache[n] ??= {}
  const tModel = performance.now()
  const m = cache[n].m ??= await loadModel(n)
  const tp = performance.now()
  const L = cache[n].L ??= layoutLanes(m)
  const prepMs = performance.now() - tp
  document.body.innerHTML = '<div id=h></div>'
  const host = document.getElementById('h')
  await nextFrame()
  const t0 = performance.now()
  const r = renderer === 'canvas2d' ? canvas2d(host, L, W, H, dpr) : webgl2(host, L, W, H, dpr)
  const v0 = viewAt(0, frames, L.maxT, L.lanes)
  r.draw(v0, lod)
  r.sync()
  await nextFrame()
  const setupMs = performance.now() - t0
  // baseline: cost of the forced sync on a frame that draws (almost) nothing
  const idle = []
  for (let i = 0; i < 30; i++) { const a = performance.now(); r.draw({ t0: L.maxT * 2, t1: L.maxT * 3, lane0: 0 }, lod); r.sync(); idle.push(performance.now() - a); await nextFrame() }
  const js = [], frame = [], rects = [], work = [], ph = []
  let last = performance.now()
  for (let i = 0; i < frames; i++) {
    const v = viewAt(i, frames, L.maxT, L.lanes)
    const a = performance.now()
    rects.push(r.draw(v, lod))
    js.push(performance.now() - a)
    r.sync(); work.push(performance.now() - a); ph.push(v.phase)
    await nextFrame()
    const now = performance.now(); frame.push(now - last); last = now
  }
  return { n, renderer, lod, dpr, lanes: L.lanes, prepMs: +prepMs.toFixed(1), setupMs: +setupMs.toFixed(1), jsMs: stats(js), drawSyncMs: stats(work), perPhase: Object.fromEntries(PHASES.map((p, k) => [p, { drawSync: stats(work.filter((_, j) => ph[j] === k)), rects: Math.round(rects.filter((_, j) => ph[j] === k).reduce((a, b) => a + b, 0) / Math.max(1, ph.filter((x) => x === k).length)) }])), idleSyncMs: stats(idle), frameMs: stats(frame.slice(1)), rectsPerFrame: Math.round(rects.reduce((a, b) => a + b, 0) / rects.length), gpu: r.gl ? glInfo(r.gl) : null }
}
