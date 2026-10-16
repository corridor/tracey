import { Show, createSignal } from 'solid-js'
import { applyTheme } from '@ggx/trace-theme'
import type { Theme } from '@ggx/trace-theme'
import { loadInWorker } from './loadAsync'
import type { Loaded } from './load'
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample'
import { Landing } from './Landing'
import { listenForOpens } from './desktop'
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

  const open = async (name: string, source: File | string) => {
    setBusy(name)
    setError(undefined)
    try {
      setLoaded(await loadInWorker(name, source))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(undefined)
    }
  }

  const openFile = (file: File) => open(file.name, file)

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
    const f = e.dataTransfer?.files[0]
    if (f) void openFile(f)
  })

  return (
    <div class="app">
      <header class="bar">
        <button class="logo" onClick={() => setLoaded(undefined)} aria-label="tracey home">
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
        fallback={<Landing error={error()} busy={busy()} onFile={openFile} onSample={() => open(SAMPLE_NAME, SAMPLE_TEXT)} />}
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
