import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '@ggx/trace-discover'
import { decode, filtered, render, step } from '../src/picker'
import { style } from '../src/format'

const s = (title: string, project: string, mtimeMs: number): SessionInfo => ({ source: 'claude-code', path: `/x/${title}.jsonl`, title, project, mtimeMs, size: 1 })
const items = [s('Fix login test', '/work/shop', 3000), s('Refactor billing', '/work/shop', 2000), s('Explain auth', '/work/api', 1000)]
const start = { items, query: '', cursor: 0 }

describe('picker', () => {
  it('moves the cursor within bounds and picks with enter', () => {
    let st = step(start, 'up').state
    expect(st.cursor).toBe(0)
    st = step(step(st, 'down').state, 'down').state
    st = step(st, 'down').state
    expect(st.cursor).toBe(2)
    expect(step(st, 'enter').done?.picked?.title).toBe('Explain auth')
  })

  it('filters as you type over title, project and path, and resets the cursor', () => {
    let st = start
    for (const ch of 'api') st = step(st, { char: ch }).state
    expect(filtered(st).map((i) => i.title)).toEqual(['Explain auth'])
    expect(step(st, 'enter').done?.picked?.title).toBe('Explain auth')
    st = step(step(step(st, 'backspace').state, 'backspace').state, 'backspace').state
    expect(filtered(st)).toHaveLength(3)
  })

  it('enter on an empty match picks nothing; quit ends without a pick', () => {
    const none = step(start, { char: 'z' }).state
    expect(step(none, 'enter').done).toEqual({ picked: undefined })
    expect(step(start, 'quit').done).toEqual({})
  })

  it('renders a header, the selected row, and hints', () => {
    const lines = render(start, style(false), 3000 + 12 * 60_000)
    expect(lines[0]).toContain('What do you want to look at?')
    expect(lines[0]).toContain('3 of 3')
    expect(lines[2]).toMatch(/^❯ Fix login test/)
    expect(lines[2]).toContain('12m ago')
    expect(lines.at(-1)).toContain('esc quit')
  })

  it('decodes arrows, enter, backspace, escape and typed characters', () => {
    expect(decode('\x1b[A\x1b[B\r')).toEqual(['up', 'down', 'enter'])
    expect(decode('a\x7f')).toEqual([{ char: 'a' }, 'backspace'])
    expect(decode('\x1b')).toEqual(['quit'])
    expect(decode('\x03')).toEqual(['quit'])
  })
})
