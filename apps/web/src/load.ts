import { parseTraceFile } from '@ggx/trace-adapters'
import type { ClaudeSubagent, Detection } from '@ggx/trace-adapters'
import { analyze, summarize } from '@ggx/trace-insights'
import type { Finding, Summary } from '@ggx/trace-insights'
import type { Trace } from '@ggx/trace-model'

export interface Loaded {
  name: string
  detection: Detection
  trace: Trace
  findings: Finding[]
  summary: Summary
  traceCount: number
}

/** Read dropped/pasted/sample text into the first trace. Throws a readable message if nothing is recognised. */
export function load(name: string, text: string, extras?: { claudeSubagents?: ClaudeSubagent[] }): Loaded {
  const parsed = parseTraceFile(text, extras)
  const first = parsed.traces[0]
  if (!first) throw new Error("This doesn't look like a trace tracey knows yet. Supported: OTLP JSON (OpenInference, OpenTelemetry GenAI, OpenLLMetry) and Claude Code transcripts.")
  const findings = analyze(first.trace)
  return { name, detection: parsed.detection, trace: first.trace, findings, summary: summarize(first.trace, findings), traceCount: parsed.traces.length }
}
