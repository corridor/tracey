// THROWAWAY spike. OTLP JSON -> struct-of-arrays span model. Three ingest strategies share one model.
export const CHUNK = 4096
export const KIND = { other: 0, agent: 1, llm: 2, tool: 3, chain: 4 }
const enc = new TextEncoder()
const dec = new TextDecoder()

// FNV-1a over bytes / string, so the byte scanner can compare attribute keys without allocating.
function fnvBytes(b, s, e) { let h = 0x811c9dc5; for (let i = s; i < e; i++) { h ^= b[i]; h = Math.imul(h, 16777619) } return h >>> 0 }
const H = (s) => { const b = enc.encode(s); return fnvBytes(b, 0, b.length) }
const K_OI_KIND = H('openinference.span.kind'), K_GEN_OP = H('gen_ai.operation.name')
const K_TIN = H('gen_ai.usage.input_tokens'), K_TOUT = H('gen_ai.usage.output_tokens')
const K_OI_TIN = H('llm.token_count.prompt'), K_OI_TOUT = H('llm.token_count.completion')
const K_SPANID = H('spanId'), K_PARENT = H('parentSpanId'), K_NAME = H('name'), K_START = H('startTimeUnixNano'), K_END = H('endTimeUnixNano')
const K_ATTRS = H('attributes'), K_STATUS = H('status'), K_RS = H('resourceSpans'), K_SS = H('scopeSpans'), K_SPANS = H('spans'), K_CODE = H('code')
const K_STR = H('stringValue'), K_INT = H('intValue')

function kindOf(v) {
  switch (v) {
    case 'LLM': case 'chat': case 'text_completion': case 'generate_content': return KIND.llm
    case 'AGENT': case 'invoke_agent': case 'create_agent': return KIND.agent
    case 'TOOL': case 'execute_tool': return KIND.tool
    case 'CHAIN': case 'RETRIEVER': case 'EMBEDDING': case 'invoke_workflow': case 'plan': return KIND.chain
    default: return KIND.other
  }
}

class Chunk {
  constructor() {
    this.n = 0
    this.start = new Float64Array(CHUNK) // microseconds since epoch (exact below 2^53)
    this.dur = new Float64Array(CHUNK)
    this.parent = new Int32Array(CHUNK).fill(-1) // global span index
    this.name = new Uint32Array(CHUNK) // interned
    this.tokens = new Uint32Array(CHUNK)
    this.kind = new Uint8Array(CHUNK)
    this.err = new Uint8Array(CHUNK)
    this.batch = new Uint32Array(CHUNK) // source line number: lazy payload re-read
  }
  buffers() { return [this.start.buffer, this.dur.buffer, this.parent.buffer, this.name.buffer, this.tokens.buffer, this.kind.buffer, this.err.buffer, this.batch.buffer] }
}

export class Ingest {
  // onChunk(chunk, base, newNames) is called for every full chunk and for the first partial one (time-to-first-spans)
  constructor(onChunk, { keepText = false } = {}) {
    this.onChunk = onChunk
    this.keepText = keepText
    this.total = 0
    this.cur = new Chunk()
    this.base = 0
    this.names = new Map(); this.nameList = []; this.newNames = []
    this.ids = new Map()
    this.pending = [] // [globalIdx, parentSpanId] unresolved at ingest time (children are exported before parents)
    this.text = []
    this.line = 0
    this.sentFirst = false
    this.sum = { n: 0, dur: 0, err: 0, tokens: 0, kinds: [0, 0, 0, 0, 0] }
  }
  intern(s) {
    let id = this.names.get(s)
    if (id === undefined) { id = this.nameList.length; this.names.set(s, id); this.nameList.push(s); this.newNames.push(s) }
    return id
  }
  add(spanId, parentId, name, start, end, kind, err, tokens) {
    const c = this.cur, i = c.n++
    const g = this.base + i
    c.start[i] = start; c.dur[i] = end - start
    c.name[i] = this.intern(name); c.kind[i] = kind; c.err[i] = err; c.tokens[i] = tokens; c.batch[i] = this.line
    this.ids.set(spanId, g)
    if (parentId) { const p = this.ids.get(parentId); if (p !== undefined) c.parent[i] = p; else this.pending.push(g, parentId) }
    const s = this.sum; s.n++; s.dur += end - start; s.err += err; s.tokens += tokens; s.kinds[kind]++
    this.total++
    if (c.n === CHUNK || (!this.sentFirst && false)) this.flush()
  }
  flush(final = false) {
    const c = this.cur
    if (!c.n) return
    const first = !this.sentFirst
    this.sentFirst = true
    const names = this.newNames; this.newNames = []
    this.onChunk(c, this.base, names, first)
    this.base += c.n
    this.cur = new Chunk()
  }
  // After the first line we flush a partial chunk once, so the UI can show spans immediately.
  endLine() { this.line++; if (!this.sentFirst && this.cur.n) this.flush() }
  // resolve parents that were not known at ingest time; returns Int32Array of [idx,parentIdx] pairs
  finish() {
    this.flush(true)
    const out = []
    for (let k = 0; k < this.pending.length; k += 2) { const p = this.ids.get(this.pending[k + 1]); if (p !== undefined) out.push(this.pending[k], p) }
    this.pending = []
    return Int32Array.from(out)
  }

