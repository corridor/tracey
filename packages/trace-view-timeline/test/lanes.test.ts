import { describe, expect, it } from 'vitest'
import { SpanKind, SpanStatus, TraceBuilder } from '@ggx/trace-model'
import { layoutStrip, visibleBars } from '../src/lanes'

describe('timeline strip', () => {
  it('keeps one bar per column for sub-pixel spans but never drops errors', () => {
    const b = new TraceBuilder()
    b.add({ id: 'r', name: 'root', kind: SpanKind.Agent, start: 0, end: 1_000_000 })
    for (let i = 0; i < 5000; i++) b.add({ id: `s${i}`, parentId: 'r', name: 't', kind: SpanKind.Tool, start: i * 100, end: i * 100 + 5 })
    b.add({ id: 'e', parentId: 'r', name: 'boom', kind: SpanKind.Tool, start: 500_000, end: 500_001, status: SpanStatus.Error })
    const t = b.build()
    const bars = visibleBars(t, layoutStrip(t), 600, (i) => t.status[i] === SpanStatus.Error)
    expect(bars.length).toBeLessThan(1500)
    expect(bars.some((x) => t.nameOf(x.index) === 'boom')).toBe(true)
  })

  it('assigns lanes by depth and caps them', () => {
    const b = new TraceBuilder()
    let parent: string | undefined
    for (let i = 0; i < 12; i++) {
      b.add({ id: `n${i}`, parentId: parent, name: 'n', start: i, end: 20 - i })
      parent = `n${i}`
    }
    const s = layoutStrip(b.build(), 6)
    expect(s.lanes).toBe(6)
  })
})
