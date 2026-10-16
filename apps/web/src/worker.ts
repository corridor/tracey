/// <reference lib="webworker" />
import { parseTraceBytes } from '@ggx/trace-adapters'
import type { ClaudeSubagent } from '@ggx/trace-adapters'
import { analyze, summarize } from '@ggx/trace-insights'
import type { Detection } from '@ggx/trace-adapters'
import type { Finding, Summary } from '@ggx/trace-insights'
import type { TraceTransfer } from '@ggx/trace-model'

export interface WorkerRequest {
  name: string
  /** A dropped file (read here, off the main thread) or already-available text (paste, sample). */
  source: File | string
  /** Claude Code sub-agent files dropped with the session, read here too. */
  subagents?: { file: File; meta?: File }[]
}

export type WorkerResponse =
  | { ok: true; name: string; detection: Detection; trace: TraceTransfer; findings: Finding[]; summary: Summary; traceCount: number }
  | { ok: false; error: string }

const NOT_RECOGNISED =
  "This doesn't look like a trace tracey knows yet. Supported: OTLP JSON (OpenInference, OpenTelemetry GenAI, OpenLLMetry) and Claude Code transcripts."

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const src = e.data.source
    const bytes = typeof src === 'string' ? new TextEncoder().encode(src) : new Uint8Array(await src.arrayBuffer())
    const claudeSubagents: ClaudeSubagent[] = []
    for (const sub of e.data.subagents ?? []) {
      let meta: ClaudeSubagent['meta'] = {}
      try {
        if (sub.meta) meta = JSON.parse(await sub.meta.text())
      } catch {
        /* a broken meta file only loses the link to its parent call */
      }
      claudeSubagents.push({ text: await sub.file.text(), meta })
    }
    const parsed = parseTraceBytes(bytes, { claudeSubagents })
    const first = parsed.traces[0]
    if (!first) return post({ ok: false, error: NOT_RECOGNISED })
    const findings = analyze(first.trace)
    const { data, buffers } = first.trace.toTransfer()
    post(
      { ok: true, name: e.data.name, detection: parsed.detection, trace: data, findings, summary: summarize(first.trace, findings), traceCount: parsed.traces.length },
      buffers,
    )
  } catch (err) {
    post({ ok: false, error: `Could not read this file: ${err instanceof Error ? err.message : String(err)}` })
  }
}

function post(r: WorkerResponse, transfer: Transferable[] = []) {
  ;(self as unknown as Worker).postMessage(r, transfer)
}