  // ---- strategy A/B: object path (JSON.parse already done)
  ingestDoc(doc) {
    for (const rs of doc.resourceSpans) for (const ss of rs.scopeSpans) for (const s of ss.spans) {
      let kind = KIND.other, tokens = 0
      const at = s.attributes
      for (let i = 0; i < at.length; i++) {
        const a = at[i], k = a.key
        if (k === 'openinference.span.kind' || k === 'gen_ai.operation.name') { const kk = kindOf(a.value.stringValue); if (kk) kind = kk }
        else if (k === 'gen_ai.usage.input_tokens' || k === 'gen_ai.usage.output_tokens' || k === 'llm.token_count.prompt' || k === 'llm.token_count.completion') tokens += Number(a.value.intValue) || 0
        else if (this.keepText && a.value.stringValue !== undefined && a.value.stringValue.length > 200) this.text.push(a.value.stringValue)
      }
      this.add(s.spanId, s.parentSpanId, s.name, Number(s.startTimeUnixNano.slice(0, -3)), Number(s.endTimeUnixNano.slice(0, -3)), kind, s.status && s.status.code === 2 ? 1 : 0, tokens)
    }
  }

  // ---- strategy C: byte scanner. Never materialises payload strings.
  scanLine(buf, p, e) {
    this.buf = buf
    // generic walk to "resourceSpans"[*]."scopeSpans"[*]."spans"[*]
    this.walkObject(p, (key, q) => key === K_RS ? this.walkArray(q, (q2) => this.walkObject(q2, (k2, q3) => k2 === K_SS ? this.walkArray(q3, (q4) => this.walkObject(q4, (k3, q5) => k3 === K_SPANS ? this.walkArray(q5, (q6) => this.span(q6)) : this.skip(q5))) : this.skip(q3))) : this.skip(q))
  }
  ws(p) { const b = this.buf; let c = b[p]; while (c === 32 || c === 10 || c === 13 || c === 9) c = b[++p]; return p }
  strEnd(p) { // p at opening quote; returns index after closing quote
    const b = this.buf; let i = p + 1
    for (;;) {
      i = b.indexOf(34, i)
      let k = i - 1, c = 0
      while (b[k] === 92) { c++; k-- }
      if ((c & 1) === 0) return i + 1
      i++
    }
  }
  skip(p) {
    const b = this.buf; p = this.ws(p)
    const c = b[p]
    if (c === 34) return this.strEnd(p)
    if (c === 123 || c === 91) {
      let d = 0
      for (;;) {
        const ch = b[p]
        if (ch === 34) { p = this.strEnd(p); continue }
        if (ch === 123 || ch === 91) d++
        else if (ch === 125 || ch === 93) { d--; if (d === 0) return p + 1 }
        p++
      }
    }
    while (p < b.length) { const ch = b[p]; if (ch === 44 || ch === 125 || ch === 93 || ch === 32 || ch === 10) return p; p++ }
    return p
  }
  // calls fn(keyHash, valueStart) -> must return index after the value
  walkObject(p, fn) {
    const b = this.buf; p = this.ws(p) + 1
    for (;;) {
      p = this.ws(p)
      if (b[p] === 125) return p + 1
      if (b[p] === 44) { p++; continue }
      const ke = this.strEnd(p)
      const h = fnvBytes(b, p + 1, ke - 1)
      p = this.ws(ke); p = this.ws(p + 1) // ':'
      p = fn(h, p)
    }
  }
  walkArray(p, fn) {
    const b = this.buf; p = this.ws(p) + 1
    for (;;) {
      p = this.ws(p)
      if (b[p] === 93) return p + 1
      if (b[p] === 44) { p++; continue }
      p = fn(p)
    }
  }
  ascii(p, e) { // string content [p,e) -> JS string
    const b = this.buf; let s = ''
    for (let i = p; i < e; i++) { if (b[i] > 127) return dec.decode(b.subarray(p, e)); s += String.fromCharCode(b[i]) }
    return s
  }
  num(p, e, drop) { let v = 0; for (let i = p; i < e - drop; i++) v = v * 10 + (this.buf[i] - 48); return v }
  span(p) {
    let spanId = '', parentId = '', name = '', start = 0, end = 0, kind = KIND.other, err = 0, tokens = 0
    const b = this.buf
    const q = this.walkObject(p, (k, v) => {
      switch (k) {
        case K_SPANID: { const e = this.strEnd(v); spanId = this.ascii(v + 1, e - 1); return e }
        case K_PARENT: { const e = this.strEnd(v); parentId = this.ascii(v + 1, e - 1); return e }
        case K_NAME: { const e = this.strEnd(v); name = this.ascii(v + 1, e - 1); return e }
        case K_START: { const e = this.strEnd(v); start = this.num(v + 1, e - 1, 3); return e }
        case K_END: { const e = this.strEnd(v); end = this.num(v + 1, e - 1, 3); return e }
        case K_STATUS: return this.walkObject(v, (k2, v2) => { if (k2 === K_CODE) { const e = this.skip(v2); err = b[v2] === 50 ? 1 : 0; return e } return this.skip(v2) })
        case K_ATTRS: return this.walkArray(v, (a) => {
          let ak = 0, sval = '', ival = 0
          const r = this.walkObject(a, (k2, v2) => {
            if (k2 === H_KEY) { const e = this.strEnd(v2); ak = fnvBytes(b, v2 + 1, e - 1); return e }
            if (k2 === H_VALUE) {
              if (ak === K_OI_KIND || ak === K_GEN_OP) return this.walkObject(v2, (k3, v3) => { const e = this.strEnd(v3); sval = this.ascii(v3 + 1, e - 1); return e })
              if (ak === K_TIN || ak === K_TOUT || ak === K_OI_TIN || ak === K_OI_TOUT) return this.walkObject(v2, (k3, v3) => { if (b[v3] === 34) { const e = this.strEnd(v3); ival = this.num(v3 + 1, e - 1, 0); return e } const e = this.skip(v3); ival = this.num(v3, e, 0); return e })
              if (this.keepText) return this.walkObject(v2, (k3, v3) => { const e = this.skip(v3); if (b[v3] === 34 && e - v3 > 200) this.text.push(dec.decode(b.subarray(v3 + 1, e - 1))); return e })
            }
            return this.skip(v2)
          })
          if (ak === K_OI_KIND || ak === K_GEN_OP) { const kk = kindOf(sval); if (kk) kind = kk }
          else if (ak === K_TIN || ak === K_TOUT || ak === K_OI_TIN || ak === K_OI_TOUT) tokens += ival
          return r
        })
        default: return this.skip(v)
      }
    })
    this.add(spanId, parentId, name, start, end, kind, err, tokens)
    return q
  }
}
const H_KEY = H('key'), H_VALUE = H('value')

