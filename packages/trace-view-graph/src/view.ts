import { SpanKind, SpanStatus } from '@ggx/trace-model'
import type { Trace } from '@ggx/trace-model'
import { layoutTree } from './layout'
import type { GraphLayout } from './layout'

/** Plain CSS colour strings, resolved from design tokens by the host (see @ggx/trace-theme readPalette). */
export interface Palette {
  bg: string
  surface: string
  border: string
  text: string
  textSecondary: string
  textMuted: string
  accent: string
  error: string
  warning: string
  kindAgent: string
  kindLlm: string
  kindTool: string
  kindRetrieval: string
  kindOther: string
}

export interface GraphViewOptions {
  palette: Palette
  fontFamily?: string
  monoFamily?: string
  /** Called when the user picks a span (click or keyboard). */
  onSelect?: (index: number) => void
  /** Called when the pointer rests on a span, or leaves all spans (-1). */
  onHover?: (index: number, clientX: number, clientY: number) => void
  /** Label shown for a span; defaults to its name. */
  duration?: (ms: number) => string
}

export interface GraphView {
  /** Programmatic selection. Does not call onSelect (that is for user input only). */
  select(index: number, opts?: { frame?: boolean }): void
  /** Outline a set of spans (for example the spans behind a finding). */
  highlight(indices: readonly number[]): void
  fit(): void
  /** Replace the trace (for example a live run that grew) keeping pan, zoom and, if it still exists, the selection. */
  setTrace(trace: Trace): void
  setPalette(p: Palette): void
  destroy(): void
}

const MIN_SCALE = 0.02
const MAX_SCALE = 3

