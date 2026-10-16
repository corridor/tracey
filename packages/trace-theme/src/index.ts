export type Theme = 'dark' | 'light' | 'auto'

/** Apply a theme to the document root. `auto` removes the override so the OS preference applies. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

/** Token values resolved for the current theme, for canvas renderers (read once per theme change). */
export function readTokens(root: HTMLElement = document.documentElement): Record<string, string> {
  const cs = getComputedStyle(root)
  const names = [
    'bg', 'surface', 'border', 'text', 'text-secondary', 'text-muted', 'text-strong', 'accent', 'accent-text',
    'error', 'warning', 'success', 'purple', 'kind-agent', 'kind-llm', 'kind-tool', 'kind-retrieval', 'kind-other',
  ]
  return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--tracey-${n}`).trim()]))
}

/** Colours for canvas views (graph, timeline strip), resolved for the current theme. */
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

export function readPalette(root: HTMLElement = document.documentElement): Palette {
  const t = readTokens(root)
  return {
    bg: t['bg']!,
    surface: t['surface']!,
    border: t['border']!,
    text: t['text']!,
    textSecondary: t['text-secondary']!,
    textMuted: t['text-muted']!,
    accent: t['accent']!,
    error: t['error']!,
    warning: t['warning']!,
    kindAgent: t['kind-agent']!,
    kindLlm: t['kind-llm']!,
    kindTool: t['kind-tool']!,
    kindRetrieval: t['kind-retrieval']!,
    kindOther: t['kind-other']!,
  }
}

/** Run `fn` now and whenever the theme changes (attribute flip or OS preference). Returns a stop function. */
export function watchTheme(fn: () => void, root: HTMLElement = document.documentElement): () => void {
  const mo = new MutationObserver(fn)
  mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  const mq = matchMedia('(prefers-color-scheme: light)')
  mq.addEventListener('change', fn)
  fn()
  return () => {
    mo.disconnect()
    mq.removeEventListener('change', fn)
  }
}
