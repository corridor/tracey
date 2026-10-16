import { Show, createSignal, onMount } from 'solid-js'
import { applyTheme } from '@ggx/trace-theme'
import type { Theme } from '@ggx/trace-theme'
import { loadInWorker } from './loadAsync'
import { filesFromDrop, planDrop } from './dropfiles'
import type { DropPlan } from './dropfiles'
import type { Loaded } from './load'
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample'
import { Landing } from './Landing'
import { fileFromPath, isDesktop, listenForOpens, listenStart, listenStop, onOtlp, scanSessions } from './desktop'
import type { SessionRow } from './desktop'
import { DesktopHome } from './DesktopHome'
import type { ListenState } from './DesktopHome'
import { LiveRuns, batchSpans } from './live'
import type { LiveRun } from './live'
import { Result } from './Result'

const THEMES: Theme[] = ['dark', 'light', 'auto']
const ICON: Record<Theme, string> = { dark: '☾', light: '☀', auto: '◐' }

function savedTheme(): Theme {
  try {
    const t = localStorage.getItem('tracey-theme')
    return t === 'light' || t === 'dark' ? t : 'auto'
  } catch {
    return 'auto'
  }
}

export function App() {
  const [loaded, setLoaded] = createSignal<Loaded>()
  const [error, setError] = createSignal<string>()
  const [theme, setTheme] = createSignal<Theme>(savedTheme())
  applyTheme(theme())

  const [busy, setBusy] = createSignal<string>()

  // Desktop only: sessions found on this machine, and runs arriving from the local receiver.
  const desktop = isDesktop()
  const [sessions, setSessions] = createSignal<SessionRow[]>()
  const [liveRuns, setLiveRuns] = createSignal<LiveRun[]>([])
  const [listen, setListen] = createSignal<ListenState>({ on: false })
  const [liveId, setLiveId] = createSignal<string>()
  const live = new LiveRuns()
  let refresh: ReturnType<typeof setTimeout> | undefined
  const refreshLive = () => {
    refresh ??= setTimeout(() => {
      refresh = undefined
      setLiveRuns(live.list())
      const id = liveId()
      const l = id ? live.loaded(id) : undefined
      if (l) setLoaded(l)
    }, 250)
  }
  onMount(() => {
    if (!desktop) return
    void scanSessions().then(setSessions).catch(() => setSessions([]))
    onOtlp((b) => {
      void batchSpans(b)
        .then((spans) => {
          live.add(spans)
          refreshLive()
        })
        .catch(() => {})
    })
  })
  const toggleListen = async () => {
    if (listen().on) {
      await listenStop()
      setListen({ on: false })
      return
    }
    try {
      setListen({ on: true, port: await listenStart(4318) })
    } catch (e) {
      setListen({ on: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const openSession = async (path: string) => {
    setBusy(path.split(/[\\/]/).pop())
    try {
      await openFile(await fileFromPath(path))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(undefined)
    }
  }
  const openLive = (id: string) => {
    setLiveId(id)
    const l = live.loaded(id)
    if (l) setLoaded(l)
  }

  const open = async (name: string, source: File | string, subagents?: DropPlan['subagents']) => {
    setBusy(name)
    setError(undefined)
    try {
      setLoaded(await loadInWorker(name, source, subagents))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(undefined)
    }
  }

  const openFile = (file: File) => open(file.name, file)
  const openPlan = (plan: DropPlan) => open(plan.main.name, plan.main, plan.subagents)

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme()) + 1) % THEMES.length]!
    setTheme(next)
    applyTheme(next)
    try {
      next === 'auto' ? localStorage.removeItem('tracey-theme') : localStorage.setItem('tracey-theme', next)
    } catch {
      /* storage can be unavailable in private windows */
    }
  }

  const [help, setHelp] = createSignal(false)
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement && /^(input|textarea|select)$/i.test(e.target.tagName)
    if (e.key === '?' && !typing) setHelp((h) => !h)
    else if (e.key === 'Escape') setHelp(false)
  })

  listenForOpens((file) => void openFile(file))

  // Paste anywhere, drop anywhere.
  window.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text')
    if (t && t.trim().length > 1) void open('pasted trace', t)
  })
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => {
    e.preventDefault()
    if (!e.dataTransfer) return
    // Files, or folders (a session folder with its sub-agents): collect, then pick what to open.
    void filesFromDrop(e.dataTransfer).then((files) => {
      const plan = planDrop(files)
      if (plan) void openPlan(plan)
      else setError('Drop the session file too: those are sub-agent files, which open with their session.')
    })
  })

  return (
    <div class="app">
      <header class="bar">
        <button
          class="logo"
          onClick={() => {
            setLoaded(undefined)
            setLiveId(undefined)
            if (desktop) void scanSessions().then(setSessions).catch(() => {})
          }}
          aria-label="tracey home"
        >
          tracey
        </button>
        <Show when={loaded()}>{(l) => <Chips loaded={l()} />}</Show>
        <span class="grow" />
        <button class="icon-btn" onClick={() => setHelp((h) => !h)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-expanded={help()}>
          ?
        </button>
        <button class="icon-btn" onClick={cycleTheme} title={`Theme: ${theme()}`} aria-label={`Theme: ${theme()}. Click to change`}>
          {ICON[theme()]}
        </button>
      </header>
      <Show
        when={loaded()}
        fallback={
          desktop ? (
            <DesktopHome
              sessions={sessions()}
              live={liveRuns()}
              listen={listen()}
              busy={busy()}
              error={error()}
              onOpenSession={openSession}
              onOpenLive={openLive}
              onToggleListen={toggleListen}
              onFile={openFile}
              onSample={() => open(SAMPLE_NAME, SAMPLE_TEXT)}
            />
          ) : (
            <Landing error={error()} busy={busy()} onFile={openFile} onSample={() => open(SAMPLE_NAME, SAMPLE_TEXT)} />
          )
        }
      >
        {(l) => <Result loaded={l()} />}
      </Show>
      <Show when={help()}>
        <Shortcuts />
      </Show>
    </div>
  )
}

function Shortcuts() {
  const rows: [string, string][] = [
    ['← → ↑ ↓', 'Walk the graph (parent, child, siblings)'],
    ['F', 'Fit the whole graph'],
    ['+  −', 'Zoom in and out'],
    ['Scroll', 'Pan; Ctrl/Cmd + scroll or pinch to zoom'],
    ['Double-click', 'Zoom to a step'],
    ['⌘/Ctrl V', 'Paste a trace'],
    ['?', 'Show or hide this list'],
    ['Esc', 'Close this list'],
  ]
  return (
    <aside class="help" role="dialog" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      <dl>
        {rows.map(([k, v]) => (
          <>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </>
        ))}
      </dl>
    </aside>
  )
}

import { Chips } from './Chips'
