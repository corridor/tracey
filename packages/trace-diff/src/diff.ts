import { SpanStatus } from '@ggx/trace-model'
import type { SpanKind, Trace } from '@ggx/trace-model'
import { matchSequences } from './seq'

export type Reason = 'failed' | 'fixed' | 'slower' | 'faster' | 'input' | 'output' | 'model' | 'tokens'
export type RowState = 'same' | 'changed' | 'added' | 'removed'

export interface DiffRow {
  /** Index in trace A, or -1 when the step only exists in B. */
  a: number
  /** Index in trace B, or -1 when the step only exists in A. */
  b: number
  depth: number
  state: RowState
  reasons: Reason[]
  /** Duration in B minus duration in A, milliseconds (0 for added and removed steps). */
  deltaMs: number
}

export interface DiffSummary {
  same: number
  changed: number
  added: number
  removed: number
  slower: number
  faster: number
  /** Steps that failed in B but not in A. */
  newFailures: number
  /** Steps that failed in A but not in B. */
  fixed: number
  durationA: number
  durationB: number
  tokensA: number
  tokensB: number
}

export interface TraceDiff {
  rows: DiffRow[]
  summary: DiffSummary
}

export interface DiffOptions {
  /** A step is "slower"/"faster" when it changed by at least this factor... */
  ratio?: number
  /** ...and by at least this many milliseconds (so noise on tiny steps is ignored). */
  minMs?: number
}

const signature = (t: Trace, i: number): string => `${t.kind[i] as SpanKind}|${t.nameOf(i)}`
const isError = (t: Trace, i: number) => t.status[i] === SpanStatus.Error
const tokens = (t: Trace, i: number) => t.tokensIn[i]! + t.tokensOut[i]!

function compare(a: Trace, i: number, b: Trace, j: number, o: Required<DiffOptions>): Reason[] {
  const r: Reason[] = []
  if (!isError(a, i) && isError(b, j)) r.push('failed')
  if (isError(a, i) && !isError(b, j)) r.push('fixed')
  const da = a.spanDuration(i)
  const db = b.spanDuration(j)
  if (db - da >= o.minMs && db >= da * o.ratio) r.push('slower')
  else if (da - db >= o.minMs && da >= db * o.ratio) r.push('faster')
  if ((a.inputs[i] ?? '') !== (b.inputs[j] ?? '')) r.push('input')
  if ((a.outputs[i] ?? '') !== (b.outputs[j] ?? '')) r.push('output')
  if (a.modelOf(i) !== b.modelOf(j)) r.push('model')
  const ta = tokens(a, i)
  const tb = tokens(b, j)
  if (Math.abs(tb - ta) >= 50 && Math.abs(tb - ta) >= 0.2 * Math.max(ta, tb)) r.push('tokens')
  return r
}

/**
 * Align two runs of (usually) the same agent and describe what differs. Steps are matched among siblings in
 * order by kind and name, so a repeated tool call lines up with its counterpart and an extra retry shows up as
 * added. Linear in practice; iterative, so deep traces are safe.
 */
