// THROWAWAY spike. Node-side parse bench; one variant per process for clean peak RSS.
// usage: node --expose-gc node-parse.mjs <variant whole|lines|scan> <file> [keepText]
import fs from 'node:fs'
import { Ingest, DRIVERS } from './src/parse.js'
const [variant, file, keep] = process.argv.slice(2)
const blob = await fs.openAsBlob(file) // file-backed Blob, same API as a browser File
const size = blob.size
const keepText = keep === 'keep'
let peak = 0
const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 20)
global.gc(); const base = process.memoryUsage()
const t = {}; const t0 = performance.now()
let chunks = 0
const ing = new Ingest(() => { chunks++; if (t.firstChunk === undefined) t.firstChunk = performance.now() }, { keepText })
await DRIVERS[variant](blob, ing, t)
ing.finish()
const t1 = performance.now()
clearInterval(iv)
global.gc(); const after = process.memoryUsage()
const ru = process.resourceUsage()
console.log(JSON.stringify({ variant, file: file.split('/').pop(), keepText, spans: ing.total, ms: +(t1 - t0).toFixed(1), firstChunkMs: +(t.firstChunk - t0).toFixed(1), jsonParseMs: t.jsonParse ? +(t.jsonParse - t.read).toFixed(1) : undefined, buildMs: t.build ? +(t.build - t.jsonParse).toFixed(1) : undefined,
  retainedHeapMB: +((after.heapUsed - base.heapUsed) / 1e6).toFixed(1), peakRssMB: +(ru.maxRSS / 1e3).toFixed(0), sum: ing.sum, fileMB: +(size / 1e6).toFixed(1) }))
