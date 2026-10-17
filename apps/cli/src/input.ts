import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { ClaudeSubagent } from '@ggx/trace-adapters'

export interface Input {
  /** What to call it in output: the file path or the URL. */
  name: string
  bytes: Uint8Array
  subagents: ClaudeSubagent[]
}

export type InputResult = { ok: true; input: Input } | { ok: false; message: string }

export const isUrl = (s: string): boolean => /^https?:\/\//i.test(s)

export interface FetchOptions {
  headers?: Record<string, string>
  maxBytes?: number
  timeoutMs?: number
  fetch?: typeof fetch
  /** Called as bytes arrive (the caller decides whether to show it). */
  onProgress?: (bytes: number) => void
}

export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024
const MB = 1024 * 1024

/**
 * Download a trace over http(s). The format is decided later from the bytes, never from the URL. Errors are
 * written for a person: what happened and what to try.
 */
export async function fetchBytes(url: string, o: FetchOptions = {}): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; message: string }> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, message: `${url} is not a valid URL.` }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, message: `Only http and https links are supported, not ${u.protocol}` }
  const max = o.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = o.timeoutMs ?? 60_000
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await (o.fetch ?? fetch)(url, { headers: o.headers ?? {}, redirect: 'follow', signal: ctl.signal })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `The server refused access (HTTP ${res.status}). If the link is private, send credentials: --header 'Authorization: Bearer <token>'.` }
    }
    if (res.status === 404) return { ok: false, message: `Not found (HTTP 404): ${u.host}${u.pathname}` }
    if (!res.ok) return { ok: false, message: `The server answered HTTP ${res.status} ${res.statusText}`.trim() }
    const contentType = res.headers.get('content-type') ?? ''
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > max) return { ok: false, message: `The file is ${(declared / MB).toFixed(0)} MB, over the ${(max / MB).toFixed(0)} MB limit. Raise it with --max-size <MB>.` }
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > max) {
          ctl.abort()
          return { ok: false, message: `The download passed the ${(max / MB).toFixed(0)} MB limit and was stopped. Raise it with --max-size <MB>.` }
        }
        chunks.push(value)
        o.onProgress?.(total)
      }
    }
    const bytes = new Uint8Array(total)
    let at = 0
    for (const c of chunks) {
      bytes.set(c, at)
      at += c.length
    }
    const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase()
    if (contentType.includes('text/html') || head.startsWith('<!doctype html') || head.startsWith('<html')) {
      return { ok: false, message: `The link returned a web page, not a trace. It may need you to sign in (try --header 'Authorization: ...') or point at a web view instead of the raw file.` }
    }
    return { ok: true, bytes, contentType }
  } catch (e) {
    if (ctl.signal.aborted) return { ok: false, message: `Timed out after ${Math.round(timeoutMs / 1000)}s fetching ${u.host}. Raise it with --timeout <seconds>.` }
    const cause = (e as { cause?: { code?: string; message?: string } }).cause
    return { ok: false, message: `Could not reach ${u.host}: ${cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e))}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Gzip files (magic bytes 1f 8b) are unpacked, whatever they are called. */
export function maybeGunzip(bytes: Uint8Array, maxBytes = DEFAULT_MAX_BYTES * 2): Uint8Array {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Uint8Array(gunzipSync(bytes, { maxOutputLength: maxBytes }))
  }
  return bytes
}

/** Claude Code keeps sub-agents next to the session: <session-id>/subagents/agent-*.jsonl + .meta.json. */
export function loadSubagents(file: string): ClaudeSubagent[] {
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

/** A file path or an http(s) link, read into bytes (gzip unpacked). */
export async function readInput(arg: string, o: FetchOptions = {}): Promise<InputResult> {
  try {
    if (isUrl(arg)) {
      const r = await fetchBytes(arg, o)
      if (!r.ok) return r
      return { ok: true, input: { name: arg, bytes: maybeGunzip(r.bytes), subagents: [] } }
    }
    if (!existsSync(arg)) return { ok: false, message: `cannot read ${arg}` }
    return { ok: true, input: { name: arg, bytes: maybeGunzip(new Uint8Array(readFileSync(arg))), subagents: loadSubagents(arg) } }
  } catch (e) {
    return { ok: false, message: `could not read ${arg}: ${e instanceof Error ? e.message : String(e)}` }
  }
}
