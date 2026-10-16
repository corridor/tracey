// THROWAWAY spike. Browser parse bench: main thread vs worker, variants whole/lines/scan.
import { Ingest, DRIVERS } from './parse.js'
import { detect, detectPrecise } from './detect.js'

function ticker() { // longest gap between animation frames = how long the main thread was blocked
  let last = performance.now(), max = 0, stop = false, frames = 0
  const f = (t) => { max = Math.max(max, t - last); last = t; frames++; if (!stop) requestAnimationFrame(f) }
  requestAnimationFrame(f)
  return () => { stop = true; return { maxFrameGapMs: +max.toFixed(1), frames } }
}
const file = () => document.getElementById('f').files[0]

window.runParse = async (mode, variant, keepText = false) => {
  const f = file()
  const stop = ticker()
  await new Promise((r) => setTimeout(r, 50))
  const t0 = performance.now(); const t = {}
  let first, total, sum, chunks = 0
  if (mode === 'main') {
    const ing = new Ingest(() => { chunks++; if (first === undefined) first = performance.now() }, { keepText })
    await DRIVERS[variant](f, ing, t)
    ing.finish(); total = ing.total; sum = ing.sum
    if (variant === 'whole') first = t.build // nothing is visible before the whole doc is parsed
    if (variant === 'lines' || variant === 'scan') first = first ?? t.first
  } else {
    const w = new Worker('./parse-worker.js', { type: 'module' })
    await new Promise((res) => {
      w.onmessage = (e) => {
        const m = e.data
        if (m.type === 'chunk') { chunks++; if (first === undefined) first = performance.now() }
        else { total = m.total; sum = m.sum; res() }
      }
      w.postMessage({ file: f, variant, keepText })
    })
    w.terminate()
  }
  const t1 = performance.now()
  await new Promise((r) => requestAnimationFrame(() => r())) // let the next frame fire so a blocked main thread shows up as a gap
  await new Promise((r) => requestAnimationFrame(() => r()))
  const gap = stop()
  const mem = performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null
  return { mode, variant, keepText, spans: total, totalMs: +(t1 - t0).toFixed(1), firstSpansMs: +(first - t0).toFixed(1), chunks, heapAfterMB: mem && +mem.toFixed(1), sum, ...gap, jsonParseMs: t.jsonParse ? +(t.jsonParse - t.read).toFixed(1) : undefined, readMs: t.read ? +(t.read - t0).toFixed(1) : undefined }
}
window.runDetect = async () => {
  const f = file()
  const r = []
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); const d = await detect(f); r.push({ ms: performance.now() - t0, d }) }
  r.sort((a, b) => a.ms - b.ms)
  const q = []
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); await detectPrecise(f); q.push(performance.now() - t0) }
  q.sort((a, b) => a - b)
  return { preciseMedianMs: +q[2].toFixed(2), size: f.size, medianMs: +r[2].ms.toFixed(2), minMs: +r[0].ms.toFixed(2), maxMs: +r[4].ms.toFixed(2), result: r[2].d }
}
