import { existsSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseTraceBytes } from '@ggx/trace-adapters'
import type { ParsedFile } from '@ggx/trace-adapters'
import { DEFAULT_MAX_BYTES, fetchBytes, isUrl, readInput } from './input'
import type { FetchOptions } from './input'
import { analyze, summarize } from '@ggx/trace-insights'
import { duration } from './format'
import { discoverSessions, labelOf } from '@ggx/trace-discover'
import type { SessionInfo } from '@ggx/trace-discover'
import { describeSummary, diffTraces } from '@ggx/trace-diff'
import type { DiffRow } from '@ggx/trace-diff'
import { runListen } from './listen'
import type { ListenIO } from './listen'
import { detectionLines, findingLines, style, summaryLine } from './format'

export interface IO {
  out: (s: string) => void
  err: (s: string) => void
  color: boolean
  /** Present on an interactive terminal: lets `tracey` with no arguments offer a picker. */
  pick?: (sessions: SessionInfo[]) => Promise<SessionInfo | undefined>
  /** Overridable for tests; defaults to scanning this machine. */
  discover?: () => Promise<SessionInfo[]>
  /** For `tracey listen`: terminal mode, a stop signal, and a hook for tests. */
  listen?: Pick<ListenIO, 'tty' | 'stop' | 'ready'>
  /** Overridable for tests; defaults to the global fetch. */
  fetch?: typeof fetch
  /** Shown while a download runs (the bin wires this to stderr on a terminal). */
  progress?: (bytes: number) => void
}

const HELP = `tracey: see what your agent really did

Usage
  tracey <https://...>              open a trace from a link (add --header 'Authorization: Bearer ...' if private)
  tracey download <url> [-o file]   save a trace from a link without opening it
  tracey diff <a> <b> [--all] [--fail-on-regression]
                                    compare two runs: what was added, removed, slower, newly failing
  tracey listen [--port 4318] [--host 127.0.0.1] [--save file.jsonl]
                                    receive OTLP traces from a running agent and show them live
  tracey                            pick from sessions found on this machine (interactive terminal)
  tracey sessions [--json]          list sessions found on this machine, newest first
  tracey <file>                     open a trace: detect its source, show findings
  tracey detect <file>              only report what the file is
  tracey check <file> [--fail-on error|warning]
                                    exit non-zero if findings reach that severity
Options
  -H, --header 'Name: value'        send a header with a download (repeatable)
  --max-size <MB>  --timeout <s>    download limits (default 200 MB, 60 s)
  -o, --output <file>  --force      where to save, and allow overwriting
  --json                            machine-readable output
  -h, --help                        show this help
`

function parse(input: { bytes: Uint8Array; subagents: import('@ggx/trace-adapters').ClaudeSubagent[] }): ParsedFile {
  return parseTraceBytes(input.bytes, { claudeSubagents: input.subagents })
}

function sessionLines(sessions: SessionInfo[], st: ReturnType<typeof style>): string {
  if (sessions.length === 0) return 'No sessions found in the usual places (~/.claude*).\n'
  return `${sessions.map((x) => `${labelOf(x).slice(0, 48).padEnd(48)} ${st.dim(`${x.source}  ${new Date(x.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')}  ${x.path}`)}`).join('\n')}\n`
}

async function firstTrace(file: string, fo: FetchOptions) {
  const r = await readInput(file, fo)
  if (!r.ok) return r
  const parsed = parse(r.input)
  const t = parsed.traces[0]
  return t ? { ok: true as const, file, parsed, trace: t.trace } : { ok: false as const, message: `could not recognise ${file}` }
}

const MARK: Record<DiffRow['state'], string> = { same: '=', changed: '≠', added: '+', removed: '-' }

function signed(ms: number): string {
  const d = duration(Math.abs(ms))
  return `${ms < 0 ? '-' : '+'}${d}`
}

