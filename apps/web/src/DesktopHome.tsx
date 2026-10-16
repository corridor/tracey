import { For, Show, createMemo, createSignal } from 'solid-js'
import type { LiveRun } from './live'
import type { SessionRow } from './desktop'
import { ago, bytes, sessionLabel } from './format'

export interface ListenState {
  on: boolean
  port?: number
  error?: string
}

type Source = 'all' | 'claude-code' | 'live'

/** The desktop start screen: sessions found on this machine, plus runs arriving live. */
export function DesktopHome(props: {
  sessions: SessionRow[] | undefined
  live: LiveRun[]
  listen: ListenState
  busy: string | undefined
  error: string | undefined
  onOpenSession: (path: string) => void
  onOpenLive: (id: string) => void
  onToggleListen: () => void
  onFile: (f: File) => void
  onSample: () => void
}) {
  const [source, setSource] = createSignal<Source>('all')
  const [query, setQuery] = createSignal('')
  let input!: HTMLInputElement

  const sessions = () => props.sessions ?? []
  const matches = (text: string) => text.toLowerCase().includes(query().trim().toLowerCase())
  const shownSessions = createMemo(() =>
    source() === 'live' ? [] : sessions().filter((s) => matches(`${sessionLabel(s)} ${s.project ?? ''} ${s.path}`)),
  )
  const shownLive = createMemo(() => (source() === 'claude-code' ? [] : props.live.filter((r) => matches(`live ${r.id}`))))
  const endpoint = () => `http://127.0.0.1:${props.listen.port ?? 4318}`

  const Side = (p: { id: Source; label: string; count: number }) => (
    <button class="dh-src" classList={{ on: source() === p.id }} onClick={() => setSource(p.id)} aria-pressed={source() === p.id}>
      <span>{p.label}</span>
      <span class="dh-count">{p.count}</span>
    </button>
  )

  return (
    <main class="dh">
      <aside class="dh-side" aria-label="Sources">
        <h2>Sources</h2>
        <Side id="all" label="All" count={sessions().length + props.live.length} />
        <Side id="claude-code" label="Claude Code" count={sessions().length} />
        <Side id="live" label="Live" count={props.live.length} />
        <div class="dh-listen">
          <button class="btn" classList={{ on: props.listen.on }} onClick={props.onToggleListen} aria-pressed={props.listen.on}>
            {props.listen.on ? `● Listening on :${props.listen.port}` : 'Listen for a running agent'}
          </button>
          <Show when={props.listen.on}>
            <code class="dh-endpoint mono" title="Set this in the agent's shell">
              export OTEL_EXPORTER_OTLP_ENDPOINT={endpoint()}
            </code>
          </Show>
          <Show when={props.listen.error}>
            <p class="error" role="alert">
              {props.listen.error}
            </p>
          </Show>
        </div>
      </aside>

      <section class="dh-main">
        <div class="dh-bar">
          <input
            class="dh-search"
            type="search"
            placeholder="Search sessions"
            aria-label="Search sessions"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <button class="btn" onClick={() => input.click()}>
            Choose a file
          </button>
          <input
            ref={input}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0]
              if (f) props.onFile(f)
              e.currentTarget.value = ''
            }}
          />
        </div>

        <Show when={props.busy}>
          <p class="fine" role="status">
            Reading {props.busy}…
          </p>
        </Show>
        <Show when={props.error}>
          <p class="error" role="alert">
            {props.error}
          </p>
        </Show>

        <div class="dh-list" role="list">
          <For each={shownLive()}>
            {(r) => (
              <button class="dh-row" role="listitem" onClick={() => props.onOpenLive(r.id)}>
                <span class="dh-title">
                  <span class="dot" classList={{ ok: r.running }} aria-hidden="true" /> live run {r.id.slice(0, 8)}
                </span>
                <span class="dh-meta mono">
                  {r.spans} spans · {r.running ? 'running' : 'idle'}
                </span>
              </button>
            )}
          </For>
          <For each={shownSessions()}>
            {(s) => (
              <button class="dh-row" role="listitem" onClick={() => props.onOpenSession(s.path)}>
                <span class="dh-title">{sessionLabel(s)}</span>
                <span class="dh-meta mono">
                  {s.project ?? ''} · {ago(s.mtimeMs)} · {bytes(s.size)}
                </span>
              </button>
            )}
          </For>
          <Show when={shownSessions().length + shownLive().length === 0 && props.sessions !== undefined && !props.busy}>
            <div class="dh-empty">
              <p>{query() ? 'Nothing matches.' : source() === 'live' ? 'No live runs yet. Turn on Listen and point an agent at it.' : 'No sessions found in the usual places (~/.claude*).'}</p>
              <p class="fine">Drop a trace file anywhere, choose one, or</p>
              <button class="btn" onClick={props.onSample}>
                Try a sample ▸
              </button>
            </div>
          </Show>
        </div>
        <p class="fine">Everything stays on this machine. Only file names, times and a title are read to build this list.</p>
      </section>
    </main>
  )
}
