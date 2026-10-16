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

export function ago(mtimeMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - mtimeMs) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(mtimeMs).toISOString().slice(0, 10)
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function sessionLabel(s: { title?: string; project?: string; path: string }): string {
  if (s.title) return s.title
  const tail = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
  return s.project ? tail(s.project) : tail(s.path).replace(/\.jsonl$/, '')
}
