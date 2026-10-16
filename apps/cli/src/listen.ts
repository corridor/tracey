import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { buildTraces, decodeOtlpProtobuf, parseBatches, parseOtlp } from '@ggx/trace-adapters'
import type { ParsedFile, RawSpan } from '@ggx/trace-adapters'
import { analyze, summarize } from '@ggx/trace-insights'
import { detectionLines, findingLines, style, summaryLine } from './format'
import type { Style } from './format'

export interface ReceiverOptions {
  port: number
  host: string
  /** Append every received batch to this file as OTLP JSON lines (readable by `tracey <file>`). */
  save?: string
  /** Called after each accepted batch with the trace ids it touched. */
  onBatch?: (traceIds: string[]) => void
}

export interface TraceState {
  spans: RawSpan[]
  lastAt: number
}

export interface Receiver {
  port: number
  host: string
  traces: Map<string, TraceState>
  close: () => Promise<void>
}

const MAX_BODY = 64 * 1024 * 1024

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large')
    chunks.push(c as Buffer)
  }
  let body = Buffer.concat(chunks)
  if (req.headers['content-encoding'] === 'gzip') {
    try {
      body = gunzipSync(body)
    } catch {
      throw new HttpError(400, 'invalid gzip body')
    }
  }
  return body
}

