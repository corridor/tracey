import { SpanKind, SpanStatus } from '@ggx/trace-model'
import type { SpanInit } from '@ggx/trace-model'

/** One Claude Code session file, plus optional sub-agent files (docs/verification/claude-code.md). */
export interface ClaudeSubagent {
  /** Contents of `agent-<id>.jsonl`. */
  text: string
  /** Parsed `agent-<id>.meta.json`; `toolUseId` links it to the parent's Agent tool call. */
  meta: { toolUseId?: string; description?: string; agentType?: string; model?: string }
}

interface Rec {
  type?: string
  subtype?: string
  uuid?: string
  timestamp?: string
  version?: string
  sessionId?: string
  isSidechain?: boolean
  isApiErrorMessage?: boolean
  isMeta?: boolean
  durationMs?: number
  aiTitle?: string
  message?: { id?: string; role?: string; model?: string; content?: unknown; stop_reason?: string | null; usage?: Usage }
}

interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface Block {
  type?: string
  id?: string
  name?: string
  input?: unknown
  text?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export function readJsonl(text: string): Rec[] {
  const out: Rec[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as Rec)
    } catch {
      /* a truncated last line is common in live sessions */
    }
  }
  return out
}

/** Cheap check over the head of a file: conversational records carry sessionId + uuid + a semver version. */
export function looksLikeClaudeCode(head: string): boolean {
  let hits = 0
  for (const line of head.split('\n', 50)) {
    if (!line.startsWith('{')) continue
    if (line.includes('"sessionId"') && line.includes('"uuid"') && /"version":\s*"\d+\.\d+\.\d+/.test(line)) hits++
  }
  return hits >= 1
}

const ms = (r: Rec): number => (r.timestamp ? Date.parse(r.timestamp) : NaN)
const text = (v: unknown): string =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.map((b: Block) => (typeof b === 'string' ? b : (b.text ?? ''))).join('') : v == null ? '' : JSON.stringify(v)
const blocks = (r: Rec): Block[] => (Array.isArray(r.message?.content) ? (r.message!.content as Block[]) : [])
const isPrompt = (r: Rec): boolean =>
  r.type === 'user' && !r.isMeta && (typeof r.message?.content === 'string' || blocks(r).some((b) => b.type === 'text'))

export interface ClaudeResult {
  spans: SpanInit[]
  version: string | undefined
  sessionId: string | undefined
}

/** Turn a session (and its sub-agents) into spans: session > turns > llm and tool calls. */
export function claudeCodeSpans(sessionText: string, subagents: ClaudeSubagent[] = []): ClaudeResult {
  const recs = readJsonl(sessionText)
  const byTool = new Map(subagents.filter((s) => s.meta.toolUseId).map((s) => [s.meta.toolUseId!, s]))
  const version = recs.find((r) => r.version)?.version
  const sessionId = recs.find((r) => r.sessionId)?.sessionId
  const spans: SpanInit[] = []
  const conv = recs.filter((r) => (r.type === 'user' || r.type === 'assistant' || r.type === 'system') && !Number.isNaN(ms(r)))
  if (conv.length === 0) return { spans, version, sessionId }
  const title = recs.find((r) => r.type === 'ai-title')?.aiTitle
  appendRun(spans, conv, `s:${sessionId ?? '0'}`, undefined, title ?? 'Claude Code session', byTool)
  return { spans, version, sessionId }
}

function appendRun(
  spans: SpanInit[],
  conv: Rec[],
  prefix: string,
  parentId: string | undefined,
  name: string,
  byTool: Map<string, ClaudeSubagent>,
): void {
  const rootId = `${prefix}:root`
  const t0 = ms(conv[0]!)
  const t1 = ms(conv[conv.length - 1]!)
  spans.push({ id: rootId, parentId, name, kind: SpanKind.Agent, start: t0, end: t1 })

  // Tool results by tool_use id.
  const results = new Map<string, { rec: Rec; block: Block }>()
  for (const r of conv) if (r.type === 'user') for (const b of blocks(r)) if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, { rec: r, block: b })

  // Turns: each prompt starts one; it runs until the next prompt (or the end).
  const starts: number[] = []
  conv.forEach((r, i) => isPrompt(r) && starts.push(i))
  if (starts.length === 0) starts.push(0)
  starts.forEach((si, n) => {
    const ei = (starts[n + 1] ?? conv.length) - 1
    const slice = conv.slice(si, ei + 1)
    const turnId = `${prefix}:turn${n}`
    const prompt = isPrompt(conv[si]!) ? text(conv[si]!.message?.content).trim().replace(/\s+/g, ' ') : 'turn'
    const dur = slice.find((r) => r.type === 'system' && r.subtype === 'turn_duration')?.durationMs
    const tStart = ms(slice[0]!)
    const lastTs = ms(slice[slice.length - 1]!)
    spans.push({
      id: turnId,
      parentId: rootId,
      name: prompt.length > 80 ? `${prompt.slice(0, 79)}…` : prompt || 'turn',
      kind: SpanKind.Agent,
      start: tStart,
      end: dur ? Math.max(lastTs, tStart + dur) : lastTs,
      input: prompt,
    })

    // LLM spans: group assistant records by message.id.
    const groups = new Map<string, { recs: Rec[]; prevTs: number }>()
    slice.forEach((r, j) => {
      if (r.type !== 'assistant') return
      const id = r.message?.id ?? r.uuid ?? `m${j}`
      const g = groups.get(id)
      if (g) g.recs.push(r)
      else groups.set(id, { recs: [r], prevTs: j > 0 ? ms(slice[j - 1]!) : ms(r) })
    })
    for (const [mid, g] of groups) {
      const first = g.recs[0]!
      const u = first.message?.usage
      const out = g.recs.flatMap(blocks).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
      const calls = g.recs.flatMap(blocks).filter((b) => b.type === 'tool_use').map((b) => b.name)
      const err = g.recs.some((r) => r.isApiErrorMessage)
      spans.push({
        id: `${prefix}:llm:${mid}`,
        parentId: turnId,
        name: first.message?.model ?? 'assistant',
        kind: SpanKind.Llm,
        start: Math.min(g.prevTs, ms(first)),
        end: ms(g.recs[g.recs.length - 1]!),
        ...(first.message?.model ? { model: first.message.model } : {}),
        tokensIn: (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
        tokensOut: u?.output_tokens ?? 0,
        output: out || (calls.length ? `[calls ${calls.join(', ')}]` : ''),
        ...(err ? { status: SpanStatus.Error, error: text(first.message?.content) || 'API error' } : {}),
      })
    }

    // Tool spans: tool_use to its tool_result.
    for (const r of slice) {
      if (r.type !== 'assistant') continue
      for (const b of blocks(r)) {
        if (b.type !== 'tool_use' || !b.id) continue
        const res = results.get(b.id)
        const start = ms(r)
        const end = res ? ms(res.rec) : start
        const failed = res?.block.is_error === true
        const sub = byTool.get(b.id)
        const id = `${prefix}:tool:${b.id}`
        spans.push({
          id,
          parentId: turnId,
          name: b.name ?? 'tool',
          kind: sub ? SpanKind.Agent : SpanKind.Tool,
          start,
          end: Math.max(end, start),
          input: JSON.stringify(b.input ?? {}),
          output: res ? text(res.block.content) : undefined,
          ...(failed ? { status: SpanStatus.Error, error: text(res!.block.content).slice(0, 300) || 'tool error' } : res ? { status: SpanStatus.Ok } : {}),
        })
        if (sub) {
          const subConv = readJsonl(sub.text).filter((x) => (x.type === 'user' || x.type === 'assistant' || x.type === 'system') && !Number.isNaN(ms(x)))
          if (subConv.length) appendRun(spans, subConv, `${prefix}:sub:${b.id}`, id, sub.meta.description ?? 'sub-agent', byTool)
        }
      }
    }
  })
}
