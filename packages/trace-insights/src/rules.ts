import { SpanKind, SpanStatus } from '@ggx/trace-model'
import type { Trace } from '@ggx/trace-model'
import type { Finding, Rule } from './types'

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
const byStart = (t: Trace) => (a: number, b: number) => t.start[a]! - t.start[b]!

/** Errors that did not simply bubble up from a failing child. */
export const failedSpans: Rule = (t) => {
  const out: Finding[] = []
  for (const i of t.where(SpanStatus.Error)) {
    if (t.children(i).some((c) => t.status[c] === SpanStatus.Error)) continue
    const msg = t.errors[i]
    out.push({
      id: `failed-span:${i}`,
      rule: 'failed-span',
      severity: 'error',
      title: `${t.nameOf(i)} failed`,
      ...(msg ? { detail: msg } : {}),
      spans: [i],
    })
  }
  return out
}

/** A failing step whose parent carried on and finished without error. */
export const swallowedError: Rule = (t) => {
  const out: Finding[] = []
  for (const i of t.where(SpanStatus.Error)) {
    const p = t.parent[i]!
    if (p < 0 || t.status[p] === SpanStatus.Error) continue
    const later = t.children(p).some((c) => t.start[c]! >= t.end[i]! && c !== i)
    if (!later) continue
    out.push({
      id: `swallowed-error:${i}`,
      rule: 'swallowed-error',
      severity: 'warning',
      title: `${t.parent[i]! >= 0 ? t.nameOf(p) : 'The agent'} continued after ${t.nameOf(i)} failed`,
      detail: 'The failure did not stop the run, so later steps may be working without that result.',
      spans: [i],
    })
  }
  return out
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
