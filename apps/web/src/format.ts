export const SOURCE_NAMES: Record<string, string> = {
  openinference: 'OpenInference',
  'otel-genai': 'OpenTelemetry GenAI',
  openllmetry: 'OpenLLMetry',
  'claude-code': 'Claude Code',
  'unknown-otlp': 'OpenTelemetry',
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}
