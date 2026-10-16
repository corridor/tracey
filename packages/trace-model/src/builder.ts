import { StringTable } from './strings'
import { Trace } from './trace'
import { SpanKind, SpanStatus } from './types'
import type { Attrs, SpanInit } from './types'

/** Accepts spans in any order (children may arrive before parents) and builds a Trace. */
export class TraceBuilder {
  private readonly strings = new StringTable()
  private readonly spans: SpanInit[] = []

  get size(): number {
    return this.spans.length
  }

  add(span: SpanInit): void {
    this.spans.push(span)
  }

  build(): Trace {
    const n = this.spans.length
    const byId = new Map<string, number>()
    for (let i = 0; i < n; i++) byId.set(this.spans[i]!.id, i)

    const ids = new Array<string>(n)
    const start = new Float64Array(n)
    const end = new Float64Array(n)
    const parent = new Int32Array(n).fill(-1)
    const kind = new Uint8Array(n)
    const status = new Uint8Array(n)
    const name = new Uint32Array(n)
    const model = new Uint32Array(n)
    const tokensIn = new Int32Array(n)
    const tokensOut = new Int32Array(n)
    const inputs = new Array<string | undefined>(n)
    const outputs = new Array<string | undefined>(n)
    const errors = new Array<string | undefined>(n)
    const attrs = new Array<Attrs | undefined>(n)

    let t0 = Infinity
    let t1 = -Infinity
    for (let i = 0; i < n; i++) {
      const s = this.spans[i]!
      ids[i] = s.id
      start[i] = s.start
      end[i] = s.end < s.start ? s.start : s.end
      if (s.start < t0) t0 = s.start
      if (end[i]! > t1) t1 = end[i]!
      const p = s.parentId ? byId.get(s.parentId) : undefined
      parent[i] = p !== undefined && p !== i ? p : -1
      kind[i] = s.kind ?? SpanKind.Other
      status[i] = s.status ?? (s.error ? SpanStatus.Error : SpanStatus.Unset)
      name[i] = this.strings.intern(s.name)
      model[i] = this.strings.intern(s.model)
      tokensIn[i] = s.tokensIn ?? 0
      tokensOut[i] = s.tokensOut ?? 0
      inputs[i] = s.input
      outputs[i] = s.output
      errors[i] = s.error
      attrs[i] = s.attrs
    }
    if (n === 0) {
      t0 = 0
      t1 = 0
    }
    breakCycles(parent)

    // Children in CSR form, siblings ordered by start time.
    const counts = new Int32Array(n + 1)
    for (let i = 0; i < n; i++) if (parent[i]! >= 0) counts[parent[i]! + 1]!++
    const childStart = new Int32Array(n + 1)
    for (let i = 0; i < n; i++) childStart[i + 1] = childStart[i]! + counts[i + 1]!
    const fill = childStart.slice(0, n)
    const childIdx = new Int32Array(childStart[n]!)
    const rootList: number[] = []
    const byStart = Array.from({ length: n }, (_, i) => i).sort((a, b) => start[a]! - start[b]! || a - b)
    for (const i of byStart) {
      const p = parent[i]!
      if (p >= 0) childIdx[fill[p]!++] = i
      else rootList.push(i)
    }

    const depth = new Uint16Array(n)
    const order = new Int32Array(n)
    let k = 0
    const stack: number[] = []
    for (let r = rootList.length - 1; r >= 0; r--) stack.push(rootList[r]!)
    while (stack.length) {
      const i = stack.pop()!
      order[k++] = i
      const d = depth[i]! + 1
      for (let c = childStart[i + 1]! - 1; c >= childStart[i]!; c--) {
        const child = childIdx[c]!
        depth[child] = d > 65535 ? 65535 : d
        stack.push(child)
      }
    }

    return new Trace({
      count: n, ids, start, end, parent, kind, status, name, model, tokensIn, tokensOut,
      inputs, outputs, errors, attrs, strings: this.strings,
      childStart, childIdx, depth, roots: Int32Array.from(rootList), order, t0, t1,
    })
  }
}

/** A malformed trace can contain parent cycles; detach one edge per cycle so traversal terminates. */
function breakCycles(parent: Int32Array): void {
  const n = parent.length
  const state = new Uint8Array(n) // 0 unseen, 1 on current path, 2 done
  for (let s = 0; s < n; s++) {
    if (state[s] !== 0) continue
    const path: number[] = []
    let i = s
    while (i >= 0 && state[i] === 0) {
      state[i] = 1
      path.push(i)
      i = parent[i]!
    }
    if (i >= 0 && state[i] === 1) parent[i] = -1
    for (const p of path) state[p] = 2
  }
}
