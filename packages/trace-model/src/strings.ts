/** Interns strings so repeated names and models cost one array slot each. */
export class StringTable {
  readonly values: string[] = ['']
  private readonly index = new Map<string, number>([['', 0]])

  /** Rebuild a table from its `values` (for example after crossing a worker boundary). */
  static from(values: readonly string[]): StringTable {
    const t = new StringTable()
    t.values.length = 0
    values.forEach((v, i) => {
      t.values.push(v)
      if (!t['index'].has(v)) t['index'].set(v, i)
    })
    return t
  }

  intern(s: string | undefined): number {
    if (!s) return 0
    let i = this.index.get(s)
    if (i === undefined) {
      i = this.values.length
      this.values.push(s)
      this.index.set(s, i)
    }
    return i
  }

  get(i: number): string {
    return this.values[i] ?? ''
  }
}
