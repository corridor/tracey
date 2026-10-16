import type { Trace } from '@ggx/trace-model'
import { DEFAULT_RULES } from './rules'
import type { Finding, Rule, Severity } from './types'

export type { Finding, Rule, Severity } from './types'
export { DEFAULT_RULES, failedSpans, swallowedError, repeatedCall, slowSpans, emptyOutput } from './rules'

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** Run rules and order findings: severity first, then where they happen in the run. */
export function analyze(trace: Trace, rules: Rule[] = DEFAULT_RULES): Finding[] {
  const out = rules.flatMap((r) => r(trace))
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || trace.start[a.spans[0]!]! - trace.start[b.spans[0]!]!)
}

export interface Summary {
  spans: number
  durationMs: number
  errors: number
  warnings: number
  tokensIn: number
  tokensOut: number
  /** The first thing that went wrong, if anything. */
  firstError?: Finding
}

export function summarize(trace: Trace, findings: Finding[]): Summary {
  const tokens = trace.totalTokens()
  const firstError = findings.find((f) => f.severity === 'error')
  return {
    spans: trace.count,
    durationMs: trace.duration,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    tokensIn: tokens.input,
    tokensOut: tokens.output,
    ...(firstError ? { firstError } : {}),
  }
}