async function runDiff(files: string[], opt: { json: boolean; all: boolean; failOnRegression: boolean }, fo: FetchOptions, io: IO, st: ReturnType<typeof style>): Promise<number> {
  if (files.length !== 2) {
    io.err('tracey diff: give two files, tracey diff <a> <b>\n')
    return 2
  }
  const [a, b] = await Promise.all(files.map((f) => firstTrace(f, fo)))
  for (const x of [a, b]) {
    if (x && !x.ok) {
      io.err(`tracey: ${x.message}\n`)
      return x.message.startsWith('could not recognise') ? 1 : 2
    }
  }
  if (!a?.ok || !b?.ok) return 2
  const d = diffTraces(a.trace, b.trace)
  const nameOf = (r: DiffRow) => (r.a >= 0 ? a.trace.nameOf(r.a) : b.trace.nameOf(r.b))
  const shown = opt.all ? d.rows : d.rows.filter((r) => r.state !== 'same')
  const regression = d.summary.newFailures > 0
  if (opt.json) {
    io.out(`${JSON.stringify({ a: { file: a.file, spans: a.trace.count, durationMs: a.trace.duration }, b: { file: b.file, spans: b.trace.count, durationMs: b.trace.duration }, summary: d.summary, rows: shown.map((r) => ({ state: r.state, name: nameOf(r), depth: r.depth, reasons: r.reasons, deltaMs: r.deltaMs })) })}\n`)
  } else {
    const side = (tag: string, x: typeof a & { ok: true }) => `${st.bold(tag)}  ${x.file}  ${st.dim(`${x.trace.count} spans · ${duration(x.trace.duration)}`)}`
    const lines = [side('A', a), side('B', b), '', `${regression ? st.red('▲') : st.green('✓')} ${describeSummary(d.summary)}`, '']
    for (const r of shown) {
      const paint = r.state === 'added' ? st.green : r.state === 'removed' ? st.red : st.orange
      const why = r.state === 'changed' ? r.reasons.map((x) => (x === 'slower' || x === 'faster' ? `${x} ${signed(r.deltaMs)}` : x === 'failed' ? st.red('now fails') : x === 'fixed' ? st.green('fixed') : x)).join(', ') : r.state
      lines.push(`${'  '.repeat(r.depth)}${paint(MARK[r.state])} ${nameOf(r)}  ${st.dim(why)}`)
    }
    io.out(`${lines.join('\n')}\n`)
  }
  return opt.failOnRegression && regression ? 1 : 0
}

const VALUE_FLAGS = new Set(['--fail-on', '--header', '-H', '-o', '--output', '--max-size', '--timeout'])

/** Values given to a flag, in order: `--header A --header B` gives both. Supports `--flag=value` too. */
function valuesOf(argv: string[], names: string[]): string[] {
  const out: string[] = []
  argv.forEach((a, i) => {
    const eq = names.find((n) => a.startsWith(`${n}=`))
    if (eq) out.push(a.slice(eq.length + 1))
    else if (names.includes(a) && argv[i + 1] !== undefined) out.push(argv[i + 1]!)
  })
  return out
}

function fetchOptions(argv: string[], io: IO): FetchOptions | { error: string } {
  const headers: Record<string, string> = {}
  for (const h of valuesOf(argv, ['--header', '-H'])) {
    const at = h.indexOf(':')
    if (at <= 0) return { error: `bad --header ${JSON.stringify(h)}: use 'Name: value'` }
    headers[h.slice(0, at).trim()] = h.slice(at + 1).trim()
  }
  const num = (name: string, scale: number): number | undefined | { error: string } => {
    const v = valuesOf(argv, [name])[0]
    if (v === undefined) return undefined
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n * scale : { error: `bad ${name} ${v}: expected a positive number` }
  }
  const maxBytes = num('--max-size', 1024 * 1024)
  const timeoutMs = num('--timeout', 1000)
  if (typeof maxBytes === 'object') return maxBytes
  if (typeof timeoutMs === 'object') return timeoutMs
  return { headers, maxBytes: maxBytes ?? DEFAULT_MAX_BYTES, ...(timeoutMs ? { timeoutMs } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.progress ? { onProgress: io.progress } : {}) }
}

