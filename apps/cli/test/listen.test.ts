import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../src/main'
import { parseListenArgs, renderLive, startReceiver } from '../src/listen'
import type { Receiver } from '../src/listen'
import { style } from '../src/format'

const fx = (p: string) => fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url))
const bytes = (p: string) => readFileSync(fx(p))

const open: Receiver[] = []
afterEach(async () => {
  while (open.length) await open.pop()!.close()
})
async function start(extra: { save?: string } = {}) {
  const r = await startReceiver({ port: 0, host: '127.0.0.1', ...extra })
  open.push(r)
  return r
}
const post = (r: Receiver, path: string, body: Buffer | string, headers: Record<string, string>) =>
  fetch(`http://127.0.0.1:${r.port}${path}`, { method: 'POST', body, headers })

describe('receiver', () => {
  it('accepts OTLP JSON and answers like a collector', async () => {
    const r = await start()
    const res = await post(r, '/v1/traces', bytes('openinference/travel-planner.collector-file.jsonl'), { 'content-type': 'application/json' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect([...r.traces.values()].reduce((n, t) => n + t.spans.length, 0)).toBe(16)
  })

  it('accepts protobuf, including gzip, the way Python exporters send it', async () => {
    const r = await start()
    const pb = bytes('otlp-protobuf/sample.pb')
    expect((await post(r, '/v1/traces', pb, { 'content-type': 'application/x-protobuf' })).status).toBe(200)
    expect((await post(r, '/v1/traces', gzipSync(pb), { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' })).status).toBe(200)
    const [t] = [...r.traces.values()]
    expect(t!.spans).toHaveLength(10) // two posts of five spans, one trace id
    expect(r.traces.size).toBe(1)
  })

  it('rejects garbage with 400, unknown paths with 404, other methods with 405, and ignores metrics/logs', async () => {
    const r = await start()
    expect((await post(r, '/v1/traces', 'not json', { 'content-type': 'application/json' })).status).toBe(400)
    expect((await post(r, '/v1/traces', Buffer.from([1, 2, 3, 250, 250]), { 'content-type': 'application/x-protobuf' })).status).toBe(400)
    expect((await post(r, '/v1/traces', gzipSync('x').subarray(0, 5), { 'content-type': 'application/json', 'content-encoding': 'gzip' })).status).toBe(400)
    expect((await post(r, '/other', '{}', { 'content-type': 'application/json' })).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${r.port}/v1/traces`, { method: 'PUT' })).status).toBe(405)
    expect((await post(r, '/v1/metrics', '{}', { 'content-type': 'application/json' })).status).toBe(200)
    expect((await post(r, '/v1/logs', Buffer.from([]), { 'content-type': 'application/x-protobuf' })).status).toBe(200)
    expect(r.traces.size).toBe(0)
    expect(await (await fetch(`http://127.0.0.1:${r.port}/`)).text()).toContain('tracey is listening')
  })

  it('joins batches of one trace and saves them as lines tracey can read back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracey-listen-'))
    const save = join(dir, 'saved.jsonl')
    try {
      const r = await start({ save })
      await post(r, '/v1/traces', bytes('otlp-protobuf/sample.pb'), { 'content-type': 'application/x-protobuf' })
      await post(r, '/v1/traces', bytes('otel-genai/travel-planner.collector-file.jsonl'), { 'content-type': 'application/json' })
      const lines = readFileSync(save, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(2)
      let out = ''
      expect(await main([save], { out: (s) => (out += s), err: () => {}, color: false })).toBe(0)
      expect(out).toContain('trace ')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('shows what it is waiting for, then runs and findings once spans arrive', async () => {
    const r = await start()
    const st = style(false)
    expect(renderLive(r, st).join('\n')).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
    await post(r, '/v1/traces', bytes('openinference/travel-planner.collector-file.jsonl'), { 'content-type': 'application/json' })
    const live = renderLive(r, st, Date.now())
    const text = live.join('\n')
    expect(text).toContain('running')
    expect(text).toContain('16 spans')
    expect(text).toContain('search_flights failed 3×')
    expect(renderLive(r, st, Date.now() + 60_000).join('\n')).toContain('idle')
  })
})

describe('tracey listen', () => {
  it('parses options and rejects a bad port', () => {
    expect(parseListenArgs([])).toEqual({ port: 4318, host: '127.0.0.1' })
    expect(parseListenArgs(['--port', '9000', '--save=x.jsonl', '--host', '0.0.0.0'])).toEqual({ port: 9000, host: '0.0.0.0', save: 'x.jsonl' })
    expect(parseListenArgs(['--port', 'abc'])).toEqual({ error: 'invalid --port abc' })
    expect(parseListenArgs(['--port=70000'])).toEqual({ error: 'invalid --port 70000' })
  })

  it('runs until stopped, then prints a report for each trace it saw', async () => {
    let out = ''
    let err = ''
    let stop!: () => void
    const stopped = new Promise<void>((r) => (stop = r))
    const code = main(['listen', '--port', '0'], {
      out: (s) => (out += s),
      err: (s) => (err += s),
      color: false,
      listen: {
        stop: stopped,
        ready: async (r) => {
          await post(r, '/v1/traces', bytes('openinference/travel-planner.collector-file.jsonl'), { 'content-type': 'application/json' })
          stop()
        },
      },
    })
    expect(await code).toBe(0)
    expect(err).toBe('')
    expect(out).toContain('tracey listen: http://127.0.0.1:')
    expect(out).toMatch(/\+ trace \w{8}: 16 spans so far/)
    expect(out).toContain('search_flights failed 3×')
  })

  it('says so plainly when the port is taken, and warns when listening beyond localhost', async () => {
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const port = (blocker.address() as { port: number }).port
    let err = ''
    const code = await main(['listen', '--port', String(port)], { out: () => {}, err: (s) => (err += s), color: false })
    blocker.close()
    expect(code).toBe(2)
    expect(err).toContain(`port ${port} is already in use`)

    err = ''
    await main(['listen', '--port', '0', '--host', '0.0.0.0'], {
      out: () => {},
      err: (s) => (err += s),
      color: false,
      listen: { stop: Promise.resolve() },
    })
    expect(err).toContain('other machines can send')
  })
})
