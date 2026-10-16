export interface DroppedFile {
  file: File
  /** Path relative to what was dropped, for example `abc123/subagents/agent-1.jsonl`. */
  path: string
}

export interface SubagentFiles {
  file: File
  meta?: File
}

export interface DropPlan {
  main: File
  subagents: SubagentFiles[]
}

/** Gather files from a drop, descending into folders (so a session folder with its sub-agents works). */
export async function filesFromDrop(dt: DataTransfer): Promise<DroppedFile[]> {
  // Entries must be taken synchronously, before the first await, or the browser clears them.
  const entries = Array.from(dt.items ?? [])
    .map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e)
  if (entries.length === 0) return Array.from(dt.files).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
  const out: DroppedFile[] = []
  for (const e of entries) await walk(e, '', out)
  return out
}

async function walk(entry: FileSystemEntry, prefix: string, out: DroppedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, path: `${prefix}${entry.name}` })
    return
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out)
  }
}

/** Claude Code writes sub-agents as `agent-<id>.jsonl` (+ `.meta.json`), normally under `<session>/subagents/`. */
const isSubagent = (path: string) => /(^|\/)agent-[^/]+\.(jsonl|meta\.json)$/.test(path)

/**
 * Decide what to open from a drop: one main trace file plus, for Claude Code sessions, the sub-agent files
 * that came with it (`<session>/subagents/agent-*.jsonl` and their `.meta.json`). With several candidates the
 * most recently modified wins, which suits dropping a whole project folder.
 */
export function planDrop(files: DroppedFile[]): DropPlan | undefined {
  const subs = files.filter((f) => isSubagent(f.path))
  const metas = new Map(subs.filter((f) => f.path.endsWith('.meta.json')).map((f) => [f.path.replace(/\.meta\.json$/, ''), f.file]))
  const subagents: SubagentFiles[] = subs
    .filter((f) => f.path.endsWith('.jsonl'))
    .map((f) => {
      const meta = metas.get(f.path.replace(/\.jsonl$/, ''))
      return meta ? { file: f.file, meta } : { file: f.file }
    })
  const candidates = files.filter((f) => !isSubagent(f.path) && !f.file.name.startsWith('.') && /\.(jsonl?|pb)$/i.test(f.file.name))
  const pool = candidates.length ? candidates : files.filter((f) => !isSubagent(f.path))
  if (pool.length === 0) return undefined
  const main = pool.reduce((a, b) => (b.file.lastModified > a.file.lastModified ? b : a)).file
  return { main, subagents }
}
