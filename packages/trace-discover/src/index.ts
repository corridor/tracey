import { readdir, stat, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type SessionSource = 'claude-code'

export interface SessionInfo {
  source: SessionSource
  /** Absolute path of the file to open. */
  path: string
  title?: string
  /** Working directory the session ran in, when the file says. */
  project?: string
  mtimeMs: number
  size: number
}

export interface DiscoverOptions {
  home?: string
  env?: Record<string, string | undefined>
  /** Newest N sessions are returned (and only those have their first KB read for a title). */
  limit?: number
}

/**
 * Where Claude Code keeps sessions: `$CLAUDE_CONFIG_DIR`, `~/.claude`, and any other `~/.claude*`
 * folder (people run profiles such as `~/.claude_work`). Only folders with a `projects/` dir count.
 */
export async function claudeConfigDirs(home: string, env: Record<string, string | undefined>): Promise<string[]> {
  const dirs = new Set<string>()
  if (env['CLAUDE_CONFIG_DIR']) dirs.add(env['CLAUDE_CONFIG_DIR'])
  try {
    for (const name of await readdir(home)) if (name === '.claude' || name.startsWith('.claude')) dirs.add(join(home, name))
  } catch {
    /* unreadable home: nothing to find */
  }
  const out: string[] = []
  for (const d of dirs) if (await isDir(join(d, 'projects'))) out.push(d)
  return out
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** Title and project path from the first few KB (never the conversation). */
export async function readHead(path: string): Promise<{ title?: string; project?: string }> {
  let fh
  try {
    fh = await open(path, 'r')
    const buf = Buffer.alloc(32 * 1024)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const head = buf.toString('utf8', 0, bytesRead)
    return { ...field(head, 'aiTitle', 'title'), ...field(head, 'cwd', 'project') }
  } catch {
    return {}
  } finally {
    await fh?.close()
  }
}

function field<K extends string>(head: string, key: string, as: K): Partial<Record<K, string>> {
  const m = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(head)
  if (!m) return {}
  try {
    const v = JSON.parse(m[1]!) as string
    return v ? ({ [as]: v } as Record<K, string>) : {}
  } catch {
    return {}
  }
}

/** Newest-first list of sessions found on this machine. Reads folder listings and file stats first. */
export async function discoverSessions(opts: DiscoverOptions = {}): Promise<SessionInfo[]> {
  const home = opts.home ?? homedir()
  const env = opts.env ?? process.env
  const found: SessionInfo[] = []
  for (const dir of await claudeConfigDirs(home, env)) {
    const projects = join(dir, 'projects')
    let names: string[] = []
    try {
      names = await readdir(projects)
    } catch {
      continue
    }
    for (const project of names) {
      let files: string[] = []
      try {
        files = await readdir(join(projects, project))
      } catch {
        continue // not a directory
      }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue // sub-agents live one level deeper, with their session
        const path = join(projects, project, f)
        try {
          const s = await stat(path)
          if (s.isFile() && s.size > 0) found.push({ source: 'claude-code', path, mtimeMs: s.mtimeMs, size: s.size })
        } catch {
          /* vanished while scanning */
        }
      }
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const top = found.slice(0, opts.limit ?? 200)
  await Promise.all(
    top.map(async (s) => {
      const h = await readHead(s.path)
      if (h.title) s.title = h.title
      if (h.project) s.project = h.project
    }),
  )
  return top
}

/** A short label for a session row. */
export function labelOf(s: SessionInfo): string {
  return s.title ?? (s.project ? basename(s.project) : basename(s.path, '.jsonl'))
}

export function ago(mtimeMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - mtimeMs) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(mtimeMs).toISOString().slice(0, 10)
}

