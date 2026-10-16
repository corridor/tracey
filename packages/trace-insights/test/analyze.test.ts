import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SpanKind, SpanStatus, TraceBuilder } from '@ggx/trace-model'
import { parseTraceFile } from '@ggx/trace-adapters'
import { analyze, summarize } from '../src/index'

const fixture = (p: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url)), 'utf8')

describe('analyze on the travel-planner fixtures', () => {
  for (const f of ['openinference', 'otel-genai']) {
    it(`finds the failing, repeated and slow steps (${f})`, () => {
      const trace = parseTraceFile(fixture(`${f}/travel-planner.collector-file.jsonl`)).traces[0]!.trace
      const findings = analyze(trace)
      const rules = findings.map((x) => x.rule)
      expect(rules).toContain('failed-span')
      expect(rules).toContain('repeated-call')
      expect(findings[0]!.severity).toBe('error')
      const failed = findings.find((x) => x.rule === 'failed-span')!
      expect(trace.nameOf(failed.spans[0]!)).toMatch(/search_flights/)
      expect(summarize(trace, findings).firstError).toBe(failed)
    })
  }
})

describe('rules', () => {
  const t = (fn: (b: TraceBuilder) => void) => {
    const b = new TraceBuilder()
    fn(b)
    return b.build()
  }

  it('reports only the leaf of an error chain', () => {
    const trace = t((b) => {
      b.add({ id: 'a', name: 'agent', kind: SpanKind.Agent, start: 0, end: 10, status: SpanStatus.Error })
      b.add({ id: 'b', parentId: 'a', name: 'tool', kind: SpanKind.Tool, start: 1, end: 5, error: 'boom' })
    })
    const f = analyze(trace).filter((x) => x.rule === 'failed-span')
    expect(f).toHaveLength(1)
    expect(trace.nameOf(f[0]!.spans[0]!)).toBe('tool')
  })

  it('flags a swallowed error when the parent keeps going', () => {
    const trace = t((b) => {
      b.add({ id: 'a', name: 'agent', kind: SpanKind.Agent, start: 0, end: 100, status: SpanStatus.Ok })
      b.add({ id: 'b', parentId: 'a', name: 'lookup', kind: SpanKind.Tool, start: 1, end: 5, error: '404' })
      b.add({ id: 'c', parentId: 'a', name: 'answer', kind: SpanKind.Llm, start: 10, end: 90 })
    })
    expect(analyze(trace).map((x) => x.rule)).toContain('swallowed-error')
  })

  it('does not flag two identical calls as a loop', () => {
    const trace = t((b) => {
      for (let i = 0; i < 2; i++) b.add({ id: `s${i}`, name: 'search', kind: SpanKind.Tool, start: i, end: i + 1, input: 'q' })
    })
    expect(analyze(trace)).toEqual([])
  })

  it('handles an empty trace', () => {
    expect(analyze(new TraceBuilder().build())).toEqual([])
  })
})
