import { ago, labelOf } from '@ggx/trace-discover'
import type { SessionInfo } from '@ggx/trace-discover'
import { style } from './format'
import type { Style } from './format'

export interface PickerState {
  items: SessionInfo[]
  query: string
  cursor: number
}

export type PickerKey = 'up' | 'down' | 'enter' | 'quit' | 'backspace' | { char: string }

export const ROWS = 12

export function filtered(s: PickerState): SessionInfo[] {
  const q = s.query.trim().toLowerCase()
  if (!q) return s.items
  return s.items.filter((i) => `${labelOf(i)} ${i.project ?? ''} ${i.path}`.toLowerCase().includes(q))
}

/** Pure update: returns the new state and, when the user chose or quit, the outcome. */
export function step(s: PickerState, key: PickerKey): { state: PickerState; done?: { picked?: SessionInfo } } {
  const list = filtered(s)
  if (key === 'enter') return { state: s, done: { picked: list[s.cursor] } }
  if (key === 'quit') return { state: s, done: {} }
  if (key === 'up') return { state: { ...s, cursor: Math.max(0, s.cursor - 1) } }
  if (key === 'down') return { state: { ...s, cursor: Math.min(Math.max(0, list.length - 1), s.cursor + 1) } }
  if (key === 'backspace') return { state: { ...s, query: s.query.slice(0, -1), cursor: 0 } }
  return { state: { ...s, query: s.query + key.char, cursor: 0 } }
}

export function render(s: PickerState, st: Style, now = Date.now()): string[] {
  const list = filtered(s)
  const start = Math.min(Math.max(0, s.cursor - Math.floor(ROWS / 2)), Math.max(0, list.length - ROWS))
  const rows = list.slice(start, start + ROWS).map((i, k) => {
    const on = start + k === s.cursor
    const label = labelOf(i).slice(0, 44).padEnd(44)
    const meta = `${i.source.padEnd(11)} ${ago(i.mtimeMs, now).padEnd(9)} ${i.project ?? ''}`
    return `${on ? st.blue('❯') : ' '} ${on ? st.bold(label) : label} ${st.dim(meta)}`
  })
  return [
    `${st.blue('?')} ${st.bold('What do you want to look at?')} ${st.dim(`${list.length} of ${s.items.length} sessions`)}`,
    `  ${st.dim('filter:')} ${s.query}`,
    ...(rows.length ? rows : [`  ${st.dim('nothing matches')}`]),
    `  ${st.dim('↑↓ move · type to filter · ↵ open · esc quit')}`,
  ]
}

/** Decode raw terminal input into picker keys. */
export function decode(chunk: string): PickerKey[] {
  const out: PickerKey[] = []
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i]!
    if (c === '\x1b') {
      if (chunk[i + 1] === '[' && (chunk[i + 2] === 'A' || chunk[i + 2] === 'B')) {
        out.push(chunk[i + 2] === 'A' ? 'up' : 'down')
        i += 2
      } else out.push('quit')
    } else if (c === '\r' || c === '\n') out.push('enter')
    else if (c === '\x03' || c === '\x04') out.push('quit')
    else if (c === '\x7f' || c === '\b') out.push('backspace')
    else if (c === '\x10') out.push('up')
    else if (c === '\x0e') out.push('down')
    else if (c >= ' ') out.push({ char: c })
  }
  return out
}

/** Interactive loop on a real terminal. Returns the chosen session, or undefined if the user quit. */
export function runPicker(items: SessionInfo[], io: { stdin: NodeJS.ReadStream; write: (s: string) => void; color: boolean }): Promise<SessionInfo | undefined> {
  const st = style(io.color)
  let state: PickerState = { items, query: '', cursor: 0 }
  let drawn = 0
  const draw = () => {
    const lines = render(state, st)
    io.write(`${drawn ? `\x1b[${drawn}A` : ''}\x1b[J${lines.join('\n')}\n`)
    drawn = lines.length
  }
  return new Promise((resolve) => {
    io.stdin.setRawMode(true)
    io.stdin.resume()
    io.stdin.setEncoding('utf8')
    const finish = (picked?: SessionInfo) => {
      io.stdin.setRawMode(false)
      io.stdin.pause()
      io.stdin.off('data', onData)
      io.write(`\x1b[${drawn}A\x1b[J`)
      resolve(picked)
    }
    const onData = (chunk: string) => {
      for (const key of decode(chunk)) {
        const r = step(state, key)
        state = r.state
        if (r.done) return finish(r.done.picked)
      }
      draw()
    }
    io.stdin.on('data', onData)
    draw()
  })
}
