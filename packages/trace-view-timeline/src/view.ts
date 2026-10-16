import { SpanKind, SpanStatus } from '@ggx/trace-model'
import type { Trace } from '@ggx/trace-model'
import { layoutStrip, visibleBars } from './lanes'

export interface StripPalette {
  surface: string
  border: string
  accent: string
  error: string
  textMuted: string
  kindAgent: string
  kindLlm: string
  kindTool: string
  kindRetrieval: string
  kindOther: string
}

export interface StripOptions {
  palette: StripPalette
  onSelect?: (index: number) => void
}

export interface StripView {
  /** Programmatic selection. Does not call onSelect (that is for user input only). */
  select(index: number): void
  highlight(indices: readonly number[]): void
  /** Replace the trace (a live run that grew), keeping the selection if it still exists. */
  setTrace(trace: Trace): void
  setPalette(p: StripPalette): void
  destroy(): void
}

export function createStripView(canvas: HTMLCanvasElement, initial: Trace, opts: StripOptions): StripView {
  let trace = initial
  const ctx = canvas.getContext('2d')!
  let S = layoutStrip(trace)
  let palette = opts.palette
  let W = 1
  let H = 1
  let dpr = 1
  let selected = -1
  let marked = new Set<number>()
  let raf = 0
  let bars: { index: number; x: number; w: number }[] = []

  const isError = (i: number) => trace.status[i] === SpanStatus.Error
  const color = (i: number) => {
    if (isError(i)) return palette.error
    switch (trace.kind[i]) {
      case SpanKind.Agent: return palette.kindAgent
      case SpanKind.Llm: return palette.kindLlm
      case SpanKind.Tool: return palette.kindTool
      case SpanKind.Retrieval:
      case SpanKind.Embedding: return palette.kindRetrieval
      default: return palette.kindOther
    }
  }
  const request = () => {
    if (!raf) raf = requestAnimationFrame(draw)
  }
  const laneH = () => (H - 4) / S.lanes

  function resize() {
    const r = canvas.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 3)
    W = Math.max(1, Math.round(r.width))
    H = Math.max(1, Math.round(r.height))
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    bars = visibleBars(trace, S, W, isError)
    request()
  }

  function draw() {
    raf = 0
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const lh = laneH()
    const h = Math.max(2, Math.min(10, lh - 1.5))
    // Errors last so they sit on top of everything.
    for (const pass of [0, 1]) {
      for (const b of bars) {
        if (isError(b.index) !== (pass === 1)) continue
        ctx.fillStyle = color(b.index)
        ctx.globalAlpha = pass === 1 ? 1 : 0.85
        ctx.fillRect(b.x, 2 + S.lane[b.index]! * lh + (lh - h) / 2, b.w, h)
      }
    }
    ctx.globalAlpha = 1
    const mark = (i: number, c: string, lw: number) => {
      const x = ((trace.start[i]! - trace.t0) / Math.max(1e-6, trace.duration)) * W
      const w = Math.max(3, ((trace.end[i]! - trace.start[i]!) / Math.max(1e-6, trace.duration)) * W)
      ctx.strokeStyle = c
      ctx.lineWidth = lw
      ctx.strokeRect(x - 1.5, 2 + S.lane[i]! * lh + (lh - h) / 2 - 1.5, w + 3, h + 3)
    }
    for (const i of marked) mark(i, isError(i) ? palette.error : palette.accent, 1)
    if (selected >= 0) {
      mark(selected, palette.accent, 2)
      const x = ((trace.start[selected]! - trace.t0) / Math.max(1e-6, trace.duration)) * W
      ctx.fillStyle = palette.accent
      ctx.globalAlpha = 0.35
      ctx.fillRect(Math.round(x), 0, 1, H)
      ctx.globalAlpha = 1
    }
  }

  /** The span under a point: among spans covering that time in that lane, the shortest one. */
  function hit(px: number, py: number): number {
    const lane = Math.min(S.lanes - 1, Math.max(0, Math.floor((py - 2) / laneH())))
    const t = trace.t0 + (px / W) * trace.duration
    const slack = (trace.duration / W) * 3
    let best = -1
    let bestLen = Infinity
    for (let i = 0; i < trace.count; i++) {
      if (S.lane[i] !== lane) continue
      if (trace.start[i]! - slack <= t && trace.end[i]! + slack >= t) {
        const len = trace.end[i]! - trace.start[i]!
        if (len < bestLen) {
          best = i
          bestLen = len
        }
      }
    }
    return best
  }

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect()
    const h = hit(e.clientX - r.left, e.clientY - r.top)
    if (h >= 0) {
      api.select(h)
      opts.onSelect?.(h)
    }
  })
  canvas.style.cursor = 'pointer'
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  const api: StripView = {
    select(i) {
      selected = i
      request()
    },
    highlight(indices) {
      marked = new Set(indices)
      request()
    },
    setTrace(t) {
      trace = t
      S = layoutStrip(t)
      if (selected >= t.count) selected = -1
      marked = new Set([...marked].filter((i) => i < t.count))
      bars = visibleBars(trace, S, W, isError)
      request()
    },
    setPalette(p) {
      palette = p
      request()
    },
    destroy() {
      ro.disconnect()
      cancelAnimationFrame(raf)
    },
  }
  resize()
  return api
}
