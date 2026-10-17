import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main, nameFromUrl } from '../src/main'
import { isUrl, maybeGunzip } from '../src/input'

const fx = (p: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url)))
const OI = fx('openinference/travel-planner.collector-file.jsonl')
const PB = fx('otlp-protobuf/sample.pb')

let server: Server
let base: string
let tmp: string
const seen: { path: string; auth?: string }[] = []

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'tracey-url-'))
  server = createServer((req, res) => {
    const path = req.url ?? '/'
    seen.push({ path, auth: req.headers.authorization as string | undefined })
    const send = (status: number, body: Buffer | string, type: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': type, ...extra })
      res.end(body)
    }
    if (path === '/run.jsonl') return send(200, OI, 'application/json')
    if (path === '/run.pb') return send(200, PB, 'application/x-protobuf')
    if (path === '/run.jsonl.gz') return send(200, gzipSync(OI), 'application/gzip')
    if (path === '/encoded') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
      return res.end(gzipSync(OI))
    }
    if (path === '/old') return send(302, '', 'text/plain', { location: '/run.jsonl' })
    if (path === '/private.jsonl') return req.headers.authorization === 'Bearer sekret' ? send(200, OI, 'application/json') : send(401, 'no', 'text/plain')
    if (path === '/forbidden') return send(403, 'no', 'text/plain')
    if (path === '/page') return send(200, '<!doctype html><html><body>Sign in</body></html>', 'text/html')
    if (path === '/huge') return send(200, 'x', 'application/json', { 'content-length': String(500 * 1024 * 1024) })
    if (path === '/stream') {
      res.writeHead(200, { 'content-type': 'application/json' })
      const chunk = Buffer.alloc(256 * 1024, 0x20)
      let n = 0
      const t = setInterval(() => (res.write(chunk), ++n > 20 && (clearInterval(t), res.end())), 1)
      return
    }
    if (path === '/hang') return void 0
    if (path === '/boom') return send(500, 'oops', 'text/plain')
    send(404, 'missing', 'text/plain')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
  rmSync(tmp, { recursive: true, force: true })
})

async function run(...argv: string[]) {
  let out = ''
  let err = ''
  const code = await main(argv, { out: (s) => (out += s), err: (s) => (err += s), color: false })
  return { code, out, err }
}

describe('tracey <url>', () => {
  it('opens a trace from a link and reports findings like a local file', async () => {
    const r = await run(`${base}/run.jsonl`)
    expect(r.code).toBe(0)
    expect(r.out).toContain('OpenInference')
    expect(r.out).toContain('search_flights failed 3×')
  })

  it('detects from the bytes, not the name: protobuf, gzip (by magic bytes) and a content-encoding', async () => {
    expect((await run(`${base}/run.pb`)).out).toContain('OpenInference')
    expect((await run(`${base}/run.jsonl.gz`)).out).toContain('16 spans')
    expect((await run(`${base}/encoded`)).out).toContain('16 spans')
  })

  it('follows redirects, and works with detect, check and --json', async () => {
    expect((await run(`${base}/old`)).out).toContain('16 spans')
    expect((await run('detect', `${base}/run.jsonl`)).out).toContain('OpenInference')
    expect((await run('check', `${base}/run.jsonl`)).code).toBe(1)
    expect(JSON.parse((await run(`${base}/run.jsonl`, '--json')).out).detection.source).toBe('openinference')
  })

  it('sends headers the user gives, and does not guess credentials', async () => {
    const denied = await run(`${base}/private.jsonl`)
    expect(denied.code).toBe(2)
    expect(denied.err).toContain('refused access (HTTP 401)')
    expect(denied.err).toContain("--header 'Authorization: Bearer")
    const ok = await run(`${base}/private.jsonl`, '--header', 'Authorization: Bearer sekret')
    expect(ok.code).toBe(0)
    expect(seen.at(-1)!.auth).toBe('Bearer sekret')
    expect((await run('-H', 'Authorization: Bearer sekret', `${base}/private.jsonl`)).code).toBe(0)
    expect((await run(`${base}/forbidden`)).err).toContain('HTTP 403')
  })

  it('explains a missing file, a server error, a web page, an unreachable host and a bad link', async () => {
    expect((await run(`${base}/nope`)).err).toContain('Not found (HTTP 404)')
    expect((await run(`${base}/boom`)).err).toContain('HTTP 500')
    const page = await run(`${base}/page`)
    expect(page.err).toContain('web page, not a trace')
    expect(page.code).toBe(2)
    const dead = await run('http://127.0.0.1:1/x.jsonl')
    expect(dead.code).toBe(2)
    expect(dead.err).toContain('Could not reach 127.0.0.1')
    expect((await run('http://')).err).toMatch(/not a valid URL|Could not reach/)
  })

  it('stops at the size limit, whether declared up front or discovered while streaming', async () => {
    const declared = await run(`${base}/huge`)
    expect(declared.err).toContain('over the 200 MB limit')
    const streamed = await run(`${base}/stream`, '--max-size', '1')
    expect(streamed.err).toContain('passed the 1 MB limit')
    expect(streamed.code).toBe(2)
  })

  it('times out on a server that never answers', async () => {
    const r = await run(`${base}/hang`, '--timeout', '1')
    expect(r.code).toBe(2)
    expect(r.err).toContain('Timed out after 1s')
  }, 10_000)

  it('rejects bad option values', async () => {
    expect((await run(`${base}/run.jsonl`, '--header', 'nocolon')).err).toContain('bad --header')
    expect((await run(`${base}/run.jsonl`, '--max-size', 'abc')).err).toContain('bad --max-size')
    expect((await run(`${base}/run.jsonl`, '--timeout', '-3')).err).toContain('bad --timeout')
  })
})

