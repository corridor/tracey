import { describe, expect, it } from 'vitest'
import { SpanKind, TraceBuilder } from '@ggx/trace-model'
import { layoutTree } from '../src/layout'

function tree() {
  const b = new TraceBuilder()
  b.add({ id: 'r', name: 'root', kind: SpanKind.Agent, start: 0, end: 10 })
  b.add({ id: 'a', parentId: 'r', name: 'a', start: 1, end: 3 })
  b.add({ id: 'b', parentId: 'r', name: 'b', start: 4, end: 9 })
  b.add({ id: 'b1', parentId: 'b', name: 'b1', start: 5, end: 6 })
  b.add({ id: 'b2', parentId: 'b', name: 'b2', start: 7, end: 8 })
  return b.build()
}

describe('layoutTree', () => {
  it('puts depth in columns and centres parents on their children', () => {
    const t = tree()
    const L = layoutTree(t)
    const at = (name: string) => [...Array(t.count).keys()].find((i) => t.nameOf(i) === name)!
    expect(L.x[at('root')]).toBe(0)
    expect(L.x[at('b1')]).toBe(2 * (L.nodeW + 44))
    // leaves: a, b1, b2 take rows 0,1,2; b centres on b1/b2 (1.5); root on a and b (0.75)
    expect(L.y[at('b')]).toBeCloseTo(1.5 * 40)
    expect(L.y[at('root')]).toBeCloseTo(((0 + 1.5) / 2) * 40)
  })

  it('never overlaps two nodes in the same column', () => {
    const t = tree()
    const L = layoutTree(t)
    for (let i = 0; i < t.count; i++)
      for (let j = i + 1; j < t.count; j++)
        if (L.x[i] === L.x[j]) expect(Math.abs(L.y[i]! - L.y[j]!)).toBeGreaterThanOrEqual(L.nodeH)
  })

  it('handles 50k spans quickly and an empty trace', () => {
    const b = new TraceBuilder()
    b.add({ id: 'r', name: 'root', start: 0, end: 1 })
    for (let i = 0; i < 50_000; i++) b.add({ id: `s${i}`, parentId: i % 7 === 0 ? 'r' : `s${i - 1}`, name: 'n', start: i, end: i + 1 })
    const t0 = performance.now()
    const L = layoutTree(b.build())
    expect(performance.now() - t0).toBeLessThan(500)
    expect(L.height).toBeGreaterThan(0)
    expect(layoutTree(new TraceBuilder().build()).width).toBe(0)
  })
})
