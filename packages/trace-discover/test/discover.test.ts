import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ago, claudeConfigDirs, discoverSessions, labelOf } from '../src/index'

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tracey-discover-'))
})
afterEach(() => rm(home, { recursive: true, force: true }))

async function session(config: string, project: string, name: string, body: string, ageSec = 0) {
  const dir = join(home, config, 'projects', project)
  await mkdir(dir, { recursive: true })
  const file = join(dir, name)
  await writeFile(file, body)
  const t = new Date(Date.now() - ageSec * 1000)
  await utimes(file, t, t)
  return file
}

describe('discoverSessions', () => {
  it('finds sessions in every ~/.claude* folder, newest first, with title and project', async () => {
    const a = await session('.claude', '-work-shop', 's1.jsonl', '{"type":"ai-title","aiTitle":"Fix login test"}\n{"cwd":"/work/shop"}\n', 600)
    const b = await session('.claude_work', '-work-api', 's2.jsonl', '{"type":"user","cwd":"/work/api"}\n', 10)
    const found = await discoverSessions({ home, env: {} })
    expect(found.map((s) => s.path)).toEqual([b, a])
    expect(found[1]).toMatchObject({ source: 'claude-code', title: 'Fix login test', project: '/work/shop' })
    expect(labelOf(found[0]!)).toBe('api')
    expect(labelOf(found[1]!)).toBe('Fix login test')
  })

  it('honours CLAUDE_CONFIG_DIR, ignores folders without projects/, empty files and sub-agent files', async () => {
    const custom = join(home, 'elsewhere')
    await mkdir(join(custom, 'projects', 'p'), { recursive: true })
    await writeFile(join(custom, 'projects', 'p', 'real.jsonl'), '{"cwd":"/x"}\n')
    await writeFile(join(custom, 'projects', 'p', 'empty.jsonl'), '')
    await writeFile(join(custom, 'projects', 'p', 'notes.txt'), 'x')
    await mkdir(join(custom, 'projects', 'p', 'real', 'subagents'), { recursive: true })
    await writeFile(join(custom, 'projects', 'p', 'real', 'subagents', 'agent-1.jsonl'), '{}\n')
    await mkdir(join(home, '.claude-empty'), { recursive: true })
    const found = await discoverSessions({ home, env: { CLAUDE_CONFIG_DIR: custom } })
    expect(found.map((s) => s.path)).toEqual([join(custom, 'projects', 'p', 'real.jsonl')])
    expect(await claudeConfigDirs(home, { CLAUDE_CONFIG_DIR: custom })).toEqual([custom])
  })

  it('returns an empty list when nothing is installed or the home is unreadable', async () => {
    expect(await discoverSessions({ home, env: {} })).toEqual([])
    expect(await discoverSessions({ home: join(home, 'missing'), env: {} })).toEqual([])
  })

  it('limits the list and reads only the head of each file for the title', async () => {
    for (let i = 0; i < 5; i++) await session('.claude', 'p', `s${i}.jsonl`, `{"aiTitle":"t${i}"}\n`, i * 100)
    const found = await discoverSessions({ home, env: {}, limit: 2 })
    expect(found.map((s) => s.title)).toEqual(['t0', 't1'])
  })

  it('formats ages', () => {
    const now = 1_000_000_000_000
    expect(ago(now - 5_000, now)).toBe('just now')
    expect(ago(now - 12 * 60_000, now)).toBe('12m ago')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(ago(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
})
