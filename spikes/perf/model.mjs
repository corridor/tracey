// THROWAWAY spike. Dump parsed SoA model (relative times) so render benches don't depend on parsing.
import fs from 'node:fs'
import { Ingest, DRIVERS } from './src/parse.js'
for (const n of [1000, 10000, 100000]) {
  const blob = await fs.openAsBlob(`data/trace-${n}.jsonl`)
  const cs = []
  const ing = new Ingest((c, base) => cs.push([c, base]))
  await DRIVERS.scan(blob, ing, {})
  const patch = ing.finish()
  const N = ing.total
  const start = new Float64Array(N), dur = new Float64Array(N), parent = new Int32Array(N).fill(-1), kind = new Uint8Array(N), err = new Uint8Array(N)
  for (const [c, base] of cs) { start.set(c.start.subarray(0, c.n), base); dur.set(c.dur.subarray(0, c.n), base); parent.set(c.parent.subarray(0, c.n), base); kind.set(c.kind.subarray(0, c.n), base); err.set(c.err.subarray(0, c.n), base) }
  for (let i = 0; i < patch.length; i += 2) parent[patch[i]] = patch[i + 1]
  let min = Infinity; for (let i = 0; i < N; i++) if (start[i] < min) min = start[i]
  // generated traces all start within ~1s of each other; lay them out back to back so one axis reads as one long session
  const root = new Int32Array(N).fill(-2)
  const rootOf = (i) => { const st = []; while (root[i] === -2 && parent[i] >= 0) { st.push(i); i = parent[i] } let r = root[i] === -2 ? i : root[i]; root[i] = r; for (const j of st) root[j] = r; return r }
  for (let i = 0; i < N; i++) rootOf(i)
  const roots = []; for (let i = 0; i < N; i++) if (parent[i] < 0) roots.push(i)
  roots.sort((a, b) => start[a] - start[b])
  const off = new Map(); let cursor = 0
  for (const r of roots) { off.set(r, cursor - start[r]); cursor += dur[r] + 1e6 }
  for (let i = 0; i < N; i++) start[i] += off.get(root[i]) ?? 0
  const hdr = new Uint32Array([N, 0])
  fs.writeFileSync(`data/model-${n}.bin`, Buffer.concat([hdr, start, dur, parent, kind, err].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))))
  let maxT = 0; for (let i = 0; i < N; i++) { maxT = Math.max(maxT, start[i] + dur[i]) }
  console.log(n, 'spans', N, 'roots', roots.length, 'extent s', (maxT / 1e6).toFixed(0))
}
