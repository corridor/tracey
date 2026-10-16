import { TraceBuilder } from '@ggx/trace-model'
import type { Trace } from '@ggx/trace-model'
import { claudeCodeDetection, detectSpans, unknownDetection } from './detect'
import { claudeCodeSpans, looksLikeClaudeCode } from './claude-code'
import type { ClaudeSubagent } from './claude-code'
import type { Detection } from './detect'
import { looksLikeOtlp, parseOtlp } from './otlp'
import { mapSpan } from './map'

export type { Detection, SourceId } from './detect'
export type { RawSpan } from './otlp'
export { detectSpans } from './detect'
export { parseOtlp, looksLikeOtlp } from './otlp'
export type { ClaudeSubagent } from './claude-code'

export interface ParsedTrace {
  traceId: string
  trace: Trace
}

export interface ParsedFile {
  detection: Detection
  traces: ParsedTrace[]
}

/** Read a trace file's text, detect where it came from, and build one Trace per trace id. */
export function parseTraceFile(text: string, extras: { claudeSubagents?: ClaudeSubagent[] } = {}): ParsedFile {
  if (looksLikeClaudeCode(text.slice(0, 16384))) {
    const { spans, version, sessionId } = claudeCodeSpans(text, extras.claudeSubagents)
    const b = new TraceBuilder()
    for (const s of spans) b.add(s)
    return { detection: claudeCodeDetection(version), traces: [{ traceId: sessionId ?? '', trace: b.build() }] }
  }
  if (!looksLikeOtlp(text.slice(0, 4096))) return { detection: unknownDetection(), traces: [] }
  const raw = parseOtlp(text)
  const detection = detectSpans(raw)
  const builders = new Map<string, TraceBuilder>()
  for (const s of raw) {
    let b = builders.get(s.traceId)
    if (!b) builders.set(s.traceId, (b = new TraceBuilder()))
    b.add(mapSpan(s, detection.source, detection.mixed))
  }
  const traces = [...builders.entries()]
    .map(([traceId, b]) => ({ traceId, trace: b.build() }))
    .sort((a, b) => a.trace.t0 - b.trace.t0)
  return { detection, traces }
}
