import type { RawSpan } from './otlp'

/**
 * The GGX platform's span export: one JSON object per span with flat columns (ids, name, kind, status, ISO
 * times, tokens, model) and a `document` carrying the OpenInference `attributes`, the OpenTelemetry
 * `resource` and `events`. See fixtures/ggx-platform.
 */
export interface GgxRecord {
  trace_id?: string
  span_id?: string
  parent_span_id?: string | null
  name?: string
  kind?: string
  status?: string
  status_message?: string | null
  start_time?: string
  end_time?: string
  duration_ms?: number | null
  model?: string | null
  provider?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  document?: { attributes?: Record<string, unknown>; resource?: Record<string, unknown>; events?: unknown[] } | null
}

/** Cheap check over the head of a file: span records with the platform's column names and a document. */
export function looksLikeGgxSpans(head: string): boolean {
  const t = head.trimStart()
  const first = t.startsWith('[') ? t.slice(1).trimStart() : t
  const line = first.split('\n', 1)[0] ?? ''
  return /"span_id"/.test(line) && /"trace_id"/.test(line) && /"document"/.test(line) && /"start_time"/.test(line)
}

/**
 * Times arrive as ISO strings without a zone (the platform stores UTC), so read them as UTC. They carry
 * microseconds, which `Date.parse` would drop, so the fraction is added back (as fractional milliseconds).
 */
export function isoMs(s: string | undefined): number {
  if (!s) return 0
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:?\d\d)?$/i.exec(s.trim())
  if (!m) {
    const ms = Date.parse(s)
    return Number.isNaN(ms) ? 0 : ms
  }
  const whole = Date.parse(`${m[1]}${m[3] ?? 'Z'}`)
  return Number.isNaN(whole) ? 0 : whole + (m[2] ? Number(`0.${m[2]}`) * 1000 : 0)
}

const STATUS: Record<string, number> = { OK: 1, ERROR: 2, STATUS_CODE_OK: 1, STATUS_CODE_ERROR: 2 }

export function readGgxRecords(text: string): GgxRecord[] {
  const t = text.trim()
  if (t.startsWith('[')) {
    const v = JSON.parse(t) as unknown
    return Array.isArray(v) ? (v as GgxRecord[]) : []
  }
  const out: GgxRecord[] = []
  for (const line of t.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as GgxRecord)
    } catch {
      /* a truncated last line */
    }
  }
  return out
}

/** Turn export records into the same raw spans OTLP gives, so OpenInference mapping and findings are shared. */
export function ggxToRawSpans(records: GgxRecord[]): RawSpan[] {
  return records
    .filter((r) => r.span_id && r.trace_id)
    .map((r) => {
      const attrs: Record<string, unknown> = { ...(r.document?.attributes ?? {}) }
      // The flat columns back-fill anything the document leaves out.
      if (attrs['openinference.span.kind'] === undefined && r.kind) attrs['openinference.span.kind'] = r.kind
      if (attrs['llm.model_name'] === undefined && r.model) attrs['llm.model_name'] = r.model
      if (attrs['llm.token_count.prompt'] === undefined && typeof r.input_tokens === 'number') attrs['llm.token_count.prompt'] = r.input_tokens
      if (attrs['llm.token_count.completion'] === undefined && typeof r.output_tokens === 'number') attrs['llm.token_count.completion'] = r.output_tokens
      const start = isoMs(r.start_time)
      const end = r.end_time ? isoMs(r.end_time) : start + (r.duration_ms ?? 0)
      return {
        traceId: r.trace_id!,
        spanId: r.span_id!,
        parentSpanId: r.parent_span_id ?? '',
        name: r.name ?? '',
        kind: 0,
        startMs: start,
        endMs: end,
        statusCode: STATUS[String(r.status ?? '').toUpperCase()] ?? 0,
        statusMessage: r.status_message ?? '',
        scope: 'ggx-platform',
        attrs,
      }
    })
}
