import type { Batch } from './otlp'

/**
 * Minimal protobuf reader for OTLP traces (ExportTraceServiceRequest). It decodes only the fields tracey
 * uses and produces the same shape as OTLP/JSON, so everything downstream is shared. Unknown fields are
 * skipped, so newer exporters keep working.
 */

interface Reader {
  buf: Uint8Array
  view: DataView
  pos: number
  end: number
}

const utf8 = new TextDecoder()

const reader = (buf: Uint8Array, pos = 0, end = buf.length): Reader => ({
  buf,
  view: new DataView(buf.buffer, buf.byteOffset, buf.byteLength),
  pos,
  end,
})

function varint(r: Reader): number {
  let lo = 0
  let hi = 0
  let shift = 0
  for (let i = 0; i < 10; i++) {
    if (r.pos >= r.end) throw new Error('truncated protobuf')
    const b = r.buf[r.pos++]!
    if (shift < 28) lo |= (b & 0x7f) << shift
    else if (shift < 32) {
      lo |= (b & 0x7f) << shift
      hi |= (b & 0x7f) >> (32 - shift)
    } else hi |= (b & 0x7f) << (shift - 32)
    shift += 7
    if (!(b & 0x80)) break
  }
  // Safe for values below 2^53, which covers ids, enums, lengths and any realistic int attribute.
  return (hi >>> 0) * 4294967296 + (lo >>> 0)
}

/** Signed int64 (two's complement over 64 bits) as a JS number; exact below 2^53 in magnitude. */
function sint64(r: Reader): number {
  const start = r.pos
  const v = varint(r)
  const len = r.pos - start
  if (len === 10) {
    // Negative numbers are encoded as 10 bytes. Re-read exactly with BigInt.
    let x = 0n
    for (let i = 0; i < 10; i++) x |= BigInt(r.buf[start + i]! & 0x7f) << BigInt(7 * i)
    return Number(BigInt.asIntN(64, x))
  }
  return v
}

function bytes(r: Reader): Uint8Array {
  const len = varint(r)
  if (r.pos + len > r.end) throw new Error('truncated protobuf')
  const out = r.buf.subarray(r.pos, r.pos + len)
  r.pos += len
  return out
}

