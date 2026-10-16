import { Show, createSignal } from 'solid-js'
import { applyTheme } from '@ggx/trace-theme'
import type { Theme } from '@ggx/trace-theme'
import { load } from './load'
import type { Loaded } from './load'
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample'
import { Landing } from './Landing'
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

  const open = (name: string, text: string) => {
    try {
      setLoaded(load(name, text))
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const openFile = async (file: File) => open(file.name, await file.text())

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

  // Paste anywhere, drop anywhere.
  window.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text')
    if (t && t.trim().length > 1) open('pasted trace', t)
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
        <button class="icon-btn" onClick={cycleTheme} title={`Theme: ${theme()}`} aria-label={`Theme: ${theme()}. Click to change`}>
          {ICON[theme()]}
        </button>
      </header>
      <Show
        when={loaded()}
        fallback={<Landing error={error()} onFile={openFile} onSample={() => open(SAMPLE_NAME, SAMPLE_TEXT)} />}
      >
        {(l) => <Result loaded={l()} />}
      </Show>
    </div>
  )
}

import { Chips } from './Chips'
