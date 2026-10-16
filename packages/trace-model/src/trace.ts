import type { Attrs, SpanKind, SpanStatus } from './types'
import { StringTable } from './strings'

export interface TraceData {
  readonly count: number
  readonly ids: string[]
  readonly start: Float64Array
  readonly end: Float64Array
  readonly parent: Int32Array
  readonly kind: Uint8Array
  readonly status: Uint8Array
  readonly name: Uint32Array
  readonly model: Uint32Array
  readonly tokensIn: Int32Array
  readonly tokensOut: Int32Array
  readonly inputs: (string | undefined)[]
  readonly outputs: (string | undefined)[]
  readonly errors: (string | undefined)[]
  readonly attrs: (Attrs | undefined)[]
  readonly strings: StringTable
  readonly childStart: Int32Array
  readonly childIdx: Int32Array
  readonly depth: Uint16Array
  readonly roots: Int32Array
  readonly order: Int32Array
  readonly t0: number
  readonly t1: number
}

/** A trace flattened to plain data that survives structured clone (`postMessage`) and can move buffers. */
export type TraceTransfer = Omit<TraceData, 'strings'> & { stringValues: string[] }

/**
 * A finished, immutable trace stored as parallel arrays (struct of arrays).
 * Span `i` is described by index `i` in every array. Cheap to build, scan and transfer.
 */
export class Trace {
  readonly count: number
  readonly ids: string[]
  readonly start: Float64Array
  readonly end: Float64Array
  readonly parent: Int32Array
  readonly kind: Uint8Array
  readonly status: Uint8Array
  readonly name: Uint32Array
  readonly model: Uint32Array
  readonly tokensIn: Int32Array
  readonly tokensOut: Int32Array
  readonly inputs: (string | undefined)[]
  readonly outputs: (string | undefined)[]
  readonly errors: (string | undefined)[]
  readonly attrs: (Attrs | undefined)[]
  readonly strings: StringTable

  /** Child lists in CSR form: children of `i` are `childIdx[childStart[i] .. childStart[i+1])`. */
  readonly childStart: Int32Array
  readonly childIdx: Int32Array
  readonly depth: Uint16Array
  readonly roots: Int32Array
  /** Depth-first pre-order, siblings by start time. The natural order for lists. */
  readonly order: Int32Array
  /** Earliest start and latest end across all spans. */
  readonly t0: number
  readonly t1: number

  constructor(d: TraceData) {
    this.count = d.count
    this.ids = d.ids
    this.start = d.start
    this.end = d.end
    this.parent = d.parent
    this.kind = d.kind
    this.status = d.status
    this.name = d.name
    this.model = d.model
    this.tokensIn = d.tokensIn
    this.tokensOut = d.tokensOut
    this.inputs = d.inputs
    this.outputs = d.outputs
    this.errors = d.errors
    this.attrs = d.attrs
    this.strings = d.strings
    this.childStart = d.childStart
    this.childIdx = d.childIdx
    this.depth = d.depth
    this.roots = d.roots
    this.order = d.order
    this.t0 = d.t0
    this.t1 = d.t1
  }

  get duration(): number {
    return this.t1 - this.t0
  }

  nameOf(i: number): string {
    return this.strings.get(this.name[i] ?? 0)
  }

  modelOf(i: number): string {
    return this.strings.get(this.model[i] ?? 0)
  }

  children(i: number): Int32Array {
    return this.childIdx.subarray(this.childStart[i], this.childStart[i + 1])
  }

  spanDuration(i: number): number {
    return (this.end[i] ?? 0) - (this.start[i] ?? 0)
  }

  /** Time spent in span `i` outside its children (children may overlap, so this is clamped at 0). */
  selfTime(i: number): number {
    let covered = 0
    let curEnd = -Infinity
    const kids = Array.from(this.children(i)).sort((a, b) => (this.start[a] ?? 0) - (this.start[b] ?? 0))
    for (const c of kids) {
      const s = Math.max(this.start[c] ?? 0, curEnd)
      const e = this.end[c] ?? 0
      if (e > s) covered += e - s
      curEnd = Math.max(curEnd, e)
    }
    return Math.max(0, this.spanDuration(i) - covered)
  }

  totalTokens(): { input: number; output: number } {
    let input = 0
    let output = 0
    for (let i = 0; i < this.count; i++) {
      input += this.tokensIn[i] ?? 0
      output += this.tokensOut[i] ?? 0
    }
    return { input, output }
  }

  /** Indexes of spans with a given status, in storage order. */
  where(status: SpanStatus): number[]
  where(pred: (i: number) => boolean): number[]
  where(arg: SpanStatus | ((i: number) => boolean)): number[] {
    const out: number[] = []
    const pred = typeof arg === 'function' ? arg : (i: number) => this.status[i] === arg
    for (let i = 0; i < this.count; i++) if (pred(i)) out.push(i)
    return out
  }

  isKind(i: number, k: SpanKind): boolean {
    return this.kind[i] === k
  }

  /** Plain data for a worker boundary. Pass `buffers` as the transfer list to move rather than copy. */
  toTransfer(): { data: TraceTransfer; buffers: ArrayBuffer[] } {
    const { strings, ...rest } = this
    const data = { ...rest, stringValues: strings.values } as TraceTransfer
    const buffers = [data.start, data.end, data.parent, data.kind, data.status, data.name, data.model, data.tokensIn, data.tokensOut, data.childStart, data.childIdx, data.depth, data.roots, data.order].map((a) => a.buffer as ArrayBuffer)
    return { data, buffers }
  }

  static fromTransfer(t: TraceTransfer): Trace {
    const { stringValues, ...rest } = t
    return new Trace({ ...rest, strings: StringTable.from(stringValues) })
  }
}
