import { describe, expect, it } from 'vitest'
import { parseTraceFile } from '@ggx/trace-adapters'
import { analyze } from '../src/index'

// Budgets from docs/architecture.md, loosened for shared CI machines. A regression of the kind these catch
// (an accidental O(n^2)) is 10x or worse, so the slack does not hide it.
function otlp(n: number): string {
  const t0 = 1_700_000_000_000
  const spans = Array.from({ length: n }, (_, i) => ({
    traceId: 'a'.repeat(32),
    spanId: i.toString(16).padStart(16, '0'),
    parentSpanId: i === 0 ? '' : (i % 40 === 0 ? 0 : i - 1).toString(16).padStart(16, '0'),
    name: i === 0 ? 'agent' : `step ${i % 30}`,
    kind: 1,
    startTimeUnixNano: String((t0 + i * 3) * 1_000_000),
    endTimeUnixNano: String((t0 + i * 3 + 2) * 1_000_000),
    status: i % 5000 === 7 ? { code: 2, message: 'boom' } : {},
    attributes: [
      { key: 'openinference.span.kind', value: { stringValue: i === 0 ? 'AGENT' : i % 2 ? 'TOOL' : 'LLM' } },
      { key: 'input.value', value: { stringValue: `{"q":"${i % 50}"}` } },
    ],
  }))
  return JSON.stringify({ resourceSpans: [{ scopeSpans: [{ scope: { name: 'perf' }, spans }] }] })
}

describe('performance budgets', () => {
  it('reads, detects and analyses 50,000 spans in under 3 seconds', () => {
    const text = otlp(50_000)
    const t0 = performance.now()
    const { traces, detection } = parseTraceFile(text)
    const findings = analyze(traces[0]!.trace)
    const ms = performance.now() - t0
    expect(detection.source).toBe('openinference')
    expect(traces[0]!.trace.count).toBe(50_000)
    expect(findings.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(3000)
  })

  it('reads and analyses 100,000 spans in under 6 seconds, scaling roughly linearly', () => {
    const small = otlp(25_000)
    const big = otlp(100_000)
    const time = (text: string) => {
      const t0 = performance.now()
      analyze(parseTraceFile(text).traces[0]!.trace)
      return performance.now() - t0
    }
    time(small) // warm up the JIT so the ratio is not dominated by compilation
    const tSmall = time(small)
    const tBig = time(big)
    expect(tBig).toBeLessThan(6000)
    // 4x the spans should cost about 4x; an accidental O(n^2) would be 16x. Allow generous noise.
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(12)
  })
})