export function createGraphView(canvas: HTMLCanvasElement, initial: Trace, opts: GraphViewOptions): GraphView {
  let trace = initial
  const ctx = canvas.getContext('2d', { alpha: true })!
  let L: GraphLayout = layoutTree(trace)
  const font = opts.fontFamily ?? 'ui-sans-serif, system-ui, sans-serif'
  const mono = opts.monoFamily ?? 'ui-monospace, monospace'
  const fmt = opts.duration ?? ((ms: number) => `${Math.round(ms)}ms`)
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  let palette = opts.palette
  let W = 0
  let H = 0
  let dpr = 1
  let scale = 1
  let tx = 0
  let ty = 0
  let selected = -1
  let hovered = -1
  let marked = new Set<number>()
  let raf = 0
  let anim: { from: [number, number, number]; to: [number, number, number]; t0: number } | undefined

  const kindColor = (i: number): string => {
    if (trace.status[i] === SpanStatus.Error) return palette.error
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

  function resize() {
    const r = canvas.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 3)
    W = Math.max(1, Math.round(r.width))
    H = Math.max(1, Math.round(r.height))
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    request()
  }

  function setView(s: number, x: number, y: number) {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
    tx = x
    ty = y
    request()
  }

  function animateTo(s: number, x: number, y: number) {
    if (reduced) return setView(s, x, y)
    anim = { from: [scale, tx, ty], to: [s, x, y], t0: performance.now() }
    request()
  }

  function fitTarget(): [number, number, number] {
    const pad = 32
    const s = Math.min(1, Math.min((W - pad * 2) / Math.max(1, L.width), (H - pad * 2) / Math.max(1, L.height)))
    return [s, (W - L.width * s) / 2, (H - L.height * s) / 2]
  }

  /** Centre a node at a readable zoom. */
  function frameTarget(i: number): [number, number, number] {
    const s = Math.min(1, Math.max(scale, 0.7))
    const cx = L.x[i]! + L.nodeW / 2
    const cy = L.y[i]! + L.nodeH / 2
    return [s, W / 2 - cx * s, H / 2 - cy * s]
  }

  function initialView() {
    const fit = fitTarget()
    if (fit[0] >= 0.5 || trace.count === 0) return setView(...fit)
    const first = marked.size ? [...marked][0]! : (trace.roots[0] ?? 0)
    const f = frameTarget(first)
    setView(f[0], f[1], f[2])
  }

  /** Spans whose box intersects the viewport. O(n) with a cheap rejection test. */
  function visible(): number[] {
    const out: number[] = []
    const x0 = -tx / scale - L.nodeW
    const x1 = (W - tx) / scale
    const y0 = -ty / scale - L.nodeH
    const y1 = (H - ty) / scale
    for (let i = 0; i < trace.count; i++) {
      const x = L.x[i]!
      const y = L.y[i]!
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push(i)
    }
    return out
  }

  function draw() {
    raf = 0
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.t0) / 220)
      const e = 1 - (1 - k) ** 3
      scale = anim.from[0] + (anim.to[0] - anim.from[0]) * e
      tx = anim.from[1] + (anim.to[1] - anim.from[1]) * e
      ty = anim.from[2] + (anim.to[2] - anim.from[2]) * e
      if (k >= 1) anim = undefined
      else request()
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const vis = visible()
    const nw = L.nodeW * scale
    const nh = L.nodeH * scale

    // Dot grid, only when zoomed in enough to be calm.
    if (scale >= 0.45) {
      const step = 24 * scale
      ctx.fillStyle = palette.border
      ctx.globalAlpha = 0.55
      for (let gx = ((tx % step) + step) % step; gx < W; gx += step)
        for (let gy = ((ty % step) + step) % step; gy < H; gy += step) ctx.fillRect(gx, gy, 1.2, 1.2)
      ctx.globalAlpha = 1
    }

    // Edges: curves when readable, straight and thin when zoomed out, skipped when tiny and numerous.
    if (scale >= 0.08 || vis.length < 1500) {
      ctx.lineWidth = scale >= 0.4 ? 1.4 : 1
      for (const pass of [0, 1]) {
        ctx.beginPath()
        for (const i of vis) {
          const p = trace.parent[i]!
          if (p < 0) continue
          const err = trace.status[i] === SpanStatus.Error
          if ((pass === 1) !== err) continue
          const ax = (L.x[p]! + L.nodeW) * scale + tx
          const ay = (L.y[p]! + L.nodeH / 2) * scale + ty
          const bx = L.x[i]! * scale + tx
          const by = (L.y[i]! + L.nodeH / 2) * scale + ty
          ctx.moveTo(ax, ay)
          if (scale >= 0.4) {
            const mx = (ax + bx) / 2
            ctx.bezierCurveTo(mx, ay, mx, by, bx, by)
          } else ctx.lineTo(bx, by)
        }
        ctx.strokeStyle = pass === 1 ? palette.error : palette.textMuted
        ctx.globalAlpha = pass === 1 ? 0.8 : 0.7
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // Nodes by level of detail.
    const full = nw >= 90
    const mid = nw >= 14
    ctx.textBaseline = 'middle'
    for (const i of vis) {
      const sx = L.x[i]! * scale + tx
      const sy = L.y[i]! * scale + ty
      const color = kindColor(i)
      const sel = i === selected
      if (!mid) {
        ctx.fillStyle = color
        ctx.fillRect(sx, sy, Math.max(2, nw), Math.max(1.5, nh))
        continue
      }
      const r = Math.min(8 * scale, nh / 3)
      ctx.beginPath()
      ctx.roundRect(sx, sy, nw, nh, r)
      ctx.fillStyle = palette.surface
      ctx.fill()
      ctx.lineWidth = sel ? 2 : 1
      ctx.strokeStyle = sel ? palette.accent : hovered === i ? palette.textSecondary : palette.border
      ctx.stroke()
      // Kind accent on the left edge.
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(sx, sy, Math.max(3, 5 * scale), nh, [r, 0, 0, r])
      ctx.fill()
      if (marked.has(i)) {
        ctx.lineWidth = 2
        ctx.strokeStyle = trace.status[i] === SpanStatus.Error ? palette.error : palette.warning
        ctx.beginPath()
        ctx.roundRect(sx - 3, sy - 3, nw + 6, nh + 6, r + 3)
        ctx.stroke()
      }
      if (full) {
        const fs = Math.min(13, 12.5 * scale + 0.5)
        ctx.font = `500 ${fs}px ${font}`
        const pad = 14 * scale
        const durText = fmt(trace.spanDuration(i))
        ctx.font = `${Math.max(9, fs - 2)}px ${mono}`
        const dw = ctx.measureText(durText).width
        ctx.font = `500 ${fs}px ${font}`
        const maxChars = Math.max(3, Math.floor((nw - pad - dw - 14 * scale) / (fs * 0.56)))
        const name = trace.nameOf(i)
        ctx.fillStyle = palette.text
        ctx.textAlign = 'left'
        ctx.fillText(name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name, sx + pad, sy + nh / 2)
        ctx.font = `${Math.max(9, fs - 2)}px ${mono}`
        ctx.fillStyle = trace.status[i] === SpanStatus.Error ? palette.error : palette.textMuted
        ctx.textAlign = 'right'
        ctx.fillText(durText, sx + nw - 8 * scale, sy + nh / 2)
      }
    }
  }

  // ---- hit testing ----
  function hit(px: number, py: number): number {
    const wx = (px - tx) / scale
    const wy = (py - ty) / scale
    let best = -1
    for (let i = 0; i < trace.count; i++) {
      if (wx >= L.x[i]! && wx <= L.x[i]! + L.nodeW && wy >= L.y[i]! && wy <= L.y[i]! + L.nodeH) best = i
    }
    return best
  }

  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  // ---- input ----
  const pointers = new Map<number, [number, number]>()
  let dragStart: { x: number; y: number; tx: number; ty: number; moved: boolean } | undefined
  let pinch: { dist: number; scale: number } | undefined

  function zoomAt(px: number, py: number, factor: number) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor))
    const k = s / scale
    anim = undefined
    setView(s, px - (px - tx) * k, py - (py - ty) * k)
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, pos(e))
    anim = undefined
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [[number, number], [number, number]]
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), scale }
      dragStart = undefined
    } else {
      const [x, y] = pos(e)
      dragStart = { x, y, tx, ty, moved: false }
    }
  })
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e)
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p)
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [[number, number], [number, number]]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch.scale * d) / pinch.dist / scale)
    } else if (dragStart && pointers.size === 1) {
      if (Math.abs(p[0] - dragStart.x) + Math.abs(p[1] - dragStart.y) > 3) dragStart.moved = true
      if (dragStart.moved) setView(scale, dragStart.tx + p[0] - dragStart.x, dragStart.ty + p[1] - dragStart.y)
    } else if (e.pointerType === 'mouse') {
      const h = hit(p[0], p[1])
      if (h !== hovered) {
        hovered = h
        canvas.style.cursor = h >= 0 ? 'pointer' : 'grab'
        opts.onHover?.(h, e.clientX, e.clientY)
        request()
      }
    }
  })
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = undefined
    if (dragStart && !dragStart.moved && e.type === 'pointerup') {
      const [x, y] = pos(e)
      const h = hit(x, y)
      if (h >= 0) pick(h)
    }
    if (pointers.size === 0) dragStart = undefined
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerleave', () => {
    if (hovered !== -1) {
      hovered = -1
      opts.onHover?.(-1, 0, 0)
      request()
    }
  })
  canvas.addEventListener('dblclick', (e) => {
    const [x, y] = pos(e)
    const h = hit(x, y)
    if (h < 0) return
    const s = Math.max(scale, 1)
    animateTo(s, W / 2 - (L.x[h]! + L.nodeW / 2) * s, H / 2 - (L.y[h]! + L.nodeH / 2) * s)
  })
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const [x, y] = pos(e)
      // Pinch on a trackpad arrives as ctrl+wheel; plain wheel pans, like excalidraw.
      if (e.ctrlKey || e.metaKey) zoomAt(x, y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)))
      else {
        anim = undefined
        setView(scale, tx - e.deltaX, ty - e.deltaY)
      }
    },
    { passive: false },
  )

  const neighbour = (key: string): number => {
    const i = selected
    if (i < 0) return trace.roots[0] ?? -1
    const p = trace.parent[i]!
    const sibs = p >= 0 ? trace.children(p) : trace.roots
    const at = sibs.indexOf(i)
    if (key === 'ArrowLeft') return p
    if (key === 'ArrowRight') return trace.children(i)[0] ?? -1
    if (key === 'ArrowUp') return sibs[at - 1] ?? -1
    if (key === 'ArrowDown') return sibs[at + 1] ?? -1
    return -1
  }
  canvas.tabIndex = 0
  canvas.addEventListener('keydown', (e) => {
    if (e.key.startsWith('Arrow')) {
      const n = neighbour(e.key)
      if (n >= 0) pick(n, true)
      e.preventDefault()
    } else if (e.key === 'f' || e.key === '0') api.fit()
    else if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.25)
    else if (e.key === '-') zoomAt(W / 2, H / 2, 0.8)
  })

  /** A user chose a span: update, then tell the host. Programmatic select() never calls back. */
  function pick(i: number, frame = false) {
    api.select(i, { frame })
    opts.onSelect?.(i)
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  const api: GraphView = {
    select(i, o) {
      selected = i
      if (o?.frame && i >= 0) animateTo(...frameTarget(i))
      else request()
    },
    highlight(indices) {
      marked = new Set(indices)
      request()
    },
    fit() {
      animateTo(...fitTarget())
    },
    setTrace(t) {
      trace = t
      L = layoutTree(t)
      if (selected >= t.count) selected = -1
      marked = new Set([...marked].filter((i) => i < t.count))
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

  canvas.style.cursor = 'grab'
  canvas.style.touchAction = 'none'
  resize()
  initialView()
  return api
}
