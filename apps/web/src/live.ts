import { buildTraces, spansFromBody } from '@ggx/trace-adapters'
import type { RawSpan } from '@ggx/trace-adapters'
import { analyze, summarize } from '@ggx/trace-insights'
import type { Loaded } from './load'
import type { OtlpBatch } from './desktop'

const RUNNING_MS = 3000

/** Decode one request body the receiver handed over: base64, optionally gzip, then protobuf or JSON. */
export async function batchSpans(b: OtlpBatch): Promise<RawSpan[]> {
  let bytes = Uint8Array.from(atob(b.bodyB64), (c) => c.charCodeAt(0))
  if (b.encoding.includes('gzip')) {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  }
  return spansFromBody(bytes, b.contentType)
}

export interface LiveRun {
  id: string
  spans: number
  lastAt: number
  running: boolean
}

/** Runs received live, grouped by trace id. Pure data, so it is easy to test. */
export class LiveRuns {
  private readonly runs = new Map<string, { spans: RawSpan[]; lastAt: number }>()

  add(spans: RawSpan[], now = Date.now()): string[] {
    const touched = new Set<string>()
    for (const s of spans) {
      let r = this.runs.get(s.traceId)
      if (!r) this.runs.set(s.traceId, (r = { spans: [], lastAt: now }))
      r.spans.push(s)
      r.lastAt = now
      touched.add(s.traceId)
    }
    return [...touched]
  }

  list(now = Date.now()): LiveRun[] {
    return [...this.runs.entries()]
      .map(([id, r]) => ({ id, spans: r.spans.length, lastAt: r.lastAt, running: now - r.lastAt < RUNNING_MS }))
      .sort((a, b) => b.lastAt - a.lastAt)
  }

  clear(): void {
    this.runs.clear()
  }

  /** The run as a normal Loaded, so the same views render it. */
  loaded(id: string): Loaded | undefined {
    const r = this.runs.get(id)
    if (!r) return undefined
    const parsed = buildTraces(r.spans)
    const first = parsed.traces[0]
    if (!first) return undefined
    const findings = analyze(first.trace)
    return { name: `live ${id.slice(0, 8)}`, detection: parsed.detection, trace: first.trace, findings, summary: summarize(first.trace, findings), traceCount: 1 }
  }
}