const hex = (b: Uint8Array): string => {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

function skip(r: Reader, wire: number): void {
  if (wire === 0) varint(r)
  else if (wire === 1) r.pos += 8
  else if (wire === 2) {
    const n = varint(r) // read the length first: `r.pos += varint(r)` would use the stale position
    r.pos += n
  }
  else if (wire === 5) r.pos += 4
  else throw new Error(`unsupported protobuf wire type ${wire}`)
  if (r.pos > r.end) throw new Error('truncated protobuf')
}

/** Iterate a message's fields. `fn` returns true if it consumed the value, otherwise it is skipped. */
function fields(r: Reader, fn: (field: number, wire: number) => boolean): void {
  while (r.pos < r.end) {
    const tag = varint(r)
    const field = Math.floor(tag / 8)
    const wire = tag % 8
    if (!fn(field, wire)) skip(r, wire)
  }
}

const sub = (r: Reader): Reader => {
  const b = bytes(r)
  return reader(b)
}

type Value = Record<string, unknown>

function arrayValue(r: Reader): Value {
  const values: Value[] = []
  fields(r, (f, w) => {
    if (f === 1 && w === 2) {
      values.push(value(sub(r)))
      return true
    }
    return false
  })
  return { arrayValue: { values } }
}

function kvlist(r: Reader): Value {
  const values: { key: string; value: Value }[] = []
  fields(r, (f, w) => {
    if (f === 1 && w === 2) {
      values.push(keyValue(sub(r)))
      return true
    }
    return false
  })
  return { kvlistValue: { values } }
}

/** AnyValue: one of string, bool, int, double, array, key/value list, bytes. */
function value(r: Reader): Value {
  let out: Value = {}
  fields(r, (f, w) => {
    if (f === 1 && w === 2) out = { stringValue: utf8.decode(bytes(r)) }
    else if (f === 2 && w === 0) out = { boolValue: varint(r) !== 0 }
    else if (f === 3 && w === 0) out = { intValue: String(sint64(r)) }
    else if (f === 4 && w === 1) {
      out = { doubleValue: r.view.getFloat64(r.pos, true) }
      r.pos += 8
    } else if (f === 5 && w === 2) out = arrayValue(sub(r))
    else if (f === 6 && w === 2) out = kvlist(sub(r))
    else if (f === 7 && w === 2) out = { stringValue: hex(bytes(r)) }
    else return false
    return true
  })
  return out
}

function keyValue(r: Reader): { key: string; value: Value } {
  let key = ''
  let val: Value = {}
  fields(r, (f, w) => {
    if (f === 1 && w === 2) key = utf8.decode(bytes(r))
    else if (f === 2 && w === 2) val = value(sub(r))
    else return false
    return true
  })
  return { key, value: val }
}

const fixed64 = (r: Reader): string => {
  const v = r.view.getBigUint64(r.pos, true)
  r.pos += 8
  return v.toString()
}

function status(r: Reader): { code?: number; message?: string } {
  const st: { code?: number; message?: string } = {}
  fields(r, (f, w) => {
    if (f === 2 && w === 2) st.message = utf8.decode(bytes(r))
    else if (f === 3 && w === 0) st.code = varint(r)
    else return false
    return true
  })
  return st
}

function span(r: Reader): Record<string, unknown> {
  const attributes: unknown[] = []
  const s: Record<string, unknown> = { attributes }
  fields(r, (f, w) => {
    if (f === 1 && w === 2) s['traceId'] = hex(bytes(r))
    else if (f === 2 && w === 2) s['spanId'] = hex(bytes(r))
    else if (f === 4 && w === 2) s['parentSpanId'] = hex(bytes(r))
    else if (f === 5 && w === 2) s['name'] = utf8.decode(bytes(r))
    else if (f === 6 && w === 0) s['kind'] = varint(r)
    else if (f === 7 && w === 1) s['startTimeUnixNano'] = fixed64(r)
    else if (f === 8 && w === 1) s['endTimeUnixNano'] = fixed64(r)
    else if (f === 9 && w === 2) attributes.push(keyValue(sub(r)))
    else if (f === 15 && w === 2) s['status'] = status(sub(r))
    else return false
    return true
  })
  return s
}

type ScopeSpans = { scope: { name: string }; spans: Record<string, unknown>[] }

function instrumentationScope(r: Reader): { name: string } {
  let name = ''
  fields(r, (f, w) => {
    if (f === 1 && w === 2) {
      name = utf8.decode(bytes(r))
      return true
    }
    return false
  })
  return { name }
}

function scopeSpans(r: Reader): ScopeSpans {
  const out: ScopeSpans = { scope: { name: '' }, spans: [] }
  fields(r, (f, w) => {
    if (f === 1 && w === 2) out.scope = instrumentationScope(sub(r))
    else if (f === 2 && w === 2) out.spans.push(span(sub(r)))
    else return false
    return true
  })
  return out
}

function resourceSpans(r: Reader): { scopeSpans: ScopeSpans[] } {
  const scopes: ScopeSpans[] = []
  fields(r, (f, w) => {
    if (f === 2 && w === 2) {
      scopes.push(scopeSpans(sub(r)))
      return true
    }
    return false // the resource (field 1) and schema url are not needed
  })
  return { scopeSpans: scopes }
}

/** Decode an OTLP `ExportTraceServiceRequest` into the same structure OTLP/JSON uses. */
export function decodeOtlpProtobuf(buf: Uint8Array): Batch {
  const top = reader(buf)
  const out: { scopeSpans: ScopeSpans[] }[] = []
  fields(top, (f, w) => {
    if (f === 1 && w === 2) {
      out.push(resourceSpans(sub(top)))
      return true
    }
    return false
  })
  return { resourceSpans: out } as Batch
}
