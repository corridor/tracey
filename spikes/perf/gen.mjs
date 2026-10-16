// THROWAWAY spike. Scales the real fixtures into synthetic OTLP collector-file JSONL.
// usage: node gen.mjs [count ...]   (default 1000 10000 100000)
// Writes data/trace-<n>.jsonl (one OTLP batch per line) and data/trace-<n>.json (single document).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const fx = path.join(here, '../../fixtures')
const out = path.join(here, 'data')
fs.mkdirSync(out, { recursive: true })

// deterministic rng
let seed = 12345
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += ri(0, 15).toString(16); return s }

// ---- load templates from real fixtures
const tmpl = { agent: [], llm: [], tool: [], other: [] }
function load(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const d = JSON.parse(line)
    for (const rs of d.resourceSpans) for (const ss of rs.scopeSpans) for (const s of ss.spans) {
      const at = Object.fromEntries(s.attributes.map((a) => [a.key, a.value.stringValue]))
      const k = (at['openinference.span.kind'] || '').toLowerCase()
      const op = at['gen_ai.operation.name'] || ''
      let kind = 'other'
      if (k === 'llm' || op === 'chat') kind = 'llm'
      else if (k === 'tool' || op === 'execute_tool') kind = 'tool'
      else if (k === 'agent' || op === 'invoke_agent') kind = 'agent'
      tmpl[kind].push({ s, scope: ss.scope, res: rs.resource })
    }
  }
}
for (const f of ['openinference/travel-planner.collector-file.jsonl', 'otel-genai/travel-planner.collector-file.jsonl', 'otel-genai/travel-planner-batched.collector-file.jsonl']) load(path.join(fx, f))
for (const k in tmpl) if (!tmpl[k].length) tmpl[k] = tmpl.other.length ? tmpl.other : tmpl.llm
console.error('templates', Object.fromEntries(Object.entries(tmpl).map(([k, v]) => [k, v.length])))

const WORDS = 'the agent called tool search flight hotel weather paris plan trip budget user asked assistant result json value error retry response model token context window summary step observe think act final answer'.split(' ')
function text(len) {
  let s = ''
  while (s.length < len) s += WORDS[ri(0, WORDS.length - 1)] + (rnd() < 0.08 ? '.\\n' : ' ')
  return s.slice(0, len)
}
// payload size scale: tuned so 100k spans ~ 200 MB
const SCALE = Number(process.env.SCALE || 1)
function payloadLen(kind) {
  const r = rnd()
  const base = kind === 'llm' ? 3200 : kind === 'tool' ? 900 : 300
  const m = r < 0.02 ? 12 : r < 0.15 ? 3 : 1
  return Math.floor(base * m * (0.4 + rnd()) * SCALE)
}
function cloneAttrs(attrs, kind) {
  const L = payloadLen(kind)
  return attrs.map((a) => {
    const v = a.value
    if (v.stringValue !== undefined && v.stringValue.length > 120) {
      return { key: a.key, value: { stringValue: text(Math.max(60, Math.floor(L * Math.min(1, v.stringValue.length / 1500 + 0.3)))) } }
    }
    return { key: a.key, value: { ...v } }
  })
}