// ---------------------------------------------------------------- drivers
// Each driver takes a File/Blob (or Node-like object with .stream()/.text()) and an Ingest.
export async function runWhole(file, ing, t) {
  const text = await file.text(); t.read = performance.now()
  const doc = JSON.parse(text); t.jsonParse = performance.now()
  ing.ingestDoc(doc); ing.endLine(); t.build = performance.now()
}
export async function runLines(file, ing, t) {
  const rd = file.stream().getReader(), td = new TextDecoder()
  let carry = ''
  for (;;) {
    const { done, value } = await rd.read()
    let s = done ? carry : carry + td.decode(value, { stream: true })
    if (!done) { const nl = s.lastIndexOf('\n'); if (nl < 0) { carry = s; continue } carry = s.slice(nl + 1); s = s.slice(0, nl) } else carry = ''
    let p = 0
    while (p < s.length) {
      let q = s.indexOf('\n', p); if (q < 0) q = s.length
      if (q > p) { ing.ingestDoc(JSON.parse(s.slice(p, q))); ing.endLine(); if (t.first === undefined && ing.sentFirst) t.first = performance.now() }
      p = q + 1
    }
    if (done) break
  }
}
export async function runScan(file, ing, t) {
  const rd = file.stream().getReader()
  let carry = null
  for (;;) {
    const { done, value } = await rd.read()
    let b
    if (done) b = carry; else if (carry && carry.length) { b = new Uint8Array(carry.length + value.length); b.set(carry); b.set(value, carry.length) } else b = value
    if (!b || !b.length) { if (done) break; continue }
    let end = b.length
    if (!done) { const nl = b.lastIndexOf(10); if (nl < 0) { carry = b; continue } end = nl + 1; carry = b.slice(end) } else carry = null
    let p = 0
    while (p < end) {
      let q = b.indexOf(10, p); if (q < 0 || q > end) q = end
      if (q > p) { ing.scanLine(b, p, q); ing.endLine(); if (t.first === undefined && ing.sentFirst) t.first = performance.now() }
      p = q + 1
    }
    if (done) break
  }
}
export const DRIVERS = { whole: runWhole, lines: runLines, scan: runScan }
