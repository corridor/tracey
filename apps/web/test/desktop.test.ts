import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileFromPath, isDesktop, listenForOpens } from '../src/desktop'

afterEach(() => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__
  vi.restoreAllMocks()
})

function fakeTauri(pending: string | null) {
  const listeners: Record<string, (e: { payload: unknown }) => void> = {}
  ;(globalThis as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: vi.fn().mockResolvedValue(pending),
      convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    },
    event: { listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => ((listeners[name] = cb), () => {})) },
  }
  return listeners
}

describe('desktop bridge', () => {
  it('is inert in a normal browser', () => {
    expect(isDesktop()).toBe(false)
    const open = vi.fn()
    listenForOpens(open)
    expect(open).not.toHaveBeenCalled()
  })

  it('reads a file through the asset protocol and names it after the path', async () => {
    fakeTauri(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"a":1}')))
    const f = await fileFromPath('/Users/me/runs/session.jsonl')
    expect(f.name).toBe('session.jsonl')
    expect(await f.text()).toBe('{"a":1}')
    vi.unstubAllGlobals()
  })

  it('opens the file the app was launched with, and later ones from events', async () => {
    const listeners = fakeTauri('/tmp/first.json')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{}')))
    const opened: string[] = []
    listenForOpens((f) => opened.push(f.name))
    await vi.waitFor(() => expect(opened).toEqual(['first.json']))
    listeners['tracey://open']!({ payload: '/tmp/second.jsonl' })
    await vi.waitFor(() => expect(opened).toEqual(['first.json', 'second.jsonl']))
    vi.unstubAllGlobals()
  })
})
