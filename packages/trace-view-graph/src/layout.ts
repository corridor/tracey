import type { Trace } from '@ggx/trace-model'

export interface LayoutOptions {
  nodeW?: number
  nodeH?: number
  gapX?: number
  gapY?: number
}

export interface GraphLayout {
  /** Top-left corner of each node in world units, indexed like the trace's spans. */
  x: Float32Array
  y: Float32Array
  nodeW: number
  nodeH: number
  width: number
  height: number
}

/**
 * Left-to-right tidy tree: depth sets the column, leaves take consecutive rows, and a parent sits
 * centred on its children. Linear time and iterative, so deep or wide traces are safe.
 */
export function layoutTree(t: Trace, o: LayoutOptions = {}): GraphLayout {
  const nodeW = o.nodeW ?? 176
  const nodeH = o.nodeH ?? 30
  const gapX = o.gapX ?? 44
  const gapY = o.gapY ?? 10
  const n = t.count
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const row = new Float32Array(n)

  let slot = 0
  for (let k = 0; k < n; k++) {
    const i = t.order[k]!
    if (t.childStart[i + 1]! === t.childStart[i]!) row[i] = slot++
  }
  // Children come after their parent in pre-order, so a reverse sweep sees every child first.
  for (let k = n - 1; k >= 0; k--) {
    const i = t.order[k]!
    const a = t.childStart[i]!
    const b = t.childStart[i + 1]!
    if (b > a) row[i] = (row[t.childIdx[a]!]! + row[t.childIdx[b - 1]!]!) / 2
  }
  let maxDepth = 0
  for (let i = 0; i < n; i++) {
    x[i] = t.depth[i]! * (nodeW + gapX)
    y[i] = row[i]! * (nodeH + gapY)
    if (t.depth[i]! > maxDepth) maxDepth = t.depth[i]!
  }
  return {
    x,
    y,
    nodeW,
    nodeH,
    width: n ? (maxDepth + 1) * (nodeW + gapX) - gapX : 0,
    height: n ? Math.max(0, slot - 1) * (nodeH + gapY) + nodeH : 0,
  }
}