export function diffTraces(a: Trace, b: Trace, options: DiffOptions = {}): TraceDiff {
  const o = { ratio: options.ratio ?? 1.5, minMs: options.minMs ?? 100 }
  const rows: DiffRow[] = []

  const emitWhole = (t: Trace, i: number, depth: number, side: 'a' | 'b') => {
    const stack: [number, number][] = [[i, depth]]
    while (stack.length) {
      const [x, d] = stack.pop()!
      rows.push({ a: side === 'a' ? x : -1, b: side === 'b' ? x : -1, depth: d, state: side === 'a' ? 'removed' : 'added', reasons: [], deltaMs: 0 })
      const kids = t.children(x)
      for (let k = kids.length - 1; k >= 0; k--) stack.push([kids[k]!, d + 1])
    }
  }

  // Work list of (A-parent or -1, B-parent or -1, depth): each aligns two ordered child lists.
  type Frame = { list: number[]; depth: number }
  const frames: Frame[] = []
  const alignLists = (ca: ArrayLike<number>, cb: ArrayLike<number>, depth: number): Frame['list'] => {
    // Returns a flat instruction list: [kind, x, y] triples where kind 0 = matched, 1 = removed, 2 = added.
    const la = Array.from(ca)
    const lb = Array.from(cb)
    const m = matchSequences(la, lb, (x, y) => signature(a, x) === signature(b, y))
    const out: number[] = []
    let i = 0
    let j = 0
    for (const [x, y] of m) {
      while (i < x) out.push(1, la[i++]!, -1)
      while (j < y) out.push(2, -1, lb[j++]!)
      out.push(0, la[x]!, lb[y]!)
      i = x + 1
      j = y + 1
    }
    while (i < la.length) out.push(1, la[i++]!, -1)
    while (j < lb.length) out.push(2, -1, lb[j++]!)
    void depth
    return out
  }

  // Depth-first emission with an explicit stack of instruction cursors.
  frames.push({ list: alignLists(a.roots, b.roots, 0), depth: 0 })
  const cursors: number[] = [0]
  while (frames.length) {
    const f = frames[frames.length - 1]!
    const c = cursors[cursors.length - 1]!
    if (c >= f.list.length) {
      frames.pop()
      cursors.pop()
      continue
    }
    cursors[cursors.length - 1] = c + 3
    const kind = f.list[c]!
    const x = f.list[c + 1]!
    const y = f.list[c + 2]!
    if (kind === 1) emitWhole(a, x, f.depth, 'a')
    else if (kind === 2) emitWhole(b, y, f.depth, 'b')
    else {
      const reasons = compare(a, x, b, y, o)
      rows.push({ a: x, b: y, depth: f.depth, state: reasons.length ? 'changed' : 'same', reasons, deltaMs: b.spanDuration(y) - a.spanDuration(x) })
      frames.push({ list: alignLists(a.children(x), b.children(y), f.depth + 1), depth: f.depth + 1 })
      cursors.push(0)
    }
  }

  const s: DiffSummary = {
    same: 0, changed: 0, added: 0, removed: 0, slower: 0, faster: 0, newFailures: 0, fixed: 0,
    durationA: a.duration, durationB: b.duration, tokensA: a.totalTokens().input + a.totalTokens().output, tokensB: b.totalTokens().input + b.totalTokens().output,
  }
  for (const r of rows) {
    s[r.state]++
    if (r.reasons.includes('slower')) s.slower++
    if (r.reasons.includes('faster')) s.faster++
    if (r.reasons.includes('failed')) s.newFailures++
    if (r.reasons.includes('fixed')) s.fixed++
    // A step that exists only in B and failed is a new failure too; one only in A that failed is gone.
    if (r.state === 'added' && isError(b, r.b)) s.newFailures++
    if (r.state === 'removed' && isError(a, r.a)) s.fixed++
  }
  return { rows, summary: s }
}

/** One-line description of the differences, e.g. "2 added, 1 removed, 3 changed (1 new failure)". */
export function describeSummary(s: DiffSummary): string {
  const parts: string[] = []
  if (s.added) parts.push(`${s.added} added`)
  if (s.removed) parts.push(`${s.removed} removed`)
  if (s.changed) parts.push(`${s.changed} changed`)
  const flags: string[] = []
  if (s.newFailures) flags.push(`${s.newFailures} new ${s.newFailures === 1 ? 'failure' : 'failures'}`)
  if (s.fixed) flags.push(`${s.fixed} fixed`)
  if (s.slower) flags.push(`${s.slower} slower`)
  if (s.faster) flags.push(`${s.faster} faster`)
  if (parts.length === 0 && flags.length === 0) return 'No differences'
  return `${parts.join(', ') || 'no structural changes'}${flags.length ? ` (${flags.join(', ')})` : ''}`
}

