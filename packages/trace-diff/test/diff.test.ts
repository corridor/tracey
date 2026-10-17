import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SpanKind, SpanStatus, TraceBuilder } from '@ggx/trace-model'
import type { SpanInit } from '@ggx/trace-model'
import { parseTraceFile } from '@ggx/trace-adapters'
import { countChanges, describeSummary, diffText, diffTraces, prettyIfJson } from '../src/index'

const fixture = (p: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url)), 'utf8')

const run = (spans: SpanInit[]) => {
  const b = new TraceBuilder()
  spans.forEach((s) => b.add(s))
  return b.build()
}
const agent = (over: Partial<SpanInit> = {}): SpanInit => ({ id: 'r', name: 'agent', kind: SpanKind.Agent, start: 0, end: 1000, ...over })
const tool = (id: string, name: string, start: number, end: number, over: Partial<SpanInit> = {}): SpanInit => ({ id, parentId: 'r', name, kind: SpanKind.Tool, start, end, ...over })

describe('diffTraces', () => {
  it('reports no differences for a run compared with itself', () => {
    const t = parseTraceFile(fixture('openinference/travel-planner.collector-file.jsonl')).traces[0]!.trace
    const d = diffTraces(t, t)
    expect(d.summary).toMatchObject({ added: 0, removed: 0, changed: 0, same: t.count })
    expect(d.rows).toHaveLength(t.count)
    expect(describeSummary(d.summary)).toBe('No differences')
  })

  it('finds an added retry, a removed step and changed input in order', () => {
    const a = run([agent(), tool('1', 'search', 10, 50, { input: 'q1' }), tool('2', 'fetch', 60, 90), tool('3', 'answer', 100, 200)])
    const b = run([agent(), tool('1', 'search', 10, 50, { input: 'q2' }), tool('1b', 'search', 55, 80), tool('3', 'answer', 100, 200)])
    const d = diffTraces(a, b)
    const names = d.rows.map((r) => `${r.state}:${(r.a >= 0 ? a : b).nameOf(r.a >= 0 ? r.a : r.b)}`)
    expect(names).toEqual(['same:agent', 'changed:search', 'removed:fetch', 'added:search', 'same:answer'])
    expect(d.rows[1]!.reasons).toEqual(['input'])
    expect(d.summary).toMatchObject({ added: 1, removed: 1, changed: 1, same: 2 })
  })

  it('flags new failures, fixes, and meaningful slowdowns but ignores noise', () => {
    const a = run([agent(), tool('1', 'lookup', 0, 50), tool('2', 'save', 60, 100, { error: 'disk full' }), tool('3', 'think', 110, 120), tool('4', 'render', 130, 1130)])
    const b = run([agent(), tool('1', 'lookup', 0, 50, { error: '404' }), tool('2', 'save', 60, 100), tool('3', 'think', 110, 150), tool('4', 'render', 130, 3130)])
    const d = diffTraces(a, b)
    const byName = Object.fromEntries(d.rows.map((r) => [a.nameOf(r.a), r.reasons]))
    expect(byName['lookup']).toContain('failed')
    expect(byName['save']).toContain('fixed')
    expect(byName['think']).toEqual([]) // 10ms -> 40ms is 4x but only 30ms: noise
    expect(byName['render']).toContain('slower')
    expect(d.summary).toMatchObject({ newFailures: 1, fixed: 1, slower: 1 })
    expect(describeSummary(d.summary)).toBe('3 changed (1 new failure, 1 fixed, 1 slower)')
  })

  it('treats a whole new or removed subtree as added or removed, and counts a failing added step', () => {
    const a = run([agent()])
    const b = run([agent(), tool('s', 'sub-agent', 10, 90), { id: 'c', parentId: 's', name: 'inner', kind: SpanKind.Tool, start: 20, end: 40, status: SpanStatus.Error, error: 'x' }])
    const d = diffTraces(a, b)
    expect(d.rows.map((r) => [r.state, r.depth])).toEqual([['same', 0], ['added', 1], ['added', 2]])
    expect(d.summary).toMatchObject({ added: 2, newFailures: 1 })
    const reverse = diffTraces(b, a)
    expect(reverse.summary).toMatchObject({ removed: 2, fixed: 1 })
  })

  it('aligns repeated calls by order and keeps nesting depth', () => {
    const a = run([agent(), tool('1', 'search', 0, 10), tool('2', 'search', 20, 30), tool('3', 'search', 40, 50)])
    const b = run([agent(), tool('1', 'search', 0, 10), tool('3', 'search', 40, 50)])
    const d = diffTraces(a, b)
    expect(d.summary).toMatchObject({ removed: 1, same: 3 })
    expect(d.rows.every((r) => r.depth <= 1)).toBe(true)
  })

  it('does not stall on empty or very large traces', () => {
    expect(diffTraces(run([]), run([])).rows).toEqual([])
    const big = (n: number, drop: number) => run([agent(), ...Array.from({ length: n }, (_, i) => tool(`t${i}`, `step ${i % 20}`, i, i + 1)).filter((_, i) => i % drop !== 0)])
    const t0 = performance.now()
    const d = diffTraces(big(20_000, 1000), big(20_000, 999_999))
    expect(performance.now() - t0).toBeLessThan(3000)
    expect(d.summary.added).toBeGreaterThan(0)
  })
})

describe('text diff', () => {
  it('shows added, removed and unchanged lines', () => {
    const d = diffText('a\nb\nc', 'a\nX\nc\nd')
    expect(d.map((c) => `${c.type}:${c.text}`)).toEqual(['same:a', 'del:b', 'add:X', 'same:c', 'add:d'])
    expect(countChanges(d)).toEqual({ added: 2, removed: 1 })
  })

  it('handles identical, empty and one-sided text', () => {
    expect(diffText('x', 'x')).toEqual([{ type: 'same', text: 'x' }])
    expect(diffText('', '')).toEqual([])
    expect(diffText('', 'a')).toEqual([{ type: 'add', text: 'a' }])
    expect(diffText('a', '')).toEqual([{ type: 'del', text: 'a' }])
  })

  it('pretty-prints JSON so a one-line change is one line in the diff', () => {
    const a = prettyIfJson('{"q":"paris","k":5}')
    const b = prettyIfJson('{"q":"rome","k":5}')
    const d = diffText(a, b)
    expect(countChanges(d)).toEqual({ added: 1, removed: 1 })
    expect(prettyIfJson('not json')).toBe('not json')
  })
})
