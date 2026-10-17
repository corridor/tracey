import { SpanKind } from '@ggx/trace-model'
import type { Trace } from '@ggx/trace-model'
import type { Detection } from '@ggx/trace-adapters'
import type { Finding, Summary } from '@ggx/trace-insights'

export interface Style {
  red: (s: string) => string
  orange: (s: string) => string
  green: (s: string) => string
  blue: (s: string) => string
  dim: (s: string) => string
  bold: (s: string) => string
}

export function style(color: boolean): Style {
  const wrap = (open: string) => (s: string) => (color ? `\u001b[${open}m${s}\u001b[0m` : s)
  return { red: wrap('31'), orange: wrap('33'), green: wrap('32'), blue: wrap('36'), dim: wrap('2'), bold: wrap('1') }
}

export const SOURCE_NAMES: Record<string, string> = {
  openinference: 'OpenInference',
  'otel-genai': 'OpenTelemetry GenAI',
  openllmetry: 'OpenLLMetry',
  'claude-code': 'Claude Code transcript',
  'ggx-platform': 'GGX platform export',
  'unknown-otlp': 'OpenTelemetry (unrecognised convention)',
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}

export function detectionLines(d: Detection, st: Style): string[] {
  const lines = [`${st.green('✓')} ${st.bold(SOURCE_NAMES[d.source] ?? d.source)} ${st.dim(`(${d.confidence} confidence${d.mixed ? ', mixed conventions' : ''})`)}`]
  const top = d.candidates[0]
  if (top) for (const e of top.evidence) lines.push(`  ${st.dim(e)}`)
  return lines
}

export function summaryLine(t: Trace, s: Summary, st: Style): string {
  const llm = t.where((i) => t.kind[i] === SpanKind.Llm).length
  const tool = t.where((i) => t.kind[i] === SpanKind.Tool).length
  const tokens = s.tokensIn + s.tokensOut
  return [`${s.spans} spans`, duration(s.durationMs), `${llm} llm`, `${tool} tool`, ...(tokens ? [`${compact(tokens)} tokens`] : [])].join(st.dim(' · '))
}

const ICON: Record<Finding['severity'], string> = { error: '✕', warning: '▲', info: '·' }

export function findingLines(t: Trace, f: Finding[], st: Style): string[] {
  if (f.length === 0) return [`${st.green('✓')} No problems found`]
  const paint = { error: st.red, warning: st.orange, info: st.dim }
  return f.flatMap((x) => {
    const at = x.spans.length === 1 ? `${st.dim(`  +${duration(t.start[x.spans[0]!]! - t.t0)}`)}` : ''
    const head = `${paint[x.severity](ICON[x.severity])} ${x.title}${at}`
    return x.detail ? [head, `  ${st.dim(x.detail)}`] : [head]
  })
}
