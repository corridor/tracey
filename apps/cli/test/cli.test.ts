import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { main } from '../src/main'
import type { IO } from '../src/main'

const fx = (p: string) => fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url))

async function run(...argv: string[]) {
  return runWith({}, ...argv)
}

async function runWith(extra: Partial<IO>, ...argv: string[]) {
  let out = ''
  let err = ''
  const code = await main(argv, { out: (s) => (out += s), err: (s) => (err += s), color: false, ...extra })
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

describe('sessions and the picker', () => {
  const session = { source: 'claude-code' as const, path: fx('claude-code/session.jsonl'), title: 'Fix off-by-one', project: '/work/demo-app', mtimeMs: Date.UTC(2026, 0, 1, 12), size: 10 }

  it('lists sessions, as text and as json', async () => {
    const text = await runWith({ discover: async () => [session] }, 'sessions')
    expect(text.out).toContain('Fix off-by-one')
    expect(text.out).toContain('claude-code')
    const json = JSON.parse((await runWith({ discover: async () => [session] }, 'sessions', '--json')).out)
    expect(json[0].path).toBe(session.path)
  })

  it('with no arguments on a terminal, opens the session the user picks', async () => {
    const r = await runWith({ discover: async () => [session], pick: async (s) => s[0] })
    expect(r.code).toBe(0)
    expect(r.out).toContain('Claude Code transcript')
    expect(r.out).toContain('Bash failed')
  })

  it('does nothing and succeeds when the user quits the picker', async () => {
    const r = await runWith({ discover: async () => [session], pick: async () => undefined })
    expect(r).toEqual({ code: 0, out: '', err: '' })
  })

  it('says where it looked when there are no sessions', async () => {
    const r = await runWith({ discover: async () => [], pick: async () => undefined })
    expect(r.code).toBe(1)
    expect(r.out).toContain('~/.claude*')
  })

  it('without a terminal, no arguments prints the help', async () => {
    const r = await run()
    expect(r.out).toContain('Usage')
    expect(r.out).toContain('tracey sessions')
  })
})

describe('tracey diff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracey-diff-'))
  const original = fx('openinference/travel-planner.collector-file.jsonl')
  // A variant of the same run: the last failing search_flights call removed and one input changed.
  const batch = JSON.parse(readFileSync(original, 'utf8'))
  const spans = batch.resourceSpans[0].scopeSpans.flatMap((s: { spans: { name: string }[] }) => s.spans)
  const flights = spans.filter((s: { name: string }) => s.name === 'search_flights')
  const dropId = flights[flights.length - 1].spanId
  for (const ss of batch.resourceSpans[0].scopeSpans) ss.spans = ss.spans.filter((s: { spanId: string }) => s.spanId !== dropId)
  const variant = join(dir, 'variant.jsonl')
  writeFileSync(variant, JSON.stringify(batch))

  it('says there are no differences for a run against itself', async () => {
    const r = await run('diff', original, original)
    expect(r.code).toBe(0)
    expect(r.out).toContain('No differences')
    expect(r.out).not.toMatch(/^[+\-≠] /m)
  })

  it('lists what was removed, with the nesting and a summary', async () => {
    const r = await run('diff', original, variant)
    expect(r.code).toBe(0)
    expect(r.out).toContain('1 removed')
    expect(r.out).toMatch(/- search_flights\s+removed/)
    expect(r.out).toContain('16 spans')
    expect(r.out).toContain('15 spans')
  })

  it('shows added steps and new failures the other way round, and can fail CI on a regression', async () => {
    const r = await run('diff', variant, original, '--fail-on-regression')
    expect(r.out).toMatch(/\+ search_flights\s+added/)
    expect(r.out).toContain('1 new failure')
    expect(r.code).toBe(1)
    expect((await run('diff', original, variant, '--fail-on-regression')).code).toBe(0)
  })

  it('--all includes unchanged steps and --json is machine-readable', async () => {
    const all = await run('diff', original, variant, '--all')
    expect(all.out).toMatch(/= planner/)
    const j = JSON.parse((await run('diff', original, variant, '--json')).out)
    expect(j.summary.removed).toBe(1)
    expect(j.rows).toHaveLength(1)
    expect(j.rows[0]).toMatchObject({ state: 'removed', name: 'search_flights' })
  })

  it('explains bad usage and unreadable files', async () => {
    expect((await run('diff', original)).code).toBe(2)
    expect((await run('diff', original, '/nope.json')).code).toBe(2)
    expect((await run('diff', original, fx('claude-code/README.md'))).code).toBe(1)
  })
})