/** The file name a link suggests: the last path segment, or a default. */
export function nameFromUrl(url: string): string {
  try {
    return basename(decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')) || 'trace.jsonl'
  } catch {
    return 'trace.jsonl'
  }
}

async function runDownload(argv: string[], args: string[], fo: FetchOptions, io: IO): Promise<number> {
  const url = args[0]
  if (!url || !isUrl(url)) {
    io.err('tracey download: give an http(s) link, tracey download <url> [-o file]\n')
    return 2
  }
  const r = await fetchBytes(url, fo)
  if (!r.ok) {
    io.err(`tracey: ${r.message}\n`)
    return 2
  }
  const name = valuesOf(argv, ['-o', '--output'])[0] ?? nameFromUrl(url)
  if (existsSync(name) && !argv.includes('--force')) {
    io.err(`tracey: ${name} already exists. Pick another name with -o, or pass --force to overwrite it.\n`)
    return 2
  }
  writeFileSync(name, r.bytes)
  io.out(`Saved ${(r.bytes.length / 1024 / 1024).toFixed(r.bytes.length > 1024 * 1024 ? 1 : 2)} MB to ${name}. Open it with: tracey ${name}\n`)
  return 0
}

export async function main(argv: string[], io: IO): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('-') && !a.includes('=')))
  const failOn = valuesOf(argv, ['--fail-on'])[0]
  const args = argv.filter((a, i) => !a.startsWith('-') && !VALUE_FLAGS.has(argv[i - 1] ?? ''))
  const json = flags.has('--json')
  const st = style(io.color)
  if (flags.has('-h') || flags.has('--help') || (argv.length === 0 && !io.pick)) {
    io.out(HELP)
    return 0
  }
  const fo = fetchOptions(argv, io)
  if ('error' in fo) {
    io.err(`tracey: ${fo.error}\n`)
    return 2
  }
  if (args[0] === 'download') return runDownload(argv, args.slice(1), fo, io)
  if (args[0] === 'diff') return runDiff(args.slice(1), { json, all: flags.has('--all'), failOnRegression: flags.has('--fail-on-regression') }, fo, io, st)
  if (args[0] === 'listen') return runListen(argv.slice(argv.indexOf('listen') + 1), { out: io.out, err: io.err, color: io.color, ...io.listen })
  if (argv.length === 0 || args[0] === 'sessions') {
    const sessions = await (io.discover ?? discoverSessions)()
    if (args[0] === 'sessions') {
      io.out(json ? `${JSON.stringify(sessions)}\n` : sessionLines(sessions, st))
      return 0
    }
    if (sessions.length === 0) {
      io.out('No sessions found in the usual places (~/.claude*). Pass a file: tracey <file>\n')
      return 1
    }
    const picked = await io.pick!(sessions)
    if (!picked) return 0
    return main([picked.path], io)
  }
  const cmd = ['detect', 'check'].includes(args[0] ?? '') ? args.shift()! : 'open'
  const file = args[0]
  if (!file) {
    io.err('tracey: missing <file>\n')
    return 2
  }
  const read = await readInput(file, fo)
  if (!read.ok) {
    io.err(`tracey: ${read.message}\n`)
    return 2
  }
  io.progress?.(-1) // clear any progress line
  const parsed = parse(read.input)
  if (parsed.traces.length === 0) {
    if (json) io.out(`${JSON.stringify({ detection: parsed.detection, traces: [] })}\n`)
    else io.out(`${st.orange('?')} Could not recognise ${file}. Supported: OTLP JSON (OpenInference, OTel GenAI, OpenLLMetry), Claude Code transcripts.\n`)
    return 1
  }
  if (cmd === 'detect') {
    io.out(json ? `${JSON.stringify(parsed.detection)}\n` : `${detectionLines(parsed.detection, st).join('\n')}\n`)
    return 0
  }

  let worst = 0 // 0 none, 1 warning, 2 error
  const reports = parsed.traces.map(({ traceId, trace }) => {
    const findings = analyze(trace)
    const summary = summarize(trace, findings)
    if (summary.errors) worst = 2
    else if (summary.warnings) worst = Math.max(worst, 1)
    return { traceId, trace, findings, summary }
  })

  if (json) {
    io.out(`${JSON.stringify({ detection: parsed.detection, traces: reports.map((r) => ({ traceId: r.traceId, summary: r.summary, findings: r.findings.map((f) => ({ ...f, spanNames: f.spans.map((i) => r.trace.nameOf(i)) })) })) })}\n`)
  } else {
    const lines = [...detectionLines(parsed.detection, st), '']
    for (const r of reports) {
      if (reports.length > 1) lines.push(st.bold(`trace ${r.traceId.slice(0, 8)}`))
      lines.push(summaryLine(r.trace, r.summary, st), '', ...findingLines(r.trace, r.findings, st), '')
    }
    io.out(lines.join('\n'))
  }
  if (cmd === 'check') {
    const threshold = failOn === 'warning' ? 1 : 2
    return worst >= threshold ? 1 : 0
  }
  return 0
}

export { runPicker } from './picker'
