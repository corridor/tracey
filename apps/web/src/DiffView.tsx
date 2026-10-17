import { For, Show, createMemo, createSignal } from 'solid-js'
import { countChanges, describeSummary, diffText, diffTraces, prettyIfJson } from '@ggx/trace-diff'
import type { DiffRow, Reason } from '@ggx/trace-diff'
import { kindLabel } from '@ggx/trace-model'
import type { SpanKind, Trace } from '@ggx/trace-model'
import type { Loaded } from './load'
import { compact, duration } from './format'

const ROW = 30
const MARK = { same: '=', changed: '≠', added: '+', removed: '−' } as const
const REASON: Record<Reason, string> = {
  failed: 'now fails',
  fixed: 'fixed',
  slower: 'slower',
  faster: 'faster',
  input: 'input',
  output: 'output',
  model: 'model',
  tokens: 'tokens',
}

const signed = (ms: number) => `${ms < 0 ? '−' : '+'}${duration(Math.abs(ms))}`

/** Two runs side by side: what was added, removed or changed, and a text diff of the selected step. */
export function DiffView(props: { a: Loaded; b: Loaded; onClose: () => void }) {
  const diff = createMemo(() => diffTraces(props.a.trace, props.b.trace))
  const [onlyChanges, setOnlyChanges] = createSignal(true)
  const rows = createMemo(() => (onlyChanges() ? diff().rows.filter((r) => r.state !== 'same') : diff().rows))
  const [selected, setSelected] = createSignal<DiffRow | undefined>(diff().rows.find((r) => r.state !== 'same'))
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewH, setViewH] = createSignal(400)

  const visible = createMemo(() => {
    const from = Math.max(0, Math.floor(scrollTop() / ROW) - 5)
    const to = Math.min(rows().length, Math.ceil((scrollTop() + viewH()) / ROW) + 5)
    return rows().slice(from, to).map((r, k) => ({ r, row: from + k }))
  })
  const nameOf = (r: DiffRow) => (r.a >= 0 ? props.a.trace.nameOf(r.a) : props.b.trace.nameOf(r.b))
  const s = () => diff().summary

  return (
    <div class="diff" aria-label="Comparison">
      <header class="diff-head">
        <div class="diff-runs">
          <span class="chip">A {props.a.name}</span>
          <span aria-hidden="true">→</span>
          <span class="chip">B {props.b.name}</span>
        </div>
        <p class="diff-summary" classList={{ bad: s().newFailures > 0 }}>
          {describeSummary(s())}
        </p>
        <span class="meta mono">
          {duration(s().durationA)} → {duration(s().durationB)}
          {s().tokensA + s().tokensB > 0 ? ` · ${compact(s().tokensA)} → ${compact(s().tokensB)} tok` : ''}
        </span>
        <span class="grow" />
        <label class="check">
          <input type="checkbox" checked={onlyChanges()} onChange={(e) => setOnlyChanges(e.currentTarget.checked)} /> Only changes
        </label>
        <button class="btn" onClick={props.onClose}>
          Close comparison
        </button>
      </header>

      <div class="diff-body">
        <section class="panel diff-list" aria-label="Steps">
          <Show when={rows().length} fallback={<p class="ok-note">✓ No differences</p>}>
            <div
              class="rows"
              ref={(el) => {
                queueMicrotask(() => setViewH(el.clientHeight))
                new ResizeObserver(() => setViewH(el.clientHeight)).observe(el)
              }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div style={{ height: `${rows().length * ROW}px`, position: 'relative' }}>
                <For each={visible()}>
                  {(v) => (
                    <button
                      class={`drow ${v.r.state}`}
                      classList={{ sel: selected() === v.r }}
                      style={{ top: `${v.row * ROW}px`, height: `${ROW}px` }}
                      onClick={() => setSelected(v.r)}
                    >
                      <span class="mark" aria-hidden="true">
                        {MARK[v.r.state]}
                      </span>
                      <span class="dname" style={{ 'padding-left': `${v.r.depth * 12}px` }}>
                        {nameOf(v.r)}
                      </span>
                      <span class="dwhy">
                        <Show when={v.r.state !== 'changed'}>{v.r.state}</Show>
                        <For each={v.r.reasons}>{(x) => <span class={`reason ${x}`}>{REASON[x]}</span>}</For>
                      </span>
                      <span class="dur mono">
                        {v.r.a >= 0 ? duration(props.a.trace.spanDuration(v.r.a)) : '–'} → {v.r.b >= 0 ? duration(props.b.trace.spanDuration(v.r.b)) : '–'}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </section>

        <aside class="panel diff-detail" aria-label="Step comparison">
          <Show when={selected()} fallback={<p class="fine">Pick a step to compare it.</p>}>
            {(r) => <Detail row={r()} a={props.a.trace} b={props.b.trace} />}
          </Show>
        </aside>
      </div>
    </div>
  )
}

function Detail(props: { row: DiffRow; a: Trace; b: Trace }) {
  const r = () => props.row
  const side = (t: Trace, i: number) =>
    i < 0
      ? undefined
      : {
          kind: kindLabel(t.kind[i] as SpanKind),
          status: (['unset', 'ok', 'error'] as const)[t.status[i]!],
          time: duration(t.spanDuration(i)),
          model: t.modelOf(i) || '–',
          tokens: t.tokensIn[i]! + t.tokensOut[i]! > 0 ? `${t.tokensIn[i]} in · ${t.tokensOut[i]} out` : '–',
          error: t.errors[i],
          input: t.inputs[i] ?? '',
          output: t.outputs[i] ?? '',
        }
  const A = () => side(props.a, r().a)
  const B = () => side(props.b, r().b)
  const name = () => (r().a >= 0 ? props.a.nameOf(r().a) : props.b.nameOf(r().b))
  const fields: ['kind' | 'status' | 'time' | 'model' | 'tokens', string][] = [
    ['status', 'status'],
    ['time', 'time'],
    ['model', 'model'],
    ['tokens', 'tokens'],
  ]

  return (
    <>
      <h2>
        {name()} <span class={`reason ${r().state}`}>{r().state}</span>
      </h2>
      <Show when={r().state === 'changed' && r().deltaMs !== 0}>
        <p class="fine">{signed(r().deltaMs)} in B</p>
      </Show>
      <table class="cmp mono">
        <thead>
          <tr>
            <th />
            <th>A</th>
            <th>B</th>
          </tr>
        </thead>
        <tbody>
          <For each={fields}>
            {([key, label]) => (
              <tr classList={{ diff: (A()?.[key] ?? '–') !== (B()?.[key] ?? '–') }}>
                <td>{label}</td>
                <td>{A()?.[key] ?? '–'}</td>
                <td>{B()?.[key] ?? '–'}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <TextDiff label="error" a={A()?.error ?? ''} b={B()?.error ?? ''} />
      <TextDiff label="input" a={A()?.input ?? ''} b={B()?.input ?? ''} />
      <TextDiff label="output" a={A()?.output ?? ''} b={B()?.output ?? ''} />
    </>
  )
}

const MAX_LINES = 400

function TextDiff(props: { label: string; a: string; b: string }) {
  const [all, setAll] = createSignal(false)
  const changes = createMemo(() => diffText(prettyIfJson(props.a), prettyIfJson(props.b)))
  const n = () => countChanges(changes())
  const shown = () => (all() ? changes() : changes().slice(0, MAX_LINES))
  return (
    <Show when={props.a || props.b}>
      <section class="payload">
        <h3>
          {props.label}
          <Show when={n().added + n().removed > 0} fallback={<span class="same-note"> · same</span>}>
            <span class="same-note">
              {' '}
              · <span class="add">+{n().added}</span> <span class="del">−{n().removed}</span>
            </span>
          </Show>
        </h3>
        <pre class="tdiff mono">
          <For each={shown()}>
            {(c) => (
              <span class={`tline ${c.type}`}>
                <span class="tsign" aria-hidden="true">
                  {c.type === 'add' ? '+' : c.type === 'del' ? '−' : ' '}
                </span>
                {c.text}
                {'\n'}
              </span>
            )}
          </For>
        </pre>
        <Show when={!all() && changes().length > MAX_LINES}>
          <button class="link" onClick={() => setAll(true)}>
            Show all {changes().length} lines
          </button>
        </Show>
      </section>
    </Show>
  )
}

