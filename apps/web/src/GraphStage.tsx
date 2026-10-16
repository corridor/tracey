import { createEffect, onCleanup, onMount } from 'solid-js'
import { readPalette, watchTheme } from '@ggx/trace-theme'
import { createGraphView } from '@ggx/trace-view-graph'
import type { GraphView } from '@ggx/trace-view-graph'
import { createStripView } from '@ggx/trace-view-timeline'
import type { StripView } from '@ggx/trace-view-timeline'
import type { Trace } from '@ggx/trace-model'
import { duration } from './format'

/** The graph canvas and the timeline strip below it, kept in sync with one selection. */
export function GraphStage(props: {
  trace: Trace
  selected: number
  highlight: readonly number[]
  onSelect: (i: number) => void
}) {
  let graphEl!: HTMLCanvasElement
  let stripEl!: HTMLCanvasElement
  let graph: GraphView | undefined
  let strip: StripView | undefined

  onMount(() => {
    const cs = getComputedStyle(document.documentElement)
    graph = createGraphView(graphEl, props.trace, {
      palette: readPalette(),
      fontFamily: cs.getPropertyValue('--tracey-font').trim() || undefined,
      monoFamily: cs.getPropertyValue('--tracey-font-mono').trim() || undefined,
      duration,
      onSelect: (i) => {
        strip?.select(i)
        props.onSelect(i)
      },
    })
    strip = createStripView(stripEl, props.trace, {
      palette: readPalette(),
      onSelect: (i) => {
        graph?.select(i, { frame: true })
        props.onSelect(i)
      },
    })
    const stop = watchTheme(() => {
      const p = readPalette()
      graph?.setPalette(p)
      strip?.setPalette(p)
    })
    onCleanup(() => {
      stop()
      graph?.destroy()
      strip?.destroy()
    })
    if (props.selected >= 0) {
      graph.select(props.selected, { frame: true })
      strip.select(props.selected)
    }
  })

  createEffect(() => {
    const i = props.selected
    if (i >= 0) {
      graph?.select(i, { frame: true })
      strip?.select(i)
    }
  })
  createEffect(() => {
    graph?.highlight(props.highlight)
    strip?.highlight(props.highlight)
  })

  return (
    <div class="gstage">
      <canvas ref={graphEl} class="graph-canvas" aria-label="Call graph. Arrow keys move between steps, F fits the view." />
      <canvas ref={stripEl} class="strip-canvas" aria-label="Timeline strip" />
    </div>
  )
}
