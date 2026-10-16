import { TraceBuilder } from '@ggx/trace-model'
import type { Trace } from '@ggx/trace-model'
import { claudeCodeDetection, detectSpans, unknownDetection } from './detect'
import { claudeCodeSpans, looksLikeClaudeCode } from './claude-code'
import type { ClaudeSubagent } from './claude-code'
import type { Detection } from './detect'
import { looksLikeOtlp, parseBatches, parseOtlp } from './otlp'
import type { RawSpan } from './otlp'
import { decodeOtlpProtobuf } from './protobuf'
import { mapSpan } from './map'

export type { Detection, SourceId } from './detect'
export type { RawSpan } from './otlp'
export { detectSpans } from './detect'
export { parseOtlp, parseBatches, looksLikeOtlp } from './otlp'
export { decodeOtlpProtobuf } from './protobuf'
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
  return buildTraces(parseOtlp(text))
}

/** Detect the convention, then build one Trace per trace id from decoded OTLP spans. */
export function buildTraces(raw: RawSpan[]): ParsedFile {
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

/**
 * Like parseTraceFile but takes bytes, so it also reads OTLP protobuf (what most OpenTelemetry exporters
 * send over HTTP). Text formats are decoded as UTF-8 first.
 */
export function parseTraceBytes(bytes: Uint8Array, extras: { claudeSubagents?: ClaudeSubagent[] } = {}): ParsedFile {
  const first = bytes.find((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09)
  if (first === 0x7b || first === 0x5b) return parseTraceFile(new TextDecoder().decode(bytes), extras)
  try {
    return buildTraces(parseBatches([decodeOtlpProtobuf(bytes)]))
  } catch {
    return { detection: unknownDetection(), traces: [] }
  }
}

/** Spans from one OTLP request body (what an exporter POSTs): protobuf, or JSON when the content type says so. */
export function spansFromBody(bytes: Uint8Array, contentType: string): RawSpan[] {
  if (contentType.includes('json')) return parseOtlp(new TextDecoder().decode(bytes))
  return parseBatches([decodeOtlpProtobuf(bytes)])
}
