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

describe('Claude Code transcripts', () => {
  const session = fixture('claude-code/session.jsonl')
  const sub = {
    text: fixture('claude-code/subagents/agent-a1b2c3d4e5f6a7b8c.jsonl'),
    meta: JSON.parse(fixture('claude-code/subagents/agent-a1b2c3d4e5f6a7b8c.meta.json')),
  }

  it('detects the transcript and reports its version', () => {
    const { detection } = parseTraceFile(session)
    expect(detection.source).toBe('claude-code')
    expect(detection.container).toBe('jsonl')
    expect(detection.candidates[0]!.evidence.join(' ')).toMatch(/version 2\.1\./)
  })

  it('builds turns, llm calls and tool calls, with the failing Bash call as an error', () => {
    const t = parseTraceFile(session).traces[0]!.trace
    const tools = t.where((i) => t.kind[i] === SpanKind.Tool).map((i) => t.nameOf(i))
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Bash', 'Edit']))
    const failed = t.where(SpanStatus.Error).map((i) => t.nameOf(i))
    expect(failed).toContain('Bash')
    expect(t.where((i) => t.isKind(i, SpanKind.Llm)).length).toBe(6)
  })

  it('counts tokens once per message id', () => {
    const t = parseTraceFile(session).traces[0]!.trace
    const llm = t.where((i) => t.isKind(i, SpanKind.Llm))
    expect(llm).toHaveLength(new Set(llm.map((i) => t.ids[i])).size)
  })

  it('nests the sub-agent under its Agent tool call when given its files', () => {
    const without = parseTraceFile(session).traces[0]!.trace
    const withSub = parseTraceFile(session, { claudeSubagents: [sub] }).traces[0]!.trace
    expect(withSub.count).toBeGreaterThan(without.count)
    const agentCall = withSub.where((i) => withSub.nameOf(i) === 'Agent')[0]!
    expect(withSub.isKind(agentCall, SpanKind.Agent)).toBe(true)
    expect(withSub.children(agentCall).length).toBeGreaterThan(0)
  })
})
