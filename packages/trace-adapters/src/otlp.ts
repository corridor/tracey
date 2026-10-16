/** Minimal OTLP/JSON reader: decodes batches into flat raw spans with plain-JS attributes. */

export interface RawSpan {
  traceId: string
  spanId: string
  parentSpanId: string
  name: string
  /** OTLP SpanKind number (1 internal, 2 server, 3 client, ...). */
  kind: number
  startMs: number
  endMs: number
  /** OTLP status code: 0 unset, 1 ok, 2 error. */
  statusCode: number
  statusMessage: string
  scope: string
  attrs: Record<string, unknown>
}

type OtlpValue = {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpValue[] }
  kvlistValue?: { values?: { key: string; value: OtlpValue }[] }
}

export function decodeValue(v: OtlpValue | undefined): unknown {
  if (!v) return null
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(decodeValue)
  if (v.kvlistValue) {
    const o: Record<string, unknown> = {}
    for (const kv of v.kvlistValue.values ?? []) o[kv.key] = decodeValue(kv.value)
    return o
  }
  return null
}

function decodeAttrs(list: { key: string; value: OtlpValue }[] | undefined): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  if (list) for (const kv of list) o[kv.key] = decodeValue(kv.value)
  return o
}

const nanosToMs = (n: string | number | undefined): number => (n === undefined ? 0 : Number(n) / 1e6)

interface Batch {
  resourceSpans?: {
    resource?: { attributes?: { key: string; value: OtlpValue }[] }
    scopeSpans?: {
      scope?: { name?: string }
      spans?: Record<string, any>[]
    }[]
  }[]
}

/** True when the text looks like OTLP/JSON: a batch object, an array of batches, or lines of batches. */
export function looksLikeOtlp(head: string): boolean {
  return /^\s*[\[{]/.test(head) && head.includes('"resourceSpans"')
}

/** Parse OTLP/JSON given as one object, an array of batches, or newline-delimited batches. */
export function parseOtlp(text: string): RawSpan[] {
  const batches: Batch[] = []
  const t = text.trim()
  if (t.startsWith('[')) batches.push(...(JSON.parse(t) as Batch[]))
  else {
    try {
      batches.push(JSON.parse(t) as Batch)
    } catch {
      for (const line of t.split('\n')) if (line.trim()) batches.push(JSON.parse(line) as Batch)
    }
  }
  const out: RawSpan[] = []
  for (const b of batches) {
    for (const rs of b.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) {
        const scope = ss.scope?.name ?? ''
        for (const s of ss.spans ?? []) {
          out.push({
            traceId: s.traceId ?? '',
            spanId: s.spanId ?? '',
            parentSpanId: s.parentSpanId ?? '',
            name: s.name ?? '',
            kind: s.kind ?? 0,
            startMs: nanosToMs(s.startTimeUnixNano),
            endMs: nanosToMs(s.endTimeUnixNano),
            statusCode: s.status?.code ?? 0,
            statusMessage: s.status?.message ?? '',
            scope,
            attrs: decodeAttrs(s.attributes),
          })
        }
      }
    }
  }
  return out
}
