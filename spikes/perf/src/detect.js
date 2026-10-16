// THROWAWAY spike. Format sniff: container + attribute fingerprint from a sample (head + 3 random windows).
// Works on a File/Blob (browser, Node openAsBlob). Never scans the whole file.
const WIN = 256 * 1024
const OI = ['openinference.span.kind', 'llm.input_messages.', 'llm.token_count.']
const GENAI = ['gen_ai.operation.name', 'gen_ai.provider.name', 'gen_ai.input.messages', 'gen_ai.usage.']
export async function detect(file, { windows = 3 } = {}) {
  const size = file.size
  const head = new Uint8Array(await file.slice(0, Math.min(size, WIN)).arrayBuffer())
  // layer 1: container sniff on the first bytes
  let i = 0; while (head[i] === 32 || head[i] === 10 || head[i] === 13 || head[i] === 9 || head[i] === 0xef || head[i] === 0xbb || head[i] === 0xbf) i++
  const c0 = head[i]
  const headStr = new TextDecoder().decode(head.subarray(i, Math.min(head.length, i + 400)))
  let container = 'unknown'
  if (c0 === 0x7b) {
    if (headStr.includes('"resourceSpans"')) container = 'otlp-json'
    else if (headStr.includes('"resource_spans"')) container = 'otlp-json'
    else if (headStr.includes('"context"') && headStr.includes('"trace_id"')) container = 'otel-console'
    else container = 'json'
  } else if (c0 === 0x5b) container = 'json-array'
  else if (c0 < 0x20 || c0 > 0x7e) container = 'binary(protobuf?)'
  // jsonl iff first line is complete JSON and another '{' line follows
  const nl = head.indexOf(10)
  let jsonl = nl > 0 && nl < head.length - 2 && head[nl + 1] === 0x7b
  if (nl < 0 && size > head.length) { // lines longer than the head window: look for an interior newline near the end
    const tail = new Uint8Array(await file.slice(Math.max(0, size - 64 * 1024), size).arrayBuffer())
    const k = tail.lastIndexOf(10, tail.length - 2)
    jsonl = k >= 0 && tail[k + 1] === 0x7b
  }
  // layer 2: attribute fingerprint over sampled windows
  const samples = [head]
  for (let k = 0; k < windows && size > WIN * 8; k++) {
    const off = Math.floor((size - WIN) * (k + 1) / (windows + 1))
    samples.push(new Uint8Array(await file.slice(off, off + WIN).arrayBuffer()))
  }
  const sc = { oi: 0, genai: 0 }
  const td = new TextDecoder('latin1')
  for (const s of samples) {
    const str = td.decode(s) // latin1 decode = fast byte->string, fine for ASCII key names
    for (const k of OI) if (str.includes(k)) sc.oi++
    for (const k of GENAI) if (str.includes(k)) sc.genai++
  }
  const mixed = sc.oi > 0 && sc.genai > 0
  const flavour = sc.oi && !sc.genai ? 'openinference' : sc.genai && !sc.oi ? 'otel-genai' : mixed ? 'mixed' : 'otlp-plain'
  return { container, jsonl, flavour, scores: sc, bytesRead: samples.reduce((a, b) => a + b.length, 0) }
}

// Stricter variant: fully JSON.parse the first line and the first line after each random offset, and fingerprint real attribute keys.
export async function detectPrecise(file) {
  const size = file.size, keys = new Set()
  const td = new TextDecoder()
  const lineAt = async (off) => {
    const buf = new Uint8Array(await file.slice(off, off + 512 * 1024).arrayBuffer())
    let s = 0
    if (off > 0) { s = buf.indexOf(10) + 1; if (!s) return }
    const e = buf.indexOf(10, s)
    if (e < 0) return
    const doc = JSON.parse(td.decode(buf.subarray(s, e)))
    for (const rs of doc.resourceSpans || []) for (const ss of rs.scopeSpans || []) for (const sp of ss.spans || []) for (const a of sp.attributes || []) keys.add(a.key)
  }
  await lineAt(0)
  for (let k = 1; k <= 3 && size > 4e6; k++) await lineAt(Math.floor(size * k / 4))
  const oi = keys.has('openinference.span.kind'), genai = keys.has('gen_ai.operation.name')
  return { flavour: oi && genai ? 'mixed' : oi ? 'openinference' : genai ? 'otel-genai' : 'otlp-plain', keys: keys.size }
}
