import type { RawSpan } from './otlp'

export type SourceId = 'openinference' | 'otel-genai' | 'openllmetry' | 'claude-code' | 'unknown-otlp'

export interface Detection {
  container: 'otlp-json' | 'jsonl' | 'unknown'
  /** Best first. */
  candidates: { source: SourceId; score: number; evidence: string[] }[]
  source: SourceId
  confidence: 'high' | 'medium' | 'low'
  /** More than one convention is present in the same trace. */
  mixed: boolean
  sampled: number
}

type Rule = { test: (a: Record<string, unknown>, scope: string) => boolean; weight: number; label: string }

const has = (k: string) => (a: Record<string, unknown>) => k in a
const prefix = (p: string) => (a: Record<string, unknown>) => {
  for (const k in a) if (k.startsWith(p)) return true
  return false
}
const indexed = (p: string) => (a: Record<string, unknown>) => {
  for (const k in a) if (k.startsWith(p) && k.charCodeAt(p.length) >= 48 && k.charCodeAt(p.length) <= 57) return true
  return false
}

// Weights follow docs/verification/otel-openinference.md (1.0 is decisive).
const RULES: Record<Exclude<SourceId, 'unknown-otlp' | 'claude-code'>, Rule[]> = {
  openinference: [
    { label: 'openinference.span.kind', weight: 1, test: has('openinference.span.kind') },
    { label: 'llm.input_messages.*', weight: 0.5, test: prefix('llm.input_messages.') },
    { label: 'llm.output_messages.*', weight: 0.5, test: prefix('llm.output_messages.') },
    { label: 'llm.token_count.*', weight: 0.3, test: prefix('llm.token_count.') },
    { label: 'scope openinference.instrumentation.*', weight: 0.3, test: (_, s) => s.startsWith('openinference.instrumentation') },
  ],
  'otel-genai': [
    { label: 'gen_ai.operation.name', weight: 0.8, test: has('gen_ai.operation.name') },
    { label: 'gen_ai.provider.name', weight: 0.6, test: has('gen_ai.provider.name') },
    { label: 'gen_ai.input.messages', weight: 0.5, test: has('gen_ai.input.messages') },
    { label: 'gen_ai.output.messages', weight: 0.5, test: has('gen_ai.output.messages') },
    { label: 'gen_ai.usage.*', weight: 0.3, test: prefix('gen_ai.usage.') },
    { label: 'gen_ai.request.model', weight: 0.3, test: has('gen_ai.request.model') },
  ],
  openllmetry: [
    { label: 'gen_ai.prompt.N.*', weight: 0.9, test: indexed('gen_ai.prompt.') },
    { label: 'gen_ai.completion.N.*', weight: 0.9, test: indexed('gen_ai.completion.') },
    { label: 'llm.request.type', weight: 0.5, test: has('llm.request.type') },
    { label: 'traceloop.*', weight: 0.7, test: prefix('traceloop.') },
  ],
}

const SOURCES = Object.keys(RULES) as (keyof typeof RULES)[]

export function scoreSpan(s: RawSpan): { source: keyof typeof RULES; score: number; labels: string[] }[] {
  return SOURCES.map((source) => {
    let score = 0
    const labels: string[] = []
    for (const r of RULES[source]) {
      if (r.test(s.attrs, s.scope)) {
        score += r.weight
        labels.push(r.label)
      }
    }
    return { source, score: Math.min(score, 1), labels }
  })
}

/** Detect the convention used by OTLP spans from a sample (first, evenly spaced, and last spans). */
export function detectSpans(spans: RawSpan[], sampleSize = 64): Detection {
  const n = spans.length
  const step = Math.max(1, Math.floor(n / sampleSize))
  const sample: RawSpan[] = []
  for (let i = 0; i < n && sample.length < sampleSize; i += step) sample.push(spans[i]!)

  const totals = new Map<SourceId, { score: number; spans: number; evidence: Map<string, number> }>()
  for (const s of sample) {
    const scored = scoreSpan(s)
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
    if (best.score < 0.5) continue
    const t = totals.get(best.source) ?? { score: 0, spans: 0, evidence: new Map() }
    t.score += best.score
    t.spans++
    for (const l of best.labels) t.evidence.set(l, (t.evidence.get(l) ?? 0) + 1)
    totals.set(best.source, t)
  }

  const candidates = [...totals.entries()]
    .map(([source, t]) => ({
      source,
      score: t.score / sample.length,
      evidence: [...t.evidence.entries()].map(([l, c]) => `${l} on ${c}/${sample.length} sampled spans`),
    }))
    .sort((a, b) => b.score - a.score)

  const top = candidates[0]
  const source: SourceId = top ? top.source : 'unknown-otlp'
  const mixed = candidates.length > 1 && candidates[1]!.score >= 0.2
  const confidence = !top ? 'low' : top.score >= 0.6 && !mixed ? 'high' : top.score >= 0.3 ? 'medium' : 'low'
  return { container: 'otlp-json', candidates, source, confidence, mixed, sampled: sample.length }
}

export function unknownDetection(): Detection {
  return { container: 'unknown', candidates: [], source: 'unknown-otlp', confidence: 'low', mixed: false, sampled: 0 }
}

export function claudeCodeDetection(version: string | undefined): Detection {
  return {
    container: 'jsonl',
    candidates: [{ source: 'claude-code', score: 1, evidence: ['sessionId + uuid + semver version on conversation records', ...(version ? [`version ${version}`] : [])] }],
    source: 'claude-code',
    confidence: 'high',
    mixed: false,
    sampled: 0,
  }
}
