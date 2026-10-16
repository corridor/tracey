import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseOtlp } from '@ggx/trace-adapters'
import { LiveRuns, batchSpans } from '../src/live'

const fx = (p: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url)))
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

describe('batchSpans', () => {
  it('decodes protobuf, gzip and JSON bodies the shell passes over', async () => {
    const pb = fx('otlp-protobuf/sample.pb')
    expect(await batchSpans({ contentType: 'application/x-protobuf', encoding: '', bodyB64: b64(pb) })).toHaveLength(5)
    expect(await batchSpans({ contentType: 'application/x-protobuf', encoding: 'gzip', bodyB64: b64(gzipSync(pb)) })).toHaveLength(5)
    const json = fx('openinference/travel-planner.collector-file.jsonl')
    expect(await batchSpans({ contentType: 'application/json', encoding: '', bodyB64: b64(json) })).toHaveLength(16)
  })

  it('rejects a payload it cannot decode', async () => {
    await expect(batchSpans({ contentType: 'application/x-protobuf', encoding: '', bodyB64: b64(new Uint8Array([1, 2, 3, 250])) })).rejects.toThrow()
  })
})

describe('LiveRuns', () => {
  const spans = parseOtlp(fx('openinference/travel-planner.collector-file.jsonl').toString('utf8'))

  it('groups spans by trace and marks recent runs as running', () => {
    const live = new LiveRuns()
    const touched = live.add(spans, 1000)
    expect(touched).toHaveLength(1)
    expect(live.list(1500)).toEqual([{ id: touched[0], spans: 16, lastAt: 1000, running: true }])
    expect(live.list(10_000)[0]!.running).toBe(false)
  })

  it('builds a Loaded that grows as more spans arrive, newest run first', () => {
    const live = new LiveRuns()
    const half = Math.floor(spans.length / 2)
    const id = live.add(spans.slice(0, half), 1000)[0]!
    const before = live.loaded(id)!
    expect(before.trace.count).toBe(half)
    live.add(spans.slice(half), 2000)
    expect(live.loaded(id)!.trace.count).toBe(spans.length)
    live.add(parseOtlp(fx('otel-genai/travel-planner.collector-file.jsonl').toString('utf8')).map((s) => ({ ...s, traceId: 'ffff' })), 3000)
    expect(live.list(3100).map((r) => r.id)).toEqual(['ffff', id])
    expect(live.loaded('nope')).toBeUndefined()
    live.clear()
    expect(live.list()).toEqual([])
  })
})
