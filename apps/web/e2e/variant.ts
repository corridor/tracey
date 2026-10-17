import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const ORIGINAL = fileURLToPath(new URL('../../../fixtures/openinference/travel-planner.collector-file.jsonl', import.meta.url))

/** The same run, edited: the last failing search_flights call removed, and the weather lookup asks for Rome. */
export function variant(): Buffer {
  const batch = JSON.parse(readFileSync(ORIGINAL, 'utf8'))
  const scope = batch.resourceSpans[0].scopeSpans
  const all = scope.flatMap((s: { spans: { name: string; spanId: string }[] }) => s.spans)
  const lastFlight = all.filter((s: { name: string }) => s.name === 'search_flights').at(-1).spanId
  for (const ss of scope) {
    ss.spans = ss.spans.filter((s: { spanId: string }) => s.spanId !== lastFlight)
    for (const s of ss.spans) {
      if (s.name !== 'get_weather') continue
      for (const a of s.attributes) if (a.key === 'input.value') a.value.stringValue = a.value.stringValue.replace('Paris', 'Rome')
    }
  }
  return Buffer.from(JSON.stringify(batch))
}
