// THROWAWAY spike. Worker: parse a File with the chosen variant, transfer typed-array chunks to the main thread.
import { Ingest, DRIVERS } from './parse.js'
self.onmessage = async (e) => {
  const { file, variant, keepText } = e.data
  const t = {}
  const ing = new Ingest((c, base, names, first) => {
    const { n, start, dur, parent, name, tokens, kind, err, batch } = c
    self.postMessage({ type: 'chunk', n, base, names, first, start, dur, parent, name, tokens, kind, err, batch }, c.buffers())
  }, { keepText })
  await DRIVERS[variant](file, ing, t)
  const patch = ing.finish()
  self.postMessage({ type: 'done', total: ing.total, sum: ing.sum, patch, textCount: ing.text.length }, [patch.buffer])
}
