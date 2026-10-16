// THROWAWAY spike. Layout in a worker; model arrays are copied in, positions transferred back.
import { buildEdges, tidyTree, layeredDag } from './graph-layout.js'
self.onmessage = (e) => {
  const { algo, model } = e.data
  const t0 = performance.now()
  const E = buildEdges(model, { seq: algo === 'dag' })
  const t1 = performance.now()
  const r = algo === 'dag' ? layeredDag(model, E) : tidyTree(model)
  const t2 = performance.now()
  self.postMessage({ x: r.x, y: r.y, src: E.src, dst: E.dst, layers: r.layers, edgesMs: t1 - t0, layoutMs: t2 - t1, totalMs: t2 - t0, edges: E.src.length }, [r.x.buffer, r.y.buffer, E.src.buffer, E.dst.buffer])
}
