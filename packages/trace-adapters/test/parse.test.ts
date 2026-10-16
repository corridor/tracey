import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SpanKind, SpanStatus } from '@ggx/trace-model'
import { parseTraceFile } from '../src/index'

const fixture = (p: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url)), 'utf8')

describe('parseTraceFile', () => {
  it('detects and reads OpenInference', () => {
    const { detection, traces } = parseTraceFile(fixture('openinference/travel-planner.collector-file.jsonl'))
    expect(detection.source).toBe('openinference')
    expect(detection.confidence).toBe('high')
    expect(traces).toHaveLength(1)
    const t = traces[0]!.trace
    expect(t.count).toBe(16)
    expect(t.where(SpanStatus.Error).map((i) => t.nameOf(i))).toContain('search_flights')
    expect(t.where((i) => t.isKind(i, SpanKind.Agent)).length).toBeGreaterThanOrEqual(2)
    expect(t.where((i) => t.isKind(i, SpanKind.Tool)).length).toBeGreaterThan(2)
    expect(t.where((i) => t.isKind(i, SpanKind.Llm)).length).toBeGreaterThan(0)
  })

  it('detects and reads OTel GenAI', () => {
    const { detection, traces } = parseTraceFile(fixture('otel-genai/travel-planner.collector-file.jsonl'))
    expect(detection.source).toBe('otel-genai')
    const t = traces[0]!.trace
    expect(t.count).toBe(16)
    expect(t.where((i) => t.isKind(i, SpanKind.Tool)).length).toBeGreaterThan(2)
    const llm = t.where((i) => t.isKind(i, SpanKind.Llm))[0]!
    expect(t.tokensIn[llm]).toBeGreaterThan(0)
    expect(t.modelOf(llm)).toBe('gpt-4o-mini')
  })

  it('joins one trace split across several batch lines', () => {
    const { traces } = parseTraceFile(fixture('otel-genai/travel-planner-batched.collector-file.jsonl'))
    expect(traces).toHaveLength(1)
    expect(traces[0]!.trace.count).toBe(16)
  })

  it('returns unknown for non-OTLP text', () => {
    const r = parseTraceFile('{"hello":"world"}')
    expect(r.detection.container).toBe('unknown')
    expect(r.traces).toHaveLength(0)
  })
})
