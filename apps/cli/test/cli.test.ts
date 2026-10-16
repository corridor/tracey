import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { main } from '../src/main'

const fx = (p: string) => fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url))

async function run(...argv: string[]) {
  let out = ''
  let err = ''
  const code = await main(argv, { out: (s) => (out += s), err: (s) => (err += s), color: false })
  return { code, out, err }
}

describe('tracey cli', () => {
  it('prints detection, a summary and findings for a trace', async () => {
    const r = await run(fx('openinference/travel-planner.collector-file.jsonl'))
    expect(r.code).toBe(0)
    expect(r.out).toContain('OpenInference')
    expect(r.out).toContain('16 spans')
    expect(r.out).toContain('search_flights failed')
    expect(r.out).toMatch(/called 3× with the same input/)
  })

  it('reads a Claude Code session and finds its sub-agent only when files sit next to it', async () => {
    const r = await run(fx('claude-code/session.jsonl'))
    expect(r.out).toContain('Claude Code transcript')
    expect(r.out).toContain('Bash failed')
  })

  it('detect prints only the source', async () => {
    const r = await run('detect', fx('otel-genai/travel-planner.collector-file.jsonl'))
    expect(r.out).toContain('OpenTelemetry GenAI')
    expect(r.out).not.toContain('tokens')
    expect(r.out).not.toContain('failed')
  })

  it('check fails on errors and passes with --fail-on set above them', async () => {
    const f = fx('openinference/travel-planner.collector-file.jsonl')
    expect((await run('check', f)).code).toBe(1)
    expect((await run('check', f, '--fail-on', 'warning')).code).toBe(1)
  })

  it('emits json', async () => {
    const r = await run(fx('openinference/travel-planner.collector-file.jsonl'), '--json')
    const j = JSON.parse(r.out)
    expect(j.detection.source).toBe('openinference')
    expect(j.traces[0].findings[0].rule).toBe('failed-span')
  })

  it('reports unreadable and unrecognised files', async () => {
    expect((await run('/nope.json')).code).toBe(2)
    expect((await run(fx('claude-code/README.md'))).code).toBe(1)
  })
})
