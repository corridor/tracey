const HINT =
  'Claude Code sessions are the .jsonl files in ~/.claude/projects/<project>/ (a hidden folder: in the file picker press Cmd+Shift+. on macOS or Ctrl+H on Linux, or drag the file from Finder after showing hidden files).'

/**
 * A specific, kind explanation of why a file was not recognised, for the page to show. Looks only at the
 * first few KB and reports shapes (keys, record types), never content.
 */
export function explainUnrecognised(bytes: Uint8Array, fileName = ''): string {
  if (bytes.length === 0) return 'This file is empty.'
  const head = bytes.subarray(0, 8192)
  let binary = 0
  for (const b of head) if (b === 0 || (b < 9) || (b > 13 && b < 32)) binary++
  if (binary > head.length * 0.05) return `This looks like a binary file, not a trace. tracey reads OTLP traces (JSON or protobuf), and Claude Code session files (.jsonl). ${HINT}`

  const text = new TextDecoder().decode(head)
  const lines = text.split('\n').filter((l) => l.trim())
  const records: Record<string, unknown>[] = []
  for (const l of lines.slice(0, 40)) {
    if (!l.trim().startsWith('{')) continue
    try {
      records.push(JSON.parse(l) as Record<string, unknown>)
    } catch {
      /* a line cut by the 8 KB window, or not JSON */
    }
  }
  const name = fileName ? ` (${fileName})` : ''

  if (records.length > 0 && records.length >= Math.min(3, lines.length) - 1) {
    const types = [...new Set(records.map((r) => (typeof r['type'] === 'string' ? (r['type'] as string) : undefined)).filter(Boolean))].slice(0, 6)
    const keys = [...new Set(records.flatMap((r) => Object.keys(r)))].slice(0, 8)
    if (keys.includes('display') && keys.includes('pastedContents')) {
      return `This is Claude Code's prompt history (history.jsonl)${name}: it lists what you typed, not what happened. The sessions themselves are in projects/<project>/<session>.jsonl next to it. ${HINT}`
    }
    return `This is JSON lines${name} with ${types.length ? `record types ${types.join(', ')}` : `keys ${keys.join(', ')}`}, but not a format tracey knows: Claude Code transcripts carry sessionId, uuid and a version, and OTLP spans carry resourceSpans. ${HINT}`
  }
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const v = JSON.parse(t)
      const keys = Array.isArray(v) ? `an array of ${typeof v[0]}` : `keys ${Object.keys(v).slice(0, 8).join(', ')}`
      return `This is JSON${name} with ${keys}, but not OTLP traces (resourceSpans) or a known vendor export yet. Supported: OpenInference, OpenTelemetry GenAI and OpenLLMetry (OTLP JSON or protobuf), and Claude Code transcripts.`
    } catch {
      return `This starts like JSON${name} but could not be read as one document or as lines of JSON (it may be cut off). Supported: OTLP JSON or protobuf, and Claude Code transcripts (.jsonl).`
    }
  }
  return `This looks like a plain-text log${name}, not a trace. tracey reads OTLP traces (JSON or protobuf) and Claude Code session files. ${HINT}`
}