/** Decode a POST /v1/traces body: OTLP JSON or OTLP protobuf. Returns spans and the batch as JSON for saving. */
export function decodeBody(body: Buffer, contentType: string): { spans: RawSpan[]; json: string } {
  try {
    if (contentType.includes('json')) {
      const text = body.toString('utf8')
      return { spans: parseOtlp(text), json: JSON.stringify(JSON.parse(text)) }
    }
    const batch = decodeOtlpProtobuf(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
    return { spans: parseBatches([batch]), json: JSON.stringify(batch) }
  } catch (e) {
    throw new HttpError(400, `could not decode the trace payload: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function startReceiver(opts: ReceiverOptions): Promise<Receiver> {
  const traces = new Map<string, TraceState>()
  const server: Server = createServer(async (req, res) => {
    const reply = (status: number, body = '', type = 'text/plain') => {
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    }
    try {
      const url = (req.url ?? '/').split('?')[0]
      if (req.method === 'GET' && url === '/') return reply(200, 'tracey is listening for OTLP traces on /v1/traces\n')
      if (req.method !== 'POST') return reply(405, 'method not allowed\n')
      const isJson = (req.headers['content-type'] ?? '').includes('json')
      if (url === '/v1/metrics' || url === '/v1/logs') {
        await readBody(req) // accepted and ignored, so exporters of other signals do not error
        return isJson ? reply(200, '{}', 'application/json') : reply(200, '', 'application/x-protobuf')
      }
      if (url !== '/v1/traces') return reply(404, 'only /v1/traces is served\n')
      const { spans, json } = decodeBody(await readBody(req), req.headers['content-type'] ?? '')
      const now = Date.now()
      const touched = new Set<string>()
      for (const s of spans) {
        let t = traces.get(s.traceId)
        if (!t) traces.set(s.traceId, (t = { spans: [], lastAt: now }))
        t.spans.push(s)
        t.lastAt = now
        touched.add(s.traceId)
      }
      if (opts.save) appendFileSync(opts.save, `${json}\n`)
      opts.onBatch?.([...touched])
      return isJson ? reply(200, '{}', 'application/json') : reply(200, '', 'application/x-protobuf')
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, `${e.message}\n`)
      return reply(500, 'internal error\n')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, opts.host, () => resolve())
  })
  const addr = server.address()
  return {
    port: typeof addr === 'object' && addr ? addr.port : opts.port,
    host: opts.host,
    traces,
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  }
}

export const isLoopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '::1'

const RUNNING_MS = 3000

/** The screen: where we listen, the recent runs, and findings for the one being followed (the newest). */
export function renderLive(r: Pick<Receiver, 'traces' | 'port' | 'host'>, st: Style, now = Date.now()): string[] {
  const lines = [`${st.bold('tracey listen')} ${st.dim(`http://${r.host}:${r.port}/v1/traces  ·  ctrl-c to stop`)}`, '']
  const ordered = [...r.traces.entries()].sort((a, b) => b[1].lastAt - a[1].lastAt)
  if (ordered.length === 0) {
    lines.push(`Waiting for spans. Point your agent at it:`, `  ${st.blue(`export OTEL_EXPORTER_OTLP_ENDPOINT=http://${r.host}:${r.port}`)}`)
    return lines
  }
  for (const [id, t] of ordered.slice(0, 5)) {
    const running = now - t.lastAt < RUNNING_MS
    lines.push(`${running ? st.green('●') : st.dim('○')} ${id.slice(0, 8)}  ${t.spans.length} spans  ${st.dim(running ? 'running' : 'idle')}`)
  }
  const [, newest] = ordered[0]!
  const parsed: ParsedFile = buildTraces(newest.spans)
  const first = parsed.traces[0]
  if (first) {
    const findings = analyze(first.trace)
    const summary = summarize(first.trace, findings)
    lines.push('', ...detectionLines(parsed.detection, st).slice(0, 1), summaryLine(first.trace, summary, st), '', ...findingLines(first.trace, findings, st))
  }
  return lines
}

export interface ListenArgs {
  port: number
  host: string
  save?: string
}

export function parseListenArgs(args: string[]): ListenArgs | { error: string } {
  const opt = (name: string): string | undefined => {
    const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
    if (i < 0) return undefined
    return args[i]!.includes('=') ? args[i]!.slice(name.length + 1) : args[i + 1]
  }
  const port = opt('--port') === undefined ? 4318 : Number(opt('--port'))
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: `invalid --port ${opt('--port')}` }
  const save = opt('--save')
  return { port, host: opt('--host') ?? '127.0.0.1', ...(save ? { save } : {}) }
}

export interface ListenIO {
  out: (s: string) => void
  err: (s: string) => void
  color: boolean
  /** True on an interactive terminal: redraw in place instead of logging lines. */
  tty?: boolean
  /** Resolves when the user stops (Ctrl-C). */
  stop?: Promise<void>
  /** Called once the receiver is up (used by tests to learn the port). */
  ready?: (r: Receiver) => void
}

export async function runListen(args: string[], io: ListenIO): Promise<number> {
  const parsed = parseListenArgs(args)
  if ('error' in parsed) {
    io.err(`tracey: ${parsed.error}\n`)
    return 2
  }
  const st = style(io.color)
  let timer: ReturnType<typeof setTimeout> | undefined
  let drawn = 0
  let receiver: Receiver
  const draw = () => {
    timer = undefined
    const lines = renderLive(receiver, st)
    io.out(`${drawn ? `\x1b[${drawn}A` : ''}\x1b[J${lines.join('\n')}\n`)
    drawn = lines.length
  }
  try {
    receiver = await startReceiver({
      ...parsed,
      onBatch: (ids) => {
        if (io.tty) timer ??= setTimeout(draw, 150)
        else
          for (const id of ids) {
            const t = receiver.traces.get(id)!
            io.out(`+ trace ${id.slice(0, 8)}: ${t.spans.length} spans so far\n`)
          }
      },
    })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    io.err(code === 'EADDRINUSE' ? `tracey: port ${parsed.port} is already in use. Try --port <other>.\n` : `tracey: could not listen: ${e instanceof Error ? e.message : String(e)}\n`)
    return 2
  }
  if (!isLoopback(parsed.host)) io.err(`warning: listening on ${parsed.host}, so other machines can send (and nothing authenticates them). Use the default 127.0.0.1 unless you need this.\n`)
  if (io.tty) draw()
  else io.out(`tracey listen: http://${receiver.host}:${receiver.port}/v1/traces (ctrl-c to stop)\n`)
  io.ready?.(receiver)

  await (io.stop ?? new Promise<void>(() => {}))
  if (timer) clearTimeout(timer)
  await receiver.close()
  if (io.tty) draw()
  else {
    for (const [id, t] of receiver.traces) {
      const parsedFile = buildTraces(t.spans)
      const first = parsedFile.traces[0]
      if (!first) continue
      const findings = analyze(first.trace)
      io.out(`\ntrace ${id.slice(0, 8)}\n${summaryLine(first.trace, summarize(first.trace, findings), st)}\n${findingLines(first.trace, findings, st).join('\n')}\n`)
    }
  }
  return 0
}
