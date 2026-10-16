import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseTraceFile } from '@ggx/trace-adapters'
import type { ClaudeSubagent, ParsedFile } from '@ggx/trace-adapters'
import { analyze, summarize } from '@ggx/trace-insights'
import { detectionLines, findingLines, style, summaryLine } from './format'

export interface IO {
  out: (s: string) => void
  err: (s: string) => void
  color: boolean
}

const HELP = `tracey: see what your agent really did

Usage
  tracey <file>                     open a trace: detect its source, show findings
  tracey detect <file>              only report what the file is
  tracey check <file> [--fail-on error|warning]
                                    exit non-zero if findings reach that severity
Options
  --json                            machine-readable output
  -h, --help                        show this help
`

/** Claude Code keeps sub-agents next to the session: <session-id>/subagents/agent-*.jsonl + .meta.json. */
function loadSubagents(file: string): ClaudeSubagent[] {
  const dir = join(dirname(file), basename(file).replace(/\.jsonl$/, ''), 'subagents')
  if (!existsSync(dir)) return []
  const out: ClaudeSubagent[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    const metaFile = join(dir, f.replace(/\.jsonl$/, '.meta.json'))
    const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {}
    out.push({ text: readFileSync(join(dir, f), 'utf8'), meta })
  }
  return out
}

function load(file: string): ParsedFile {
  const text = readFileSync(file, 'utf8')
  return parseTraceFile(text, { claudeSubagents: loadSubagents(file) })
}

export async function main(argv: string[], io: IO): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('-') && !a.includes('=')))
  const failOn = argv.find((a) => a.startsWith('--fail-on='))?.slice(10) ?? (argv.includes('--fail-on') ? argv[argv.indexOf('--fail-on') + 1] : undefined)
  const args = argv.filter((a, i) => !a.startsWith('-') && argv[i - 1] !== '--fail-on')
  if (flags.has('-h') || flags.has('--help') || argv.length === 0) {
    io.out(HELP)
    return argv.length === 0 ? 0 : 0
  }
  const json = flags.has('--json')
  const st = style(io.color)
  const cmd = ['detect', 'check'].includes(args[0] ?? '') ? args.shift()! : 'open'
  const file = args[0]
  if (!file) {
    io.err('tracey: missing <file>\n')
    return 2
  }
  if (!existsSync(file)) {
    io.err(`tracey: cannot read ${file}\n`)
    return 2
  }

  const parsed = load(file)
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
