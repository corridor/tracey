import { SpanKind, SpanStatus } from '@ggx/trace-model'
import type { Trace } from '@ggx/trace-model'
import type { Finding, Rule } from './types'

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
const byStart = (t: Trace) => (a: number, b: number) => t.start[a]! - t.start[b]!

/** Errors that did not simply bubble up from a failing child, grouped by step name and message. */
export const failedSpans: Rule = (t) => {
  const groups = new Map<string, number[]>()
  for (const i of t.where(SpanStatus.Error)) {
    if (t.children(i).some((c) => t.status[c] === SpanStatus.Error)) continue
    const key = `${t.nameOf(i)}\u0000${t.errors[i] ?? ''}`
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }
  return [...groups.values()].map((g) => {
    const i = g[0]!
    const msg = t.errors[i]
    return {
      id: `failed-span:${i}`,
      rule: 'failed-span',
      severity: 'error' as const,
      title: g.length > 1 ? `${t.nameOf(i)} failed ${g.length}×` : `${t.nameOf(i)} failed`,
      ...(msg ? { detail: msg } : {}),
      spans: g,
    }
  })
}

/** A failing step whose parent carried on and finished without error, grouped by parent and step. */
export const swallowedError: Rule = (t) => {
  const groups = new Map<string, number[]>()
  for (const i of t.where(SpanStatus.Error)) {
    const p = t.parent[i]!
    if (p < 0 || t.status[p] === SpanStatus.Error) continue
    if (!t.children(p).some((c) => t.start[c]! >= t.end[i]! && c !== i)) continue
    const key = `${p}\u0000${t.nameOf(i)}`
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }
  return [...groups.values()].map((g) => {
    const i = g[0]!
    const p = t.parent[i]!
    return {
      id: `swallowed-error:${i}`,
      rule: 'swallowed-error',
      severity: 'warning' as const,
      title: `${t.nameOf(p)} carried on after ${t.nameOf(i)} failed${g.length > 1 ? ` ${g.length}×` : ''}`,
      detail: 'The failure did not stop the run, so later steps may be working without that result.',
      spans: g,
    }
  })
}

/** The same tool called with the same input three or more times. */
export const repeatedCall: Rule = (t) => {
  const groups = new Map<string, number[]>()
  for (let i = 0; i < t.count; i++) {
    if (t.kind[i] !== SpanKind.Tool) continue
    const key = `${t.nameOf(i)}\u0000${t.inputs[i] ?? ''}`
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }
  const out: Finding[] = []
  for (const g of groups.values()) {
    if (g.length < 3) continue
    g.sort(byStart(t))
    const failed = g.filter((i) => t.status[i] === SpanStatus.Error).length
    out.push({
      id: `repeated-call:${g[0]}`,
      rule: 'repeated-call',
      severity: 'warning',
      title: `${t.nameOf(g[0]!)} called ${g.length}× with the same input`,
      detail: failed ? `${failed} of ${g.length} calls failed. Possible retry loop.` : 'Possible loop.',
      spans: g,
    })
  }
  return out
}

/** Steps that take a large share of the run and at least a second. */
export const slowSpans: Rule = (t) => {
  const total = t.duration
  if (total <= 0) return []
  const out: Finding[] = []
  for (let i = 0; i < t.count; i++) {
    if (t.kind[i] !== SpanKind.Llm && t.kind[i] !== SpanKind.Tool) continue
    const d = t.spanDuration(i)
    if (d < 1000 || d / total < 0.25) continue
    out.push({
      id: `slow-span:${i}`,
      rule: 'slow-span',
      severity: 'warning',
      title: `${t.nameOf(i)} took ${secs(d)}`,
      detail: `${Math.round((d / total) * 100)}% of the run.`,
      spans: [i],
    })
  }
  return out
}

/** An LLM call that succeeded but produced nothing, in a trace where other calls did capture output. */
export const emptyOutput: Rule = (t) => {
  const llms = t.where((i) => t.kind[i] === SpanKind.Llm)
  if (!llms.some((i) => (t.outputs[i] ?? '').length > 0)) return []
  return llms
    .filter((i) => t.status[i] !== SpanStatus.Error && !(t.outputs[i] ?? '').length)
    .map((i) => ({
      id: `empty-output:${i}`,
      rule: 'empty-output',
      severity: 'info' as const,
      title: `${t.nameOf(i)} returned no output`,
      spans: [i],
    }))
}

export const DEFAULT_RULES: Rule[] = [failedSpans, swallowedError, repeatedCall, slowSpans, emptyOutput]
