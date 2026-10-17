/**
 * Order-preserving matches between two sequences (a longest common subsequence), by Myers' O(ND) algorithm.
 * Cheap when the sequences are similar, which is the point of diffing two runs of the same agent. Returns pairs
 * of indexes `[inA, inB]` in increasing order. If the sequences differ by more than `maxD` edits the middle is
 * left unmatched (still correct, just less clever) so a pathological input cannot stall the page.
 */
export function matchSequences<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
  maxD = 1500,
): [number, number][] {
  const out: [number, number][] = []
  let lo = 0
  while (lo < a.length && lo < b.length && eq(a[lo]!, b[lo]!)) out.push([lo, lo]), lo++
  let hn = a.length
  let hm = b.length
  const tail: [number, number][] = []
  while (hn > lo && hm > lo && eq(a[hn - 1]!, b[hm - 1]!)) tail.push([hn - 1, hm - 1]), hn--, hm--
  const mid = myers(a.slice(lo, hn), b.slice(lo, hm), eq, maxD)
  for (const [x, y] of mid) out.push([x + lo, y + lo])
  for (let i = tail.length - 1; i >= 0; i--) out.push(tail[i]!)
  return out
}

function myers<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean, maxD: number): [number, number][] {
  const N = a.length
  const M = b.length
  if (N === 0 || M === 0) return []
  const max = Math.min(N + M, maxD)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1
      let y = x - k
      while (x < N && y < M && eq(a[x]!, b[y]!)) x++, y++
      v[off + k] = x
      if (x >= N && y >= M) return backtrack(trace, N, M, off)
    }
  }
  return [] // too different: leave the middle unmatched
}

function backtrack(trace: Int32Array[], N: number, M: number, off: number): [number, number][] {
  let x = N
  let y = M
  const out: [number, number][] = []
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!
    const k = x - y
    const prevK = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? k + 1 : k - 1
    const prevX = v[off + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) out.push([x - 1, y - 1]), x--, y--
    if (d > 0) {
      x = prevX
      y = prevY
    }
  }
  return out.reverse()
}
