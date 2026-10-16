import type { Trace } from '@ggx/trace-model'

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  /** Stable within a trace: rule id plus the first span index. */
  id: string
  rule: string
  severity: Severity
  title: string
  detail?: string
  /** Span indexes in the trace, earliest first. */
  spans: number[]
}

export type Rule = (trace: Trace) => Finding[]
