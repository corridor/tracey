import { matchSequences } from './seq'

export interface TextChange {
  type: 'same' | 'add' | 'del'
  text: string
}

/** Pretty-print JSON so a diff is line by line and readable; anything else is returned as it is. */
export function prettyIfJson(s: string): string {
  const t = s.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return s
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return s
  }
}

const MAX_LINES = 20_000

/** Line diff of two texts. Very large inputs fall back to "everything replaced" instead of stalling. */
export function diffText(a: string, b: string): TextChange[] {
  if (a === b) return a === '' ? [] : a.split('\n').map((text) => ({ type: 'same' as const, text }))
  const la = a === '' ? [] : a.split('\n')
  const lb = b === '' ? [] : b.split('\n')
  if (la.length > MAX_LINES || lb.length > MAX_LINES) {
    return [...la.map((text) => ({ type: 'del' as const, text })), ...lb.map((text) => ({ type: 'add' as const, text }))]
  }
  const out: TextChange[] = []
  let i = 0
  let j = 0
  for (const [x, y] of matchSequences(la, lb)) {
    while (i < x) out.push({ type: 'del', text: la[i++]! })
    while (j < y) out.push({ type: 'add', text: lb[j++]! })
    out.push({ type: 'same', text: la[x]! })
    i = x + 1
    j = y + 1
  }
  while (i < la.length) out.push({ type: 'del', text: la[i++]! })
  while (j < lb.length) out.push({ type: 'add', text: lb[j++]! })
  return out
}

export function countChanges(changes: TextChange[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const c of changes) c.type === 'add' ? added++ : c.type === 'del' && removed++
  return { added, removed }
}
