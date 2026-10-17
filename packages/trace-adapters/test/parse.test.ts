import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SpanKind, SpanStatus } from '@ggx/trace-model'
import { isoMs } from '../src/ggx'
import { decodeOtlpProtobuf, explainUnrecognised, parseTraceBytes, parseTraceFile, spansFromBody } from '../src/index'

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

describe('OTLP protobuf', () => {
  const bytes = () => new Uint8Array(readFileSync(fileURLToPath(new URL('../../../fixtures/otlp-protobuf/sample.pb', import.meta.url))))
  const expected = JSON.parse(fixture('otlp-protobuf/expected.json')) as { spanCount: number; names: string[]; errors: number }

  it('decodes a real exporter payload into the same trace as JSON would give', () => {
    const { detection, traces } = parseTraceBytes(bytes())
    expect(detection.source).toBe('openinference')
    expect(traces).toHaveLength(1)
    const t = traces[0]!.trace
    expect(t.count).toBe(expected.spanCount)
    expect(Array.from(t.order, (i) => t.nameOf(i)).sort()).toEqual([...expected.names].sort())
    expect(t.where(SpanStatus.Error)).toHaveLength(expected.errors)
    const err = t.where(SpanStatus.Error)[0]!
    expect(t.errors[err]).toBe('flight API timed out')
  })

  it('keeps types, unicode, kinds and token counts', () => {
    const t = parseTraceBytes(bytes()).traces[0]!.trace
    const llm = t.where((i) => t.isKind(i, SpanKind.Llm))[0]!
    expect(t.modelOf(llm)).toBe('gpt-4o-mini')
    expect(t.tokensIn[llm]).toBe(120)
    expect(t.tokensOut[llm]).toBe(30)
    expect(t.outputs[llm]).toContain('ünïcode ✓')
    const root = t.roots[0]!
    expect(t.attrs[root]).toMatchObject({ n: 42, ratio: 0.5, flag: true, list: ['a', 'b'], big: 2 ** 40 })
    expect(t.duration).toBeGreaterThan(0)
  })

  it('still reads JSON and text when given as bytes', () => {
    const text = new TextEncoder().encode(fixture('otel-genai/travel-planner.collector-file.jsonl'))
    expect(parseTraceBytes(text).detection.source).toBe('otel-genai')
  })

  it('returns unknown (not an exception) for truncated or random bytes', () => {
    expect(parseTraceBytes(bytes().subarray(0, 100)).traces.length).toBeLessThanOrEqual(1)
    expect(parseTraceBytes(new Uint8Array([1, 2, 3, 250, 250, 250])).traces).toHaveLength(0)
    expect(parseTraceBytes(new Uint8Array()).traces).toHaveLength(0)
  })

  it('decodes negative ints and nested lists', () => {
    // ExportTraceServiceRequest > ResourceSpans > ScopeSpans > Span with one int attribute = -5
    const varintNeg5 = [0xfb, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]
    const anyInt = [0x18, ...varintNeg5] // AnyValue.int_value
    const kv = [0x0a, 1, 0x6e, 0x12, anyInt.length, ...anyInt] // key "n", value
    const span = [0x2a, kv.length, ...kv] // Span.attributes (field 5? no: 9) fixed below
    const spanBody = [0x4a, kv.length, ...kv] // field 9, wire 2
    void span
    const scope = [0x12, spanBody.length, ...spanBody] // ScopeSpans.spans (field 2)
    const rs = [0x12, scope.length, ...scope] // ResourceSpans.scope_spans (field 2)
    const req = [0x0a, rs.length, ...rs] // request.resource_spans (field 1)
    const batch = decodeOtlpProtobuf(new Uint8Array(req))
    const attr = batch.resourceSpans![0]!.scopeSpans![0]!.spans![0]!['attributes'] as { key: string; value: { intValue: string } }[]
    expect(attr[0]).toEqual({ key: 'n', value: { intValue: '-5' } })
  })
})

describe('spansFromBody', () => {
  it('decodes protobuf and JSON request bodies into the same spans', () => {
    const pb = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../fixtures/otlp-protobuf/sample.pb', import.meta.url))))
    expect(spansFromBody(pb, 'application/x-protobuf')).toHaveLength(5)
    const json = new TextEncoder().encode(fixture('otel-genai/travel-planner.collector-file.jsonl'))
    expect(spansFromBody(json, 'application/json')).toHaveLength(16)
    expect(() => spansFromBody(new Uint8Array([1, 2, 3, 250]), 'application/x-protobuf')).toThrow()
  })
})

describe('isoMs', () => {
  it('keeps microseconds, honours explicit zones, and tolerates junk', () => {
    expect(isoMs('2026-01-01T00:00:00')).toBe(Date.UTC(2026, 0, 1))
    expect(isoMs('2026-01-01T00:00:00.123456')).toBeCloseTo(Date.UTC(2026, 0, 1) + 123.456, 3)
    expect(isoMs('2026-01-01T05:30:00+05:30')).toBe(Date.UTC(2026, 0, 1))
    expect(isoMs('2026-01-01T00:00:00.5Z')).toBe(Date.UTC(2026, 0, 1) + 500)
    expect(isoMs('nonsense')).toBe(0)
    expect(isoMs(undefined)).toBe(0)
  })
})