function makeTrace(target) {
  const spans = []
  const traceId = hex(32)
  let t = BigInt(1792160000) * 1000000000n + BigInt(ri(0, 1e9)) * 1000n
  const t0 = t
  const mk = (kind, parent, start, dur, opts = {}) => {
    const T = tmpl[kind][ri(0, tmpl[kind].length - 1)]
    const s = {
      traceId, spanId: hex(16), parentSpanId: parent ? parent.spanId : '', flags: 256,
      name: T.s.name, kind: T.s.kind,
      startTimeUnixNano: String(start), endTimeUnixNano: String(start + dur),
      attributes: cloneAttrs(T.s.attributes, kind),
      status: opts.error ? { code: 2, message: 'tool failed: timeout after 30s' } : (T.s.status && T.s.status.code !== 2 ? T.s.status : { code: 1 }),
    }
    if (opts.error) s.events = [{ timeUnixNano: String(start + dur), name: 'exception', attributes: [{ key: 'exception.type', value: { stringValue: 'TimeoutError' } }, { key: 'exception.message', value: { stringValue: text(300) } }] }]
    s._tmpl = T
    spans.push(s)
    return s
  }
  const ms = (x) => BigInt(Math.floor(x * 1e6))
  const root = mk('agent', null, t, 0n)
  function agentRun(agent, depth) {
    const steps = ri(2, 6)
    for (let i = 0; i < steps && spans.length < target; i++) {
      const llm = mk('llm', agent, t, ms(ri(400, 4000)))
      t = BigInt(llm.endTimeUnixNano)
      const r = rnd()
      if (r < 0.06 && depth < 3) { // sub-agent
        const sub = mk('agent', agent, t, 0n)
        const st = t; agentRun(sub, depth + 1); sub.endTimeUnixNano = String(t); sub.startTimeUnixNano = String(st)
      } else if (r < 0.10) { // wide fan-out, parallel tools
        const n = ri(20, 80), st = t; let mx = 0n
        for (let k = 0; k < n && spans.length < target; k++) { const d = ms(ri(50, 1500)); mk('tool', agent, st + ms(rnd() * 20), d, { error: rnd() < 0.02 }); if (d > mx) mx = d }
        t = st + mx + ms(30)
      } else if (r < 0.18) { // loop: same tool repeatedly
        const n = ri(5, 20)
        for (let k = 0; k < n && spans.length < target; k++) { const d = ms(ri(80, 300)); mk('tool', agent, t, d, { error: k === n - 1 && rnd() < 0.3 }); t += d + ms(5) }
      } else { // 1-3 sequential or parallel tools
        const n = ri(1, 3), st = t; let mx = 0n
        for (let k = 0; k < n; k++) { const d = ms(ri(30, 2500)); const tl = mk('tool', agent, st + ms(k * 2), d, { error: rnd() < 0.03 }); if (d > mx) mx = d }
        t = st + mx + ms(10)
      }
      if (rnd() < 0.15) { const d = ms(ri(1, 30)); mk('other', agent, t, d); t += d }
    }
  }
  agentRun(root, 0)
  root.endTimeUnixNano = String(t)
  spans.sort((a, b) => (BigInt(a.endTimeUnixNano) < BigInt(b.endTimeUnixNano) ? -1 : 1))
  return spans
}

for (const total of process.argv.slice(2).map(Number).concat(process.argv.length > 2 ? [] : [1000, 10000, 100000])) {
  seed = 12345
  const jl = fs.createWriteStream(path.join(out, `trace-${total}${process.env.TAG || ''}.jsonl`))
  const batches = []
  let n = 0, cur = [], first = true
  const w = fs.openSync(path.join(out, `trace-${total}${process.env.TAG || ''}.json`), 'w')
  fs.writeSync(w, '{"resourceSpans":[')
  let firstB = true
  const flush = () => {
    if (!cur.length) return
    const T = cur[0]._tmpl
    const rs = { resource: T.res, scopeSpans: [{ scope: T.scope, spans: cur.map(({ _tmpl, ...s }) => s) }] }
    const str = JSON.stringify(rs)
    jl.write('{"resourceSpans":[' + str + ']}\n')
    fs.writeSync(w, (firstB ? '' : ',') + str); firstB = false
    cur = []
  }
  while (n < total) {
    const spans = makeTrace(Math.min(total - n, ri(30, 400)))
    for (const s of spans) { cur.push(s); n++; if (cur.length >= 64) flush() }
  }
  flush()
  fs.writeSync(w, ']}'); fs.closeSync(w)
  await new Promise((r) => jl.end(r))
  console.error(total, 'spans', (fs.statSync(path.join(out, `trace-${total}${process.env.TAG || ''}.jsonl`)).size / 1e6).toFixed(1), 'MB')
}
