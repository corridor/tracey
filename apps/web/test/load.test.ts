import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load } from '../src/load'
import { compact, duration } from '../src/format'

const fixture = (p: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url)), 'utf8')

describe('load', () => {
  it('returns detection, findings and a summary for a known trace', () => {
    const l = load('sample', fixture('openinference/travel-planner.collector-file.jsonl'))
    expect(l.detection.source).toBe('openinference')
    expect(l.summary.spans).toBe(16)
    expect(l.summary.errors).toBe(1)
    expect(l.findings[0]!.title).toBe('search_flights failed 3×')
  })

  it('throws a readable message for text it cannot read', () => {
    expect(() => load('x', 'hello')).toThrow(/doesn't look like a trace/)
    expect(() => load('x', '')).toThrow()
  })
})

describe('format helpers', () => {
  it('formats durations and counts', () => {
    expect(duration(42)).toBe('42ms')
    expect(duration(1500)).toBe('1.5s')
    expect(duration(125_000)).toBe('2m 5s')
    expect(compact(868)).toBe('868')
    expect(compact(12_400)).toBe('12k')
  })
})