describe('explainUnrecognised', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const claudeHint = /~\/\.claude\/projects/

  it('recognises Claude Code prompt history and says it is not a session', () => {
    const history = enc('{"display":"fix it","pastedContents":{},"timestamp":1,"project":"/x"}\n{"display":"again","pastedContents":{},"timestamp":2,"project":"/x"}\n{"display":"more","pastedContents":{},"timestamp":3,"project":"/x"}\n')
    const m = explainUnrecognised(history, 'history.jsonl')
    expect(m).toContain('prompt history')
    expect(m).toMatch(claudeHint)
  })

  it('names the record types of unknown JSON lines, and the keys of unknown JSON', () => {
    const lines = enc('{"type":"foo","a":1}\n{"type":"bar","a":2}\n{"type":"foo","a":3}\n')
    expect(explainUnrecognised(lines)).toMatch(/record types foo, bar/)
    expect(explainUnrecognised(enc('{"alpha":1,"beta":2}'))).toMatch(/keys alpha, beta/)
    expect(explainUnrecognised(enc('[1,2,3]'))).toMatch(/array/)
    expect(explainUnrecognised(enc('{"cut off'))).toMatch(/cut off/)
  })

  it('handles empty files, plain-text logs and binary data without echoing content', () => {
    expect(explainUnrecognised(new Uint8Array())).toBe('This file is empty.')
    const log = explainUnrecognised(enc('2026-10-17 INFO secret-token-123 started\n2026-10-17 INFO ok\n'), 'main.log')
    expect(log).toContain('plain-text log')
    expect(log).toContain('main.log')
    expect(log).not.toContain('secret-token-123')
    expect(explainUnrecognised(new Uint8Array(Array.from({ length: 200 }, (_, i) => i % 7)))).toContain('binary')
  })
})

describe('GGX platform span export', () => {
  const smoke = fixture('ggx-platform/smoke.jsonl')

  it('reads the real export: detection, the CHAIN with its two LLM calls, models, tokens and times', () => {
    const { detection, traces } = parseTraceFile(smoke)
    expect(detection.source).toBe('ggx-platform')
    expect(detection.confidence).toBe('high')
    expect(traces).toHaveLength(1)
    const t = traces[0]!.trace
    expect(t.count).toBe(3)
    expect(t.roots).toHaveLength(1)
    expect(t.nameOf(t.roots[0]!)).toBe('answer_question')
    expect(t.isKind(t.roots[0]!, SpanKind.Chain)).toBe(true)
    const llm = t.where((i) => t.isKind(i, SpanKind.Llm))
    expect(llm.map((i) => t.modelOf(i)).sort()).toEqual(['claude-sonnet-4-5', 'gpt-4o-mini'])
    expect(t.totalTokens()).toEqual({ input: 420, output: 130 })
    expect(t.inputs[t.roots[0]!]).toBe('What is GGX?')
    expect(t.outputs[llm[0]!]).toBe('A governance platform.')
    expect(t.t0).toBeCloseTo(Date.parse('2026-10-16T04:00:21Z') + 66.064, 3) // naive ISO times are read as UTC, microseconds kept
    expect(t.duration).toBeCloseTo(0.079, 3)
    const [first, second] = t.where((i) => t.isKind(i, SpanKind.Llm))
    expect(t.start[second!]).toBeGreaterThan(t.start[first!]!) // order survives sub-millisecond gaps
  })

  it('maps status, error messages and parent links, from JSONL or a JSON array', () => {
    const rec = (id: string, parent: string | null, extra: object = {}) => ({
      trace_id: 't1', span_id: id, parent_span_id: parent, name: id, kind: 'TOOL', status: 'UNSET', status_message: null,
      start_time: '2026-10-16T04:00:00.000000', end_time: '2026-10-16T04:00:01.000000', document: { attributes: {}, resource: {}, events: [] }, ...extra,
    })
    const records = [rec('root', null, { kind: 'AGENT' }), rec('a', 'root', { status: 'ERROR', status_message: 'timed out' }), rec('b', 'root', { status: 'OK' })]
    for (const text of [records.map((r) => JSON.stringify(r)).join('\n'), JSON.stringify(records)]) {
      const t = parseTraceFile(text).traces[0]!.trace
      expect(t.count).toBe(3)
      expect(t.where(SpanStatus.Error).map((i) => t.nameOf(i))).toEqual(['a'])
      expect(t.errors[t.where(SpanStatus.Error)[0]!]).toBe('timed out')
      expect(t.where(SpanStatus.Ok).map((i) => t.nameOf(i))).toEqual(['b'])
      expect(t.children(t.roots[0]!)).toHaveLength(2)
    }
  })

  it('back-fills model and tokens from the flat columns when the document lacks them', () => {
    const line = JSON.stringify({ trace_id: 't', span_id: 's', name: 'call', kind: 'LLM', status: 'OK', start_time: '2026-10-16T04:00:00', end_time: '2026-10-16T04:00:02', model: 'm1', input_tokens: 7, output_tokens: 3, document: { attributes: {} } })
    const t = parseTraceFile(line).traces[0]!.trace
    expect(t.modelOf(0)).toBe('m1')
    expect(t.totalTokens()).toEqual({ input: 7, output: 3 })
    expect(t.spanDuration(0)).toBe(2000)
  })

  it('does not claim other formats, and works through parseTraceBytes', () => {
    expect(parseTraceFile(fixture('openinference/travel-planner.collector-file.jsonl')).detection.source).toBe('openinference')
    expect(parseTraceFile(fixture('claude-code/session.jsonl')).detection.source).toBe('claude-code')
    expect(parseTraceBytes(new TextEncoder().encode(smoke)).detection.source).toBe('ggx-platform')
  })
})
