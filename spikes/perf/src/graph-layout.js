// THROWAWAY spike. Layered tree/DAG layouts. Pure functions on typed arrays, run in a worker.
export const NW = 180, NH = 40, XGAP = 24, YGAP = 60

// Build edges: parent->child (tree) + "next step" edges between consecutive siblings that do not overlap in time (turns it into a DAG)
export function buildEdges(m, { seq = true } = {}) {
  const N = m.N
  const kids = new Map()
  for (let i = 0; i < N; i++) { const p = m.parent[i]; if (p >= 0) { let a = kids.get(p); if (!a) kids.set(p, a = []); a.push(i) } }
  const src = [], dst = []
  for (let i = 0; i < N; i++) if (m.parent[i] >= 0) { src.push(m.parent[i]); dst.push(i) }
  let treeEdges = src.length
  if (seq) for (const [, a] of kids) {
    a.sort((x, y) => m.start[x] - m.start[y])
    let prev = -1
    for (const c of a) { if (prev >= 0 && m.start[prev] + m.dur[prev] <= m.start[c] && m.kind[prev] === 2 && m.kind[c] === 2) { src.push(prev); dst.push(c) } if (m.kind[c] === 2 || prev < 0) prev = c }
  }
  return { src: Int32Array.from(src), dst: Int32Array.from(dst), treeEdges }
}

// O(n) tidy tree: leaves get consecutive slots, parents centre over children. Forest of roots side by side.
export function tidyTree(m) {
  const N = m.N
  const head = new Int32Array(N).fill(-1), next = new Int32Array(N).fill(-1)
  const roots = []
  for (let i = N - 1; i >= 0; i--) { const p = m.parent[i]; if (p >= 0) { next[i] = head[p]; head[p] = i } else roots.push(i) }
  roots.reverse()
  const x = new Float32Array(N), y = new Float32Array(N), depth = new Int32Array(N)
  let slot = 0
  // iterative DFS
  const stack = new Int32Array(N + 1), it = new Int32Array(N), kidsSum = new Float64Array(N), kidsCnt = new Int32Array(N)
  for (const r of roots) {
    let sp = 0; stack[sp++] = r; it[r] = head[r]; depth[r] = 0
    while (sp) {
      const v = stack[sp - 1]
      const c = it[v]
      if (c >= 0) { it[v] = next[c]; depth[c] = depth[v] + 1; it[c] = head[c]; stack[sp++] = c }
      else {
        sp--
        if (kidsCnt[v] === 0) x[v] = slot++ * (NW + XGAP); else x[v] = kidsSum[v] / kidsCnt[v]
        y[v] = depth[v] * (NH + YGAP)
        if (sp) { const p = stack[sp - 1]; kidsSum[p] += x[v]; kidsCnt[p]++ }
      }
    }
  }
  return { x, y }
}

// Sugiyama-lite: longest-path layering, barycentre ordering sweeps, simple coordinate assignment.
export function layeredDag(m, E, sweeps = 4) {
  const N = m.N, M = E.src.length
  // CSR out / in
  const outS = new Int32Array(N + 1), inS = new Int32Array(N + 1)
  for (let e = 0; e < M; e++) { outS[E.src[e] + 1]++; inS[E.dst[e] + 1]++ }
  for (let i = 0; i < N; i++) { outS[i + 1] += outS[i]; inS[i + 1] += inS[i] }
  const outA = new Int32Array(M), inA = new Int32Array(M), fo = outS.slice(0, N), fi = inS.slice(0, N)
  for (let e = 0; e < M; e++) { outA[fo[E.src[e]]++] = E.dst[e]; inA[fi[E.dst[e]]++] = E.src[e] }
  // layering (Kahn)
  const indeg = new Int32Array(N); for (let i = 0; i < N; i++) indeg[i] = inS[i + 1] - inS[i]
  const layer = new Int32Array(N), q = new Int32Array(N); let qh = 0, qt = 0
  for (let i = 0; i < N; i++) if (!indeg[i]) q[qt++] = i
  while (qh < qt) { const v = q[qh++]; for (let k = outS[v]; k < outS[v + 1]; k++) { const w = outA[k]; if (layer[w] < layer[v] + 1) layer[w] = layer[v] + 1; if (--indeg[w] === 0) q[qt++] = w } }
  let L = 0; for (let i = 0; i < N; i++) if (layer[i] > L) L = layer[i]
  L++
  // initial order: by layer, then by Kahn order
  const layers = Array.from({ length: L }, () => [])
  for (let k = 0; k < qt; k++) layers[layer[q[k]]].push(q[k])
  const pos = new Float64Array(N)
  for (const l of layers) l.forEach((v, i) => (pos[v] = i))
  const bary = new Float64Array(N)
  const sweep = (down) => {
    for (let li = down ? 1 : L - 2; down ? li < L : li >= 0; li += down ? 1 : -1) {
      const l = layers[li]
      for (const v of l) {
        let s = 0, c = 0
        if (down) for (let k = inS[v]; k < inS[v + 1]; k++) { s += pos[inA[k]]; c++ }
        else for (let k = outS[v]; k < outS[v + 1]; k++) { s += pos[outA[k]]; c++ }
        bary[v] = c ? s / c : pos[v]
      }
      l.sort((a, b) => bary[a] - bary[b] || a - b)
      for (let i = 0; i < l.length; i++) pos[l[i]] = i
    }
  }
  for (let s = 0; s < sweeps; s++) { sweep(true); sweep(false) }
  // coordinates: desired x = mean of parents' x, then resolve overlaps preserving order
  const x = new Float32Array(N), y = new Float32Array(N), w = NW + XGAP
  for (let li = 0; li < L; li++) {
    const l = layers[li]; const d = new Float64Array(l.length)
    for (let i = 0; i < l.length; i++) {
      const v = l[i]; let s = 0, c = 0
      for (let k = inS[v]; k < inS[v + 1]; k++) { s += x[inA[k]]; c++ }
      d[i] = c ? s / c : i * w
    }
    for (let i = 1; i < l.length; i++) if (d[i] < d[i - 1] + w) d[i] = d[i - 1] + w
    // re-centre block on mean desired shift (cheap approximation)
    for (let i = 0; i < l.length; i++) { x[l[i]] = d[i]; y[l[i]] = li * (NH + YGAP) }
  }
  return { x, y, layers: L }
}
