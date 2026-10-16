import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load } from '../src/load'
import { verdictText } from '../src/verdict'

const fixture = (p: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url)), 'utf8')

describe('verdictText', () => {
  it('names the first failure and when it happened', () => {
    const v = verdictText(load('s', fixture('openinference/travel-planner.collector-file.jsonl')))
    expect(v.tone).toBe('error')
    expect(v.text).toMatch(/^First failure: search_flights, \d+ms into the run$/)
  })

  it('says so plainly when there are only warnings or nothing', () => {
    const l = load('s', fixture('openinference/travel-planner.collector-file.jsonl'))
    const warnOnly = { ...l, summary: { ...l.summary, firstError: undefined, errors: 0, warnings: 2 } }
    expect(verdictText(warnOnly)).toEqual({ tone: 'warning', text: 'No failures, but 2 things are worth a look' })
    expect(verdictText({ ...warnOnly, summary: { ...warnOnly.summary, warnings: 0 } })).toEqual({ tone: 'ok', text: 'No problems found' })
  })
})
