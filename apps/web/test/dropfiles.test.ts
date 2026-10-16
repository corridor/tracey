import { describe, expect, it } from 'vitest'
import { planDrop } from '../src/dropfiles'
import type { DroppedFile } from '../src/dropfiles'

const f = (path: string, modified = 0, body = '{}'): DroppedFile => ({ path, file: new File([body], path.split('/').pop()!, { lastModified: modified }) })

describe('planDrop', () => {
  it('pairs a Claude session with its sub-agent files and metadata', () => {
    const plan = planDrop([
      f('abc.jsonl', 5),
      f('abc/subagents/agent-1.jsonl'),
      f('abc/subagents/agent-1.meta.json'),
      f('abc/subagents/agent-2.jsonl'),
    ])!
    expect(plan.main.name).toBe('abc.jsonl')
    expect(plan.subagents.map((s) => [s.file.name, s.meta?.name])).toEqual([
      ['agent-1.jsonl', 'agent-1.meta.json'],
      ['agent-2.jsonl', undefined],
    ])
  })

  it('never treats a sub-agent file as the main trace, even when it is the newest', () => {
    const plan = planDrop([f('abc.jsonl', 1), f('abc/subagents/agent-1.jsonl', 99)])!
    expect(plan.main.name).toBe('abc.jsonl')
  })

  it('recognises loose sub-agent files dropped next to the session, without their folder', () => {
    const plan = planDrop([f('abc.jsonl'), f('agent-9.jsonl'), f('agent-9.meta.json')])!
    expect(plan.main.name).toBe('abc.jsonl')
    expect(plan.subagents).toHaveLength(1)
    expect(plan.subagents[0]!.meta?.name).toBe('agent-9.meta.json')
  })

  it('picks the newest candidate when a whole project folder is dropped', () => {
    const plan = planDrop([f('proj/old.jsonl', 1), f('proj/new.jsonl', 9), f('proj/readme.md', 99)])!
    expect(plan.main.name).toBe('new.jsonl')
  })

  it('accepts protobuf and plain JSON, and a single arbitrary file', () => {
    expect(planDrop([f('run.pb')])!.main.name).toBe('run.pb')
    expect(planDrop([f('traces.json')])!.main.name).toBe('traces.json')
    expect(planDrop([f('notes.txt')])!.main.name).toBe('notes.txt') // unknown types still get tried
  })

  it('returns nothing when only sub-agent files or nothing was dropped', () => {
    expect(planDrop([])).toBeUndefined()
    expect(planDrop([f('abc/subagents/agent-1.jsonl')])).toBeUndefined()
  })
})
