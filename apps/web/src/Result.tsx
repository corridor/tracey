import { For, Show, createMemo, createSignal } from 'solid-js'
import { SpanKind, SpanStatus, kindLabel } from '@ggx/trace-model'
import type { Finding } from '@ggx/trace-insights'
import type { Loaded } from './load'
import { duration } from './format'

const ROW = 26

export function Result(props: { loaded: Loaded }) {
  const t = () => props.loaded.trace
  const [selected, setSelected] = createSignal<number>(props.loaded.findings[0]?.spans[0] ?? t().order[0] ?? -1)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewH, setViewH] = createSignal(400)
  let scroller!: HTMLDivElement

  const rowOf = createMemo(() => {
    const m = new Int32Array(t().count)
    t().order.forEach((span, row) => (m[span] = row))
    return m
  })

  const select = (i: number, scroll = false) => {
    setSelected(i)
    if (scroll && scroller) scroller.scrollTop = Math.max(0, rowOf()[i]! * ROW - viewH() / 3)
  }

  const visible = createMemo(() => {
    const from = Math.max(0, Math.floor(scrollTop() / ROW) - 5)
    const to = Math.min(t().count, Math.ceil((scrollTop() + viewH()) / ROW) + 5)
    return Array.from(t().order.subarray(from, to), (span, k) => ({ span, row: from + k }))
  })

  const pct = (v: number) => `${(((v - t().t0) / Math.max(1, t().duration)) * 100).toFixed(3)}%`
  const width = (i: number) => `max(2px, ${((t().spanDuration(i) / Math.max(1, t().duration)) * 100).toFixed(3)}%)`
  const kindClass = (i: number) => (t().status[i] === SpanStatus.Error ? 'k-error' : `k-${kindLabel(t().kind[i] as SpanKind)}`)

  return (
    <div class="result-wrap">
    <div class="result">
      <aside class="panel findings" aria-label="Findings">
        <h2>Findings</h2>
        <Show when={props.loaded.findings.length} fallback={<p class="ok-note">✓ No problems found</p>}>
          <For each={props.loaded.findings}>
            {(f) => <FindingCard f={f} t={t()} onPick={(i) => select(i, true)} />}
          </For>
        </Show>
      </aside>

      <section class="panel timeline" aria-label="Timeline">
        <h2>Run</h2>
        <div
          class="rows"
          ref={(el) => {
            scroller = el
            queueMicrotask(() => setViewH(el.clientHeight))
            new ResizeObserver(() => setViewH(el.clientHeight)).observe(el)
          }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ height: `${t().count * ROW}px`, position: 'relative' }}>
            <For each={visible()}>
              {(v) => (
                <button
                  class="row"
                  classList={{ sel: selected() === v.span }}
                  style={{ top: `${v.row * ROW}px`, height: `${ROW}px` }}
                  onClick={() => select(v.span)}
                >
                  <span class="label" style={{ 'padding-left': `${t().depth[v.span]! * 12}px` }}>
                    <span class={`swatch ${kindClass(v.span)}`} />
                    {t().nameOf(v.span)}
                  </span>
                  <span class="track">
                    <span class={`bar-seg ${kindClass(v.span)}`} style={{ left: pct(t().start[v.span]!), width: width(v.span) }} />
                  </span>
                  <span class="dur mono">{duration(t().spanDuration(v.span))}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </section>

      <aside class="panel inspector" aria-label="Inspector">
        <Show when={selected() >= 0}>
          <Inspector t={t()} i={selected()} />
        </Show>
      </aside>
    </div>
    </div>
  )
}

function FindingCard(props: { f: Finding; t: Loaded['trace']; onPick: (i: number) => void }) {
  const icon = { error: '✕', warning: '▲', info: '·' }[props.f.severity]
  return (
    <button class={`finding ${props.f.severity}`} onClick={() => props.onPick(props.f.spans[0]!)}>
      <span class="ficon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span class="ftitle">{props.f.title}</span>
        <Show when={props.f.detail}>
          <span class="fdetail">{props.f.detail}</span>
        </Show>
      </span>
    </button>
  )
}

function Inspector(props: { t: Loaded['trace']; i: number }) {
  const t = () => props.t
  const status = () => (['unset', 'ok', 'error'] as const)[t().status[props.i]!]
  return (
    <>
      <h2>{t().nameOf(props.i)}</h2>
      <dl class="kv mono">
        <dt>kind</dt>
        <dd>{kindLabel(t().kind[props.i] as SpanKind)}</dd>
        <dt>status</dt>
        <dd class={status()}>{status()}</dd>
        <dt>time</dt>
        <dd>{duration(t().spanDuration(props.i))}</dd>
        <Show when={t().modelOf(props.i)}>
          <dt>model</dt>
          <dd>{t().modelOf(props.i)}</dd>
        </Show>
        <Show when={t().tokensIn[props.i]! + t().tokensOut[props.i]! > 0}>
          <dt>tokens</dt>
          <dd>
            {t().tokensIn[props.i]} in · {t().tokensOut[props.i]} out
          </dd>
        </Show>
      </dl>
      <Show when={t().errors[props.i]}>
        <Payload label="error" text={t().errors[props.i]!} tone="error" />
      </Show>
      <Show when={t().inputs[props.i]}>
        <Payload label="input" text={t().inputs[props.i]!} />
      </Show>
      <Show when={t().outputs[props.i]}>
        <Payload label="output" text={t().outputs[props.i]!} />
      </Show>
    </>
  )
}

const PREVIEW = 4000

function Payload(props: { label: string; text: string; tone?: 'error' }) {
  const [full, setFull] = createSignal(false)
  const pretty = () => {
    try {
      return JSON.stringify(JSON.parse(props.text), null, 2)
    } catch {
      return props.text
    }
  }
  const shown = () => (full() || pretty().length <= PREVIEW ? pretty() : `${pretty().slice(0, PREVIEW)}…`)
  return (
    <section class="payload">
      <h3>{props.label}</h3>
      <pre class="mono" classList={{ err: props.tone === 'error' }}>{shown()}</pre>
      <Show when={!full() && pretty().length > PREVIEW}>
        <button class="link" onClick={() => setFull(true)}>
          Show all ({Math.round(pretty().length / 1000)}k chars)
        </button>
      </Show>
    </section>
  )
}
