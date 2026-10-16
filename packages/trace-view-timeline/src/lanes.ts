import type { Trace } from '@ggx/trace-model'

export interface StripLayout {
  /** Spans sorted by start time. */
  byStart: Int32Array
  /** Lane (row) of each span: its depth, capped. */
  lane: Uint8Array
  lanes: number
}

/** Lanes follow depth so a parent and its children never share a row; deeper spans share the last lane. */
export function layoutStrip(t: Trace, maxLanes = 6): StripLayout {
  const n = t.count
  const byStart = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => t.start[a]! - t.start[b]! || a - b)
  const lane = new Uint8Array(n)
  let max = 0
  for (let i = 0; i < n; i++) {
    lane[i] = Math.min(t.depth[i]!, maxLanes - 1)
    if (lane[i]! > max) max = lane[i]!
  }
  return { byStart, lane, lanes: n ? max + 1 : 1 }
}

/**
 * Which pixel columns of each lane need drawing. Sub-pixel spans that land in an already-covered
 * column are skipped (level of detail), except errors, which are always drawn.
 */
export function visibleBars(
  t: Trace,
  s: StripLayout,
  width: number,
  isError: (i: number) => boolean,
): { index: number; x: number; w: number }[] {
  const out: { index: number; x: number; w: number }[] = []
  const total = Math.max(1e-6, t.duration)
  const covered = new Float64Array(s.lanes).fill(-1)
  for (const i of s.byStart) {
    const x0 = ((t.start[i]! - t.t0) / total) * width
    const x1 = ((t.end[i]! - t.t0) / total) * width
    const lane = s.lane[i]!
    const err = isError(i)
    if (!err && x1 <= covered[lane]! && x1 - x0 < 1.5) continue
    const x = Math.floor(x0)
    const w = Math.max(1.5, x1 - x0)
    out.push({ index: i, x, w })
    if (x + w > covered[lane]!) covered[lane] = x + w
  }
  return out
}