describe('tracey download', () => {
  it('saves the bytes exactly as served, and says how to open them', async () => {
    const out = join(tmp, 'saved.pb')
    const r = await run('download', `${base}/run.pb`, '-o', out)
    expect(r.code).toBe(0)
    expect(r.out).toContain(`Saved`)
    expect(r.out).toContain(`tracey ${out}`)
    expect(Buffer.compare(readFileSync(out), PB)).toBe(0)
    expect((await run(out)).out).toContain('OpenInference')
  })

  it('keeps a gzip file as it is, yet tracey can open the saved copy', async () => {
    const out = join(tmp, 'saved.jsonl.gz')
    expect((await run('download', `${base}/run.jsonl.gz`, '--output', out)).code).toBe(0)
    expect(readFileSync(out).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])) // saved as served, still gzip
    expect(Buffer.compare(Buffer.from(maybeGunzip(new Uint8Array(readFileSync(out)))), OI)).toBe(0)
    expect((await run(out)).out).toContain('16 spans')
  })

  it('will not overwrite without --force, and passes headers', async () => {
    const out = join(tmp, 'exists.jsonl')
    writeFileSync(out, 'old')
    const refused = await run('download', `${base}/run.jsonl`, '-o', out)
    expect(refused.code).toBe(2)
    expect(refused.err).toContain('already exists')
    expect(readFileSync(out, 'utf8')).toBe('old')
    expect((await run('download', `${base}/run.jsonl`, '-o', out, '--force')).code).toBe(0)
    expect(readFileSync(out).length).toBe(OI.length)
    expect((await run('download', `${base}/private.jsonl`, '-o', join(tmp, 'p.jsonl'), '-H', 'Authorization: Bearer sekret')).code).toBe(0)
  })

  it('needs a link, and reports failures without leaving a file behind', async () => {
    expect((await run('download')).code).toBe(2)
    expect((await run('download', 'run.jsonl')).err).toContain('http(s) link')
    const out = join(tmp, 'never.jsonl')
    expect((await run('download', `${base}/nope`, '-o', out)).code).toBe(2)
    expect(() => readFileSync(out)).toThrow()
  })

  it('names the file after the link', () => {
    expect(nameFromUrl('https://x.test/a/b/run%201.jsonl?sig=1')).toBe('run 1.jsonl')
    expect(nameFromUrl('https://x.test/')).toBe('trace.jsonl')
    expect(nameFromUrl('https://x.test/..%2F..%2Fetc%2Fpasswd')).toBe('passwd')
    expect(nameFromUrl('not a url')).toBe('trace.jsonl')
  })
})

describe('links in other commands and local gzip', () => {
  it('diffs a local file against a link', async () => {
    const local = join(tmp, 'local.jsonl')
    writeFileSync(local, OI)
    const r = await run('diff', local, `${base}/run.jsonl`)
    expect(r.code).toBe(0)
    expect(r.out).toContain('No differences')
  })

  it('opens a local .gz file and recognises links', () => {
    const f = join(tmp, 'x.jsonl.gz')
    writeFileSync(f, gzipSync(OI))
    expect(Buffer.from(maybeGunzip(new Uint8Array(readFileSync(f)))).length).toBe(OI.length)
    expect(maybeGunzip(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]))
    expect(isUrl('https://a.test/x')).toBe(true)
    expect(isUrl('HTTP://a.test')).toBe(true)
    expect(isUrl('ftp://a.test')).toBe(false)
    expect(isUrl('./a.json')).toBe(false)
  })
})
