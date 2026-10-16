import { describe, expect, it } from 'vitest'
import { SpanKind, SpanStatus, Trace, TraceBuilder } from '../src/index'

function sample() {
  const b = new TraceBuilder()
  // Added out of order: child before parent.
  b.add({ id: 'c', parentId: 'a', name: 'search', kind: SpanKind.Tool, start: 20, end: 50, error: '429', input: '{}' })
  b.add({ id: 'a', name: 'agent', kind: SpanKind.Agent, start: 0, end: 100 })
  b.add({ id: 'l', parentId: 'a', name: 'chat', kind: SpanKind.Llm, start: 5, end: 15, model: 'm', tokensIn: 10, tokensOut: 4 })
  return b.build()
}

describe('Trace', () => {
  it('resolves parents regardless of insertion order', () => {
    const t = sample()
    expect(t.count).toBe(3)
    expect(t.roots.length).toBe(1)
    expect(t.nameOf(t.roots[0]!)).toBe('agent')
  })

  it('orders depth-first with siblings by start time', () => {
    const t = sample()
    expect(Array.from(t.order, (i) => t.nameOf(i))).toEqual(['agent', 'chat', 'search'])
    expect(Array.from(t.order, (i) => t.depth[i])).toEqual([0, 1, 1])
  })

  it('marks spans with an error message as errors and reports duration', () => {
    const t = sample()
    expect(t.where(SpanStatus.Error).map((i) => t.nameOf(i))).toEqual(['search'])
    expect(t.duration).toBe(100)
  })

  it('computes self time excluding children', () => {
    const t = sample()
    const a = t.roots[0]!
    // children cover 5..15 and 20..50 = 40ms of 100ms
    expect(t.selfTime(a)).toBe(60)
  })

  it('sums tokens and interns models', () => {
    const t = sample()
    expect(t.totalTokens()).toEqual({ input: 10, output: 4 })
    expect(t.modelOf(t.where((i) => t.isKind(i, SpanKind.Llm))[0]!)).toBe('m')
  })

  it('survives parent cycles and self-parents', () => {
    const b = new TraceBuilder()
    b.add({ id: 'x', parentId: 'y', name: 'x', start: 0, end: 1 })
    b.add({ id: 'y', parentId: 'x', name: 'y', start: 0, end: 1 })
    b.add({ id: 'z', parentId: 'z', name: 'z', start: 0, end: 1 })
    const t = b.build()
    expect(t.order.length).toBe(3)
  })

  it('survives a structured clone (worker boundary) with identical contents', () => {
    const t = sample()
    const { data } = t.toTransfer()
    const back = Trace.fromTransfer(structuredClone(data))
    expect(back.count).toBe(t.count)
    expect(Array.from(back.order, (i) => back.nameOf(i))).toEqual(Array.from(t.order, (i) => t.nameOf(i)))
    expect(back.modelOf(back.where((i) => back.isKind(i, SpanKind.Llm))[0]!)).toBe('m')
    expect(back.duration).toBe(t.duration)
    expect(back.errors[back.where(SpanStatus.Error)[0]!]).toBe('429')
  })

  it('handles an empty trace', () => {
    const t = new TraceBuilder().build()
    expect(t.count).toBe(0)
    expect(t.duration).toBe(0)
  })
})
