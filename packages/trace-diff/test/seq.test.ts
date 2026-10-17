import { describe, expect, it } from 'vitest'
import { matchSequences } from '../src/seq'

const lcs = (a: string, b: string) => matchSequences([...a], [...b]).map(([x, y]) => [a[x], b[y]] as const)

describe('matchSequences', () => {
  it('matches identical, empty and disjoint sequences', () => {
    expect(matchSequences([1, 2, 3], [1, 2, 3])).toEqual([[0, 0], [1, 1], [2, 2]])
    expect(matchSequences([], [1])).toEqual([])
    expect(matchSequences([1], [])).toEqual([])
    expect(matchSequences([1, 2], [3, 4])).toEqual([])
  })

  it('finds a longest common subsequence (classic ABCABBA / CBABAC)', () => {
    const m = matchSequences([...'ABCABBA'], [...'CBABAC'])
    expect(m).toHaveLength(4)
    for (let i = 1; i < m.length; i++) {
      expect(m[i]![0]).toBeGreaterThan(m[i - 1]![0])
      expect(m[i]![1]).toBeGreaterThan(m[i - 1]![1])
    }
    expect(m.every(([x, y]) => 'ABCABBA'[x] === 'CBABAC'[y])).toBe(true)
  })

  it('handles an insertion, a deletion and a swap', () => {
    expect(lcs('abcd', 'abXcd').map(([c]) => c).join('')).toBe('abcd')
    expect(lcs('abcd', 'acd').map(([c]) => c).join('')).toBe('acd')
    expect(matchSequences([...'ab'], [...'ba']).length).toBe(1)
  })

  it('uses a custom equality', () => {
    const m = matchSequences(['A', 'b'], ['a', 'B'], (x, y) => x.toLowerCase() === y.toLowerCase())
    expect(m).toEqual([[0, 0], [1, 1]])
  })

  it('stays fast on large similar inputs and gives up gracefully on very different ones', () => {
    const a = Array.from({ length: 20_000 }, (_, i) => i)
    const b = a.filter((i) => i % 500 !== 0)
    const t0 = performance.now()
    expect(matchSequences(a, b)).toHaveLength(b.length)
    expect(performance.now() - t0).toBeLessThan(2000)
    // Completely different: capped, returns without hanging (middle left unmatched).
    const x = Array.from({ length: 4000 }, (_, i) => `a${i}`)
    const y = Array.from({ length: 4000 }, (_, i) => `b${i}`)
    const t1 = performance.now()
    expect(matchSequences(x, y)).toEqual([])
    expect(performance.now() - t1).toBeLessThan(3000)
  })
})
