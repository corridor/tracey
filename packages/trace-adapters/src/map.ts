import { SpanKind, SpanStatus } from '@ggx/trace-model'
import type { SpanInit } from '@ggx/trace-model'
import { scoreSpan } from './detect'
import type { SourceId } from './detect'
import type { RawSpan } from './otlp'

const str = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : typeof v === 'string' ? v : JSON.stringify(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const OI_KINDS: Record<string, SpanKind> = {
  LLM: SpanKind.Llm,
  TOOL: SpanKind.Tool,
  AGENT: SpanKind.Agent,
  CHAIN: SpanKind.Chain,
  RETRIEVER: SpanKind.Retrieval,
  RERANKER: SpanKind.Retrieval,
  EMBEDDING: SpanKind.Embedding,
}

const GENAI_KINDS: Record<string, SpanKind> = {
  chat: SpanKind.Llm,
  text_completion: SpanKind.Llm,
  generate_content: SpanKind.Llm,
  invoke_agent: SpanKind.Agent,
  create_agent: SpanKind.Agent,
  execute_tool: SpanKind.Tool,
  embeddings: SpanKind.Embedding,
  retrieval: SpanKind.Retrieval,
  invoke_workflow: SpanKind.Chain,
  plan: SpanKind.Chain,
}

/** OpenInference flattens message lists as `llm.input_messages.N.message.content`; rebuild a readable text. */
function flatMessages(a: Record<string, unknown>, prefix: string): string | undefined {
  const rows: string[] = []
  for (let i = 0; ; i++) {
    const role = a[`${prefix}.${i}.message.role`]
    const content = a[`${prefix}.${i}.message.content`]
    const calls = a[`${prefix}.${i}.message.tool_calls.0.tool_call.function.name`]
    if (role === undefined && content === undefined && calls === undefined) break
    rows.push(`${str(role) ?? '?'}: ${str(content) ?? (calls ? `[tool call ${str(calls)}]` : '')}`)
  }
  return rows.length ? rows.join('\n') : undefined
}

function legacyMessages(a: Record<string, unknown>, prefix: string): string | undefined {
  const rows: string[] = []
  for (let i = 0; ; i++) {
    const content = a[`${prefix}.${i}.content`]
    if (content === undefined) break
    rows.push(`${str(a[`${prefix}.${i}.role`]) ?? '?'}: ${str(content)}`)
  }
  return rows.length ? rows.join('\n') : undefined
}

function mapKindAndPayload(s: RawSpan, source: SourceId): Pick<SpanInit, 'kind' | 'model' | 'tokensIn' | 'tokensOut' | 'input' | 'output'> {
  const a = s.attrs
  if (source === 'openinference') {
    return {
      kind: OI_KINDS[str(a['openinference.span.kind']) ?? ''] ?? SpanKind.Other,
      model: str(a['llm.model_name']),
      tokensIn: num(a['llm.token_count.prompt']),
      tokensOut: num(a['llm.token_count.completion']),
      input: str(a['input.value']) ?? flatMessages(a, 'llm.input_messages'),
      output: str(a['output.value']) ?? flatMessages(a, 'llm.output_messages'),
    }
  }
  if (source === 'otel-genai') {
    const op = str(a['gen_ai.operation.name']) ?? ''
    return {
      kind: GENAI_KINDS[op] ?? SpanKind.Other,
      model: str(a['gen_ai.request.model']) ?? str(a['gen_ai.response.model']),
      tokensIn: num(a['gen_ai.usage.input_tokens']),
      tokensOut: num(a['gen_ai.usage.output_tokens']),
      input: str(a['gen_ai.input.messages']) ?? str(a['gen_ai.tool.call.arguments']),
      output: str(a['gen_ai.output.messages']) ?? str(a['gen_ai.tool.call.result']),
    }
  }
  if (source === 'openllmetry') {
    const type = str(a['llm.request.type'])
    return {
      kind: type ? SpanKind.Llm : SpanKind.Other,
      model: str(a['gen_ai.request.model']) ?? str(a['gen_ai.response.model']),
      tokensIn: num(a['gen_ai.usage.prompt_tokens']) ?? num(a['gen_ai.usage.input_tokens']),
      tokensOut: num(a['gen_ai.usage.completion_tokens']) ?? num(a['gen_ai.usage.output_tokens']),
      input: legacyMessages(a, 'gen_ai.prompt'),
      output: legacyMessages(a, 'gen_ai.completion'),
    }
  }
  return { kind: SpanKind.Other }
}

/**
 * Map one raw span. When the trace is mixed, each span is judged by its own attributes
 * (docs/format-detection.md: detection is per span).
 */
export function mapSpan(s: RawSpan, traceSource: SourceId, mixed: boolean): SpanInit {
  let source = traceSource
  if (mixed || source === 'unknown-otlp') {
    const best = scoreSpan(s).reduce((x, y) => (y.score > x.score ? y : x))
    if (best.score >= 0.5) source = best.source
  }
  const m = mapKindAndPayload(s, source)
  const isError = s.statusCode === 2
  return {
    id: s.spanId,
    parentId: s.parentSpanId || undefined,
    name: s.name,
    start: s.startMs,
    end: s.endMs,
    status: isError ? SpanStatus.Error : s.statusCode === 1 ? SpanStatus.Ok : SpanStatus.Unset,
    ...(isError ? { error: s.statusMessage || 'error' } : {}),
    ...m,
    attrs: s.attrs as SpanInit['attrs'],
  }
}
